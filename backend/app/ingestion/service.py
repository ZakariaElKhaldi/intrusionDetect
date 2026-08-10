from __future__ import annotations

import hashlib
import json
from base64 import urlsafe_b64decode, urlsafe_b64encode
from collections import Counter
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.models import (
    IngestionJob,
    IngestionJobTransition,
    Observation,
    OutboxEvent,
    Prediction,
    WorkerState,
)
from app.features.canonical_schema import FlowObservation
from app.ingestion.schemas import (
    EnqueuedEvent,
    IngestionBatchResponse,
    IngestionEventResponse,
    IngestionJobListResponse,
    IngestionJobSummary,
    IngestionStatusResponse,
    IngestionTransitionResponse,
    OutboxEventListResponse,
    OutboxEventResponse,
    OutboxStatus,
    WorkerStatus,
)

ACTIVE_STATES = ("queued", "processing", "retrying")


class QueueFullError(RuntimeError):
    pass


class IdempotencyConflictError(RuntimeError):
    pass


class RedriveRefusedError(RuntimeError):
    pass


def now_utc() -> datetime:
    return datetime.now(UTC)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def canonical_payload(observation: FlowObservation) -> dict:
    return observation.model_dump(mode="json", exclude_none=False)


def payload_hash(payload: dict) -> str:
    encoded = json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def record_transition(
    session: Session,
    job: IngestionJob,
    *,
    from_state: str | None,
    to_state: str,
    reason_code: str,
    error_code: str | None = None,
    retryable: bool | None = None,
    worker_id: str | None = None,
    operator: str | None = None,
    reason: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    """Append an immutable audit record in the job's transaction."""
    session.add(
        IngestionJobTransition(
            job_id=job.job_id,
            event_id=job.event_id,
            from_state=from_state,
            to_state=to_state,
            reason_code=reason_code,
            error_code=error_code,
            retryable=retryable,
            worker_id=worker_id,
            operator=operator,
            reason=reason,
            details=details or {},
        )
    )


def _payload_identity(row: IngestionJob) -> tuple[str, str, str | None]:
    context = row.payload.get("network_context") or {}
    return (
        str(row.payload.get("source") or "unknown"),
        str(row.payload.get("schema_version") or "unknown"),
        context.get("extractor_fingerprint"),
    )


def _encode_cursor(created_at: datetime, identity: str) -> str:
    value = json.dumps([created_at.isoformat(), identity], separators=(",", ":"))
    return urlsafe_b64encode(value.encode()).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        created_at, identity = json.loads(urlsafe_b64decode(padded).decode())
        return datetime.fromisoformat(created_at), str(identity)
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError("invalid pagination cursor") from exc


def enqueue_observations(
    observations: list[FlowObservation],
    session: Session,
    *,
    queue_limit: int,
    ingestion_channel: str = "http_ingestion",
) -> IngestionBatchResponse:
    """Atomically enqueue a fully validated batch with event-id idempotency."""
    if session.bind is not None and session.bind.dialect.name == "postgresql":
        # Serialize capacity checks while retaining concurrent worker claims.
        session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext('iot_ids_ingestion_enqueue'))")
        )
    batch_id = str(uuid4())
    prepared = [
        (str(item.event_id), canonical_payload(item), payload_hash(canonical_payload(item)))
        for item in observations
    ]
    event_ids = list(dict.fromkeys(item[0] for item in prepared))
    existing = {
        row.event_id: row
        for row in session.scalars(
            select(IngestionJob).where(IngestionJob.event_id.in_(event_ids))
        )
    }

    seen: dict[str, str] = {}
    for event_id, _payload, digest in prepared:
        previous_digest = seen.get(event_id)
        if previous_digest is not None and previous_digest != digest:
            raise IdempotencyConflictError(
                f"event_id {event_id} occurs with different payloads in this batch"
            )
        seen[event_id] = digest
        row = existing.get(event_id)
        if row is not None and row.payload_hash != digest:
            raise IdempotencyConflictError(
                f"event_id {event_id} already exists with a different payload"
            )

    new_by_id = {
        event_id: (payload, digest)
        for event_id, payload, digest in prepared
        if event_id not in existing
    }
    active_count = session.scalar(
        select(func.count()).select_from(IngestionJob).where(
            IngestionJob.state.in_(ACTIVE_STATES)
        )
    ) or 0
    if active_count + len(new_by_id) > queue_limit:
        raise QueueFullError(
            f"ingestion queue capacity exceeded ({active_count}/{queue_limit} active)"
        )

    accepted: set[str] = set()
    for event_id, (payload, digest) in new_by_id.items():
        job = IngestionJob(
            job_id=str(uuid4()),
            batch_id=batch_id,
            event_id=event_id,
            payload_hash=digest,
            payload=payload,
            ingestion_channel=ingestion_channel,
            state="queued",
        )
        session.add(job)
        record_transition(
            session,
            job,
            from_state=None,
            to_state="queued",
            reason_code="enqueued",
        )
        accepted.add(event_id)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise IdempotencyConflictError(
            "an event_id was concurrently enqueued; retry the request"
        ) from exc

    response_events = []
    emitted: set[str] = set()
    for event_id, _payload, _digest in prepared:
        row = existing.get(event_id)
        is_new = event_id in accepted and event_id not in emitted
        response_events.append(
            EnqueuedEvent(
                event_id=event_id,
                state="queued" if is_new else (row.state if row else "queued"),
                disposition="accepted" if is_new else "duplicate",
            )
        )
        emitted.add(event_id)
    return IngestionBatchResponse(batch_id=batch_id, events=response_events)


