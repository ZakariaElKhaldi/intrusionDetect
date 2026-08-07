from __future__ import annotations

import hashlib
import json
from collections import Counter
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.models import IngestionJob, OutboxEvent, WorkerState
from app.features.canonical_schema import FlowObservation
from app.ingestion.schemas import (
    EnqueuedEvent,
    IngestionBatchResponse,
    IngestionEventResponse,
    IngestionStatusResponse,
    OutboxStatus,
    WorkerStatus,
)

ACTIVE_STATES = ("queued", "processing", "retrying")


class QueueFullError(RuntimeError):
    pass


class IdempotencyConflictError(RuntimeError):
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


def enqueue_observations(
    observations: list[FlowObservation], session: Session, *, queue_limit: int
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
        session.add(
            IngestionJob(
                batch_id=batch_id,
                event_id=event_id,
                payload_hash=digest,
                payload=payload,
                state="queued",
            )
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
    return IngestionEventResponse(
        event_id=row.event_id,
        batch_id=row.batch_id,
        state=row.state,
        attempts=row.attempts,
        available_at=row.available_at,
        lease_expires_at=row.lease_expires_at,
        last_error=row.last_error,
        created_at=row.created_at,
        updated_at=row.updated_at,
        completed_at=row.completed_at,
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
        row.state = "retrying"
        row.available_at = now
        row.lease_expires_at = None
        row.worker_id = None
        row.last_error = "processing lease expired; recovered for retry"
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
    row.state = "processing"
    row.attempts += 1
    row.worker_id = worker_id
    row.lease_expires_at = now + timedelta(seconds=lease_seconds)
    row.updated_at = now
    session.commit()
    return row


def heartbeat(session: Session, worker_id: str) -> None:
    now = now_utc()
    row = session.get(WorkerState, worker_id)
    if row is None:
        session.add(WorkerState(worker_id=worker_id, last_heartbeat_at=now))
    else:
        row.last_heartbeat_at = now
    session.commit()
