from __future__ import annotations

import json
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import TypeAdapter, ValidationError
from starlette.concurrency import run_in_threadpool

from app.api.auth import get_current_admin
from app.api.errors import safe_validation_details
from app.database.models import ValidationFailure
from app.features.canonical_schema import FlowObservation
from app.ingestion.schemas import (
    IngestionBatchResponse,
    IngestionEventResponse,
    IngestionJobListResponse,
    IngestionState,
    IngestionStatusResponse,
    OutboxEventListResponse,
    RedriveRequest,
    RedriveResponse,
)
from app.ingestion.service import (
    IdempotencyConflictError,
    QueueFullError,
    RedriveRefusedError,
    enqueue_observations,
    get_event,
    ingestion_status,
    list_jobs,
    list_outbox_events,
    redrive_events,
)

router = APIRouter(prefix="/ingestion", tags=["ingestion"])
OBSERVATIONS = TypeAdapter(list[FlowObservation])


async def _bounded_body(request: Request) -> bytes:
    max_request_bytes = request.app.state.settings.max_request_body_bytes
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > max_request_bytes:
        raise HTTPException(status_code=413, detail="ingestion request body is too large")
    chunks = bytearray()
    async for chunk in request.stream():
        chunks.extend(chunk)
        if len(chunks) > max_request_bytes:
            raise HTTPException(status_code=413, detail="ingestion request body is too large")
    return bytes(chunks)


def _decode_observations(body: bytes, content_type: str) -> list[FlowObservation]:
    if content_type == "application/x-ndjson":
        text_body = body.decode("utf-8")
        raw = [json.loads(line) for line in text_body.splitlines() if line.strip()]
    else:
        raw = json.loads(body)
        if isinstance(raw, dict):
            raw = raw.get("observations")
    return OBSERVATIONS.validate_python(raw)


async def _parse_observations(request: Request) -> list[FlowObservation]:
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip()
    if content_type not in {"application/x-ndjson", "application/json", ""}:
        raise HTTPException(
            status_code=415,
            detail="use application/json or application/x-ndjson",
        )
    body = await _bounded_body(request)
    try:
        observations = await run_in_threadpool(
            _decode_observations, body, content_type
        )
    except (json.JSONDecodeError, UnicodeDecodeError, ValidationError, TypeError) as exc:
        detail = (
            safe_validation_details(exc.errors())
            if isinstance(exc, ValidationError)
            else str(exc)
        )
        raise HTTPException(status_code=422, detail=detail) from exc
    if not 1 <= len(observations) <= 1_000:
        raise HTTPException(status_code=422, detail="batch must contain 1 to 1000 observations")
    return observations


async def _ingest(
    request: Request, response: Response, *, ingestion_channel: str
) -> IngestionBatchResponse:
    try:
        observations = await _parse_observations(request)
    except HTTPException as exc:
        if exc.status_code == 422:
            def record_validation_failure() -> None:
                with request.app.state.SessionLocal() as session:
                    session.add(
                        ValidationFailure(
                            error_code="schema_rejected",
                            ingestion_channel=ingestion_channel,
                            details={"status_code": 422},
                        )
                    )
                    session.commit()

            await run_in_threadpool(record_validation_failure)
        raise

    def enqueue() -> IngestionBatchResponse:
        with request.app.state.SessionLocal() as session:
            try:
                return enqueue_observations(
                    observations,
                    session,
                    queue_limit=request.app.state.settings.ingestion_queue_limit,
                    ingestion_channel=ingestion_channel,
                )
            except Exception:
                session.rollback()
                raise

    try:
        return await run_in_threadpool(enqueue)
    except QueueFullError as exc:
        response.headers["Retry-After"] = "1"
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(exc),
            headers={"Retry-After": "1"},
        ) from exc
    except IdempotencyConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

@router.post(
    "/events",
    response_model=IngestionBatchResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(get_current_admin)],
)
async def ingest_events(request: Request, response: Response) -> IngestionBatchResponse:
    return await _ingest(request, response, ingestion_channel="http_ingestion")


@router.post(
    "/offline-pcap/events",
    response_model=IngestionBatchResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(get_current_admin)],
)
async def ingest_offline_pcap_events(
    request: Request, response: Response
) -> IngestionBatchResponse:
    """Server-owned channel for the local, offline PCAP ingestion command."""
    return await _ingest(request, response, ingestion_channel="offline_pcap")


@router.post("/jobs/redrive", response_model=RedriveResponse)
def redrive_ingestion_jobs(
    payload: RedriveRequest,
    request: Request,
    operator: Annotated[str, Depends(get_current_admin)],
) -> RedriveResponse:
    def compatibility_check(raw: dict) -> None:
        observation = FlowObservation.model_validate(raw)
        context = observation.network_context
        fingerprint = context.extractor_fingerprint if context else None
        request.app.state.registry.resolve_route(
            observation.schema_version, fingerprint
        )

    with request.app.state.SessionLocal() as session:
        try:
            results = redrive_events(
                session,
                [str(event_id) for event_id in payload.event_ids],
                operator=operator,
                reason=payload.reason,
                compatibility_check=compatibility_check,
                dry_run=payload.dry_run,
            )
        except RedriveRefusedError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    return RedriveResponse(dry_run=payload.dry_run, results=results)


@router.get("/events/{event_id}", response_model=IngestionEventResponse)
def ingestion_event(event_id: str, request: Request) -> IngestionEventResponse:
    with request.app.state.SessionLocal() as session:
        result = get_event(session, event_id)
    if result is None:
        raise HTTPException(status_code=404, detail="ingestion event not found")
    return result


@router.get("/jobs", response_model=IngestionJobListResponse)
def ingestion_jobs(
    request: Request,
    state: IngestionState | None = None,
    error_code: str | None = Query(default=None, min_length=1, max_length=64),
    source: str | None = Query(default=None, min_length=1, max_length=64),
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    cursor: str | None = Query(default=None, max_length=1024),
    limit: int = Query(default=100, ge=1, le=500),
) -> IngestionJobListResponse:
    if created_from and created_to and created_from > created_to:
        raise HTTPException(status_code=422, detail="created_from must not follow created_to")
    with request.app.state.SessionLocal() as session:
        try:
            return list_jobs(
                session,
                state=state,
                error_code=error_code,
                source=source,
                created_from=created_from,
                created_to=created_to,
                cursor=cursor,
                limit=limit,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/outbox/events", response_model=OutboxEventListResponse)
def outbox_events(
    request: Request,
    status_filter: str | None = Query(
        default=None, alias="status", pattern="^(pending|failed|published)$"
    ),
    event_type: str | None = Query(default=None, min_length=1, max_length=64),
    cursor: str | None = Query(default=None, max_length=1024),
    limit: int = Query(default=100, ge=1, le=500),
) -> OutboxEventListResponse:
    with request.app.state.SessionLocal() as session:
        try:
            return list_outbox_events(
                session,
                status=status_filter,
                event_type=event_type,
                cursor=cursor,
                limit=limit,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/status", response_model=IngestionStatusResponse)
def status_summary(request: Request) -> IngestionStatusResponse:
    with request.app.state.SessionLocal() as session:
        return ingestion_status(
            session, lease_seconds=request.app.state.settings.worker_lease_seconds
        )