def get_event(session: Session, event_id: str) -> IngestionEventResponse | None:
    row = session.scalar(
        select(IngestionJob).where(IngestionJob.event_id == event_id)
    )
    if row is None:
        return None
    source, schema_version, extractor_fingerprint = _payload_identity(row)
    model_version = session.scalar(
        select(Prediction.model_version).where(Prediction.event_id == event_id)
    )
    transitions = list(
        session.scalars(
            select(IngestionJobTransition)
            .where(IngestionJobTransition.job_id == row.job_id)
            .order_by(IngestionJobTransition.occurred_at, IngestionJobTransition.transition_id)
        )
    )
    return IngestionEventResponse(
        event_id=row.event_id,
        batch_id=row.batch_id,
        state=row.state,
        attempts=row.attempts,
        available_at=row.available_at,
        lease_expires_at=row.lease_expires_at,
        last_error=row.last_error,
        error_code=row.error_code,
        retryable=row.retryable,
        redrive_count=row.redrive_count,
        last_redriven_at=row.last_redriven_at,
        last_redriven_by=row.last_redriven_by,
        last_redrive_reason=row.last_redrive_reason,
        source=source,
        schema_version=schema_version,
        extractor_fingerprint=extractor_fingerprint,
        model_version=model_version,
        transitions=[
            IngestionTransitionResponse(
                transition_id=item.transition_id,
                from_state=item.from_state,
                to_state=item.to_state,
                reason_code=item.reason_code,
                error_code=item.error_code,
                retryable=item.retryable,
                worker_id=item.worker_id,
                operator=item.operator,
                reason=item.reason,
                details=item.details,
                occurred_at=item.occurred_at,
                action=item.reason_code,
                attempt=item.details.get("attempt"),
                actor=item.operator or item.worker_id,
                created_at=item.occurred_at,
            )
            for item in transitions
        ],
        created_at=row.created_at,
        updated_at=row.updated_at,
        completed_at=row.completed_at,
    )


def list_jobs(
    session: Session,
    *,
    state: str | None = None,
    error_code: str | None = None,
    source: str | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    cursor: str | None = None,
    limit: int = 100,
) -> IngestionJobListResponse:
    query = select(IngestionJob)
    if state:
        query = query.where(IngestionJob.state == state)
    if error_code:
        query = query.where(IngestionJob.error_code == error_code)
    if source:
        query = query.where(IngestionJob.payload["source"].as_string() == source)
    if created_from:
        query = query.where(IngestionJob.created_at >= created_from)
    if created_to:
        query = query.where(IngestionJob.created_at <= created_to)
    total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
    if cursor:
        cursor_time, cursor_id = _decode_cursor(cursor)
        query = query.where(
            or_(
                IngestionJob.created_at < cursor_time,
                and_(
                    IngestionJob.created_at == cursor_time,
                    IngestionJob.job_id < cursor_id,
                ),
            )
        )
    rows = list(
        session.scalars(
            query.order_by(IngestionJob.created_at.desc(), IngestionJob.job_id.desc()).limit(
                limit + 1
            )
        )
    )
    has_more = len(rows) > limit
    rows = rows[:limit]
    items = []
    for row in rows:
        row_source, schema_version, extractor_fingerprint = _payload_identity(row)
        items.append(
            IngestionJobSummary(
                event_id=row.event_id,
                batch_id=row.batch_id,
                state=row.state,
                attempts=row.attempts,
                source=row_source,
                schema_version=schema_version,
                extractor_fingerprint=extractor_fingerprint,
                error_code=row.error_code,
                retryable=row.retryable,
                redrive_count=row.redrive_count,
                last_error=row.last_error,
                available_at=row.available_at,
                lease_expires_at=row.lease_expires_at,
                created_at=row.created_at,
                updated_at=row.updated_at,
                completed_at=row.completed_at,
            )
        )
    next_cursor = (
        _encode_cursor(rows[-1].created_at, rows[-1].job_id) if has_more and rows else None
    )
    return IngestionJobListResponse(
        items=items, total=total, limit=limit, next_cursor=next_cursor
    )


def list_outbox_events(
    session: Session,
    *,
    status: str | None = None,
    event_type: str | None = None,
    cursor: str | None = None,
    limit: int = 100,
) -> OutboxEventListResponse:
    query = select(OutboxEvent)
    if status == "pending":
        query = query.where(
            OutboxEvent.published_at.is_(None), OutboxEvent.publish_attempts == 0
        )
    elif status == "failed":
        query = query.where(
            OutboxEvent.published_at.is_(None), OutboxEvent.publish_attempts > 0
        )
    elif status == "published":
        query = query.where(OutboxEvent.published_at.is_not(None))
    if event_type:
        query = query.where(OutboxEvent.event_type == event_type)
    total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
    if cursor:
        cursor_time, cursor_id = _decode_cursor(cursor)
        query = query.where(
            or_(
                OutboxEvent.created_at < cursor_time,
                and_(
                    OutboxEvent.created_at == cursor_time,
                    OutboxEvent.outbox_id < cursor_id,
                ),
            )
        )
    rows = list(
        session.scalars(
            query.order_by(OutboxEvent.created_at.desc(), OutboxEvent.outbox_id.desc()).limit(
                limit + 1
            )
        )
    )
    has_more = len(rows) > limit
    rows = rows[:limit]
    return OutboxEventListResponse(
        items=[
            OutboxEventResponse(
                outbox_id=row.outbox_id,
                event_id=row.event_id,
                event_type=row.event_type,
                status=(
                    "published"
                    if row.published_at
                    else "failed"
                    if row.publish_attempts
                    else "pending"
                ),
                publish_attempts=row.publish_attempts,
                last_error=row.last_error,
                claimed=row.claim_token is not None,
                claim_expires_at=row.claim_expires_at,
                next_attempt_at=row.next_attempt_at,
                created_at=row.created_at,
                published_at=row.published_at,
            )
            for row in rows
        ],
        total=total,
        limit=limit,
        next_cursor=(
            _encode_cursor(rows[-1].created_at, rows[-1].outbox_id)
            if has_more and rows
            else None
        ),
    )


def ingestion_status(session: Session, *, lease_seconds: int) -> IngestionStatusResponse:
    now = now_utc()
    counts = Counter(
        dict(
            session.execute(
                select(IngestionJob.state, func.count()).group_by(IngestionJob.state)
            ).all()
        )
    )
    oldest = session.scalar(
        select(func.min(IngestionJob.created_at)).where(
            IngestionJob.state.in_(ACTIVE_STATES)
        )
    )
    completed_last_minute = session.scalar(
        select(func.count()).select_from(IngestionJob).where(
            IngestionJob.completed_at >= now - timedelta(minutes=1),
            IngestionJob.state == "succeeded",
        )
    ) or 0
    retries = session.scalar(
        select(func.coalesce(func.sum(IngestionJob.attempts - 1), 0)).where(
            IngestionJob.attempts > 1
        )
    ) or 0
    heartbeat = session.scalar(
        select(func.max(WorkerState.last_heartbeat_at))
    )
    heartbeat_utc = _as_utc(heartbeat)
    worker_fresh = bool(
        heartbeat_utc
        and heartbeat_utc >= now - timedelta(seconds=max(lease_seconds * 2, 10))
    )
    queue_depth = sum(counts[state] for state in ACTIVE_STATES)
    worker_status = "ready" if worker_fresh else "degraded" if queue_depth == 0 else "blocked"
    worker_reason = (
        "worker heartbeat is current"
        if worker_fresh
        else "no current worker heartbeat; start the ingestion worker"
    )

    pending_outbox = session.scalar(
        select(func.count()).select_from(OutboxEvent).where(
            OutboxEvent.published_at.is_(None)
        )
    ) or 0
    published_outbox = session.scalar(
        select(func.count()).select_from(OutboxEvent).where(
            OutboxEvent.published_at.is_not(None)
        )
    ) or 0
    oldest_outbox = session.scalar(
        select(func.min(OutboxEvent.created_at)).where(
            OutboxEvent.published_at.is_(None)
        )
    )
    oldest_utc = _as_utc(oldest)
    oldest_outbox_utc = _as_utc(oldest_outbox)
    return IngestionStatusResponse(
        queue_depth=queue_depth,
        queued=counts["queued"],
        processing=counts["processing"],
        retrying=counts["retrying"],
        succeeded=counts["succeeded"],
        dead_letter=counts["dead_letter"],
        retries=int(retries),
        failures=counts["dead_letter"],
        oldest_pending_age_seconds=(now - oldest_utc).total_seconds()
        if oldest_utc
        else None,
        throughput_per_minute=completed_last_minute,
        worker=WorkerStatus(
            status=worker_status,
            reason=worker_reason,
            last_heartbeat_at=heartbeat_utc,
        ),
        outbox=OutboxStatus(
            status="degraded" if pending_outbox else "ready",
            reason=(
                f"{pending_outbox} committed events await publication"
                if pending_outbox
                else "all committed events have been published"
            ),
            pending=pending_outbox,
            published=published_outbox,
            oldest_pending_age_seconds=(now - oldest_outbox_utc).total_seconds()
            if oldest_outbox_utc
            else None,
        ),
        generated_at=now,
    )


def recover_expired_leases(session: Session) -> int:
    now = now_utc()
    rows = list(
        session.scalars(
            select(IngestionJob).where(
                IngestionJob.state == "processing",
                IngestionJob.lease_expires_at < now,
            )
        )
    )
    for row in rows:
        previous_worker = row.worker_id
        row.state = "retrying"
        row.available_at = now
        row.lease_expires_at = None
        row.worker_id = None
        row.last_error = "processing lease expired; recovered for retry"
        row.error_code = "lease_expired"
        row.retryable = True
        record_transition(
            session,
            row,
            from_state="processing",
            to_state="retrying",
            reason_code="lease_recovered",
            error_code=row.error_code,
            retryable=True,
            worker_id=previous_worker,
        )
    session.commit()
    return len(rows)


def claim_next_job(
    session: Session, *, worker_id: str, lease_seconds: int
) -> IngestionJob | None:
    now = now_utc()
    query = (
        select(IngestionJob)
        .where(
            IngestionJob.state.in_(("queued", "retrying")),
            IngestionJob.available_at <= now,
        )
        .order_by(IngestionJob.created_at)
        .limit(1)
    )
    if session.bind is not None and session.bind.dialect.name == "postgresql":
        query = query.with_for_update(skip_locked=True)
    row = session.scalar(query)
    if row is None:
        return None
    previous_state = row.state
    row.attempts += 1
    row.worker_id = worker_id
    row.lease_expires_at = now + timedelta(seconds=lease_seconds)
    row.updated_at = now
    record_transition(
        session,
        row,
        from_state=previous_state,
        to_state="processing",
        reason_code="claimed",
        worker_id=worker_id,
        details={"attempt": row.attempts},
    )
    row.state = "processing"
    session.commit()
    return row


def evaluate_redrive(
    session: Session,
    event_id: str,
    *,
    compatibility_check: Callable[[dict], None] | None = None,
) -> tuple[IngestionJob | None, str | None]:
    query = select(IngestionJob).where(IngestionJob.event_id == event_id)
    if session.bind is not None and session.bind.dialect.name == "postgresql":
        query = query.with_for_update()
    row = session.scalar(query)
    if row is None:
        return None, "event was not found"
    if row.state == "succeeded":
        return row, "succeeded jobs cannot be redriven"
    if row.state != "dead_letter":
        return row, f"job is {row.state}, not dead_letter"
    if row.lease_expires_at is not None and _as_utc(row.lease_expires_at) > now_utc():
        return row, "job has an active processing lease"
    if payload_hash(row.payload) != row.payload_hash:
        return row, "stored payload conflicts with its immutable hash"
    if session.scalar(select(Prediction.prediction_id).where(Prediction.event_id == event_id)):
        return row, "a persisted prediction already exists"
    if session.get(Observation, event_id) is not None:
        return row, "a persisted observation already exists"
    if row.retryable:
        return row, None
    if row.error_code == "extractor_incompatible" and compatibility_check:
        try:
            compatibility_check(row.payload)
        except Exception as exc:
            return row, f"extractor remains incompatible: {exc}"
        return row, None
    return row, "failure is permanent and not eligible for redrive"


def redrive_events(
    session: Session,
    event_ids: list[str],
    *,
    operator: str,
    reason: str,
    compatibility_check: Callable[[dict], None] | None = None,
    dry_run: bool = False,
) -> list[dict[str, Any]]:
    if not operator.strip() or not reason.strip():
        raise ValueError("operator and reason are required")
    if not event_ids:
        raise ValueError("at least one event_id is required")
    if len(set(event_ids)) != len(event_ids):
        raise ValueError("event_ids must be unique")
    results: list[dict[str, Any]] = []
    eligible: list[IngestionJob] = []
    for event_id in event_ids:
        row, refusal = evaluate_redrive(
            session, event_id, compatibility_check=compatibility_check
        )
        results.append(
            {
                "event_id": event_id,
                "eligible": refusal is None,
                "reason": refusal or "eligible",
            }
        )
        if refusal is None and row is not None:
            eligible.append(row)
    refusals = [item for item in results if not item["eligible"]]
    if refusals and not dry_run:
        session.rollback()
        summary = "; ".join(f"{item['event_id']}: {item['reason']}" for item in refusals)
        raise RedriveRefusedError(summary)
    if dry_run:
        session.rollback()
        return results

    now = now_utc()
    for row in eligible:
        previous_error_code = row.error_code
        previous_error = row.last_error
        record_transition(
            session,
            row,
            from_state="dead_letter",
            to_state="queued",
            reason_code="manual_redrive",
            error_code=previous_error_code,
            retryable=row.retryable,
            operator=operator.strip(),
            reason=reason.strip(),
            details={
                "previous_attempts": row.attempts,
                "previous_error": previous_error,
                "redrive_number": row.redrive_count + 1,
            },
        )
        row.state = "queued"
        row.attempts = 0
        row.available_at = now
        row.completed_at = None
        row.worker_id = None
        row.lease_expires_at = None
        row.last_error = None
        row.error_code = None
        row.retryable = None
        row.redrive_count += 1
        row.last_redriven_at = now
        row.last_redriven_by = operator.strip()
        row.last_redrive_reason = reason.strip()
    session.commit()
    return results


def heartbeat(session: Session, worker_id: str) -> None:
    now = now_utc()
    row = session.get(WorkerState, worker_id)
    if row is None:
        session.add(WorkerState(worker_id=worker_id, last_heartbeat_at=now))
    else:
        row.last_heartbeat_at = now
    session.commit()
