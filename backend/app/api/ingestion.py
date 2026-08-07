from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import TypeAdapter, ValidationError

from app.features.canonical_schema import FlowObservation
from app.ingestion.schemas import (
    IngestionBatchResponse,
    IngestionEventResponse,
    IngestionStatusResponse,
)
from app.ingestion.service import (
    IdempotencyConflictError,
    QueueFullError,
    enqueue_observations,
    get_event,
    ingestion_status,
)

router = APIRouter(prefix="/ingestion", tags=["ingestion"])
OBSERVATIONS = TypeAdapter(list[FlowObservation])
MAX_REQUEST_BYTES = 50 * 1024 * 1024


async def _bounded_body(request: Request) -> bytes:
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_REQUEST_BYTES:
        raise HTTPException(status_code=413, detail="ingestion request body is too large")
    chunks = bytearray()
    async for chunk in request.stream():
        chunks.extend(chunk)
        if len(chunks) > MAX_REQUEST_BYTES:
            raise HTTPException(status_code=413, detail="ingestion request body is too large")
    return bytes(chunks)


async def _parse_observations(request: Request) -> list[FlowObservation]:
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip()
    try:
        body = await _bounded_body(request)
        if content_type == "application/x-ndjson":
            text_body = body.decode("utf-8")
            raw = [json.loads(line) for line in text_body.splitlines() if line.strip()]
        elif content_type in {"application/json", ""}:
            raw = json.loads(body)
            if isinstance(raw, dict):
                raw = raw.get("observations")
        else:
            raise HTTPException(
                status_code=415,
                detail="use application/json or application/x-ndjson",
            )
        observations = OBSERVATIONS.validate_python(raw)
    except (json.JSONDecodeError, UnicodeDecodeError, ValidationError, TypeError) as exc:
        detail = (
            exc.errors(include_context=False, include_url=False)
            if isinstance(exc, ValidationError)
            else str(exc)
        )
        raise HTTPException(status_code=422, detail=detail) from exc
    if not 1 <= len(observations) <= 1_000:
        raise HTTPException(status_code=422, detail="batch must contain 1 to 1000 observations")
    return observations


@router.post(
    "/events", response_model=IngestionBatchResponse, status_code=status.HTTP_202_ACCEPTED
)
async def ingest_events(request: Request, response: Response) -> IngestionBatchResponse:
    observations = await _parse_observations(request)
    with request.app.state.SessionLocal() as session:
        try:
            return enqueue_observations(
                observations,
                session,
                queue_limit=request.app.state.settings.ingestion_queue_limit,
            )
        except QueueFullError as exc:
            session.rollback()
            response.headers["Retry-After"] = "1"
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=str(exc),
                headers={"Retry-After": "1"},
            ) from exc
        except IdempotencyConflictError as exc:
            session.rollback()
            raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/events/{event_id}", response_model=IngestionEventResponse)
async def ingestion_event(event_id: str, request: Request) -> IngestionEventResponse:
    with request.app.state.SessionLocal() as session:
        result = get_event(session, event_id)
    if result is None:
        raise HTTPException(status_code=404, detail="ingestion event not found")
    return result


@router.get("/status", response_model=IngestionStatusResponse)
async def status_summary(request: Request) -> IngestionStatusResponse:
    with request.app.state.SessionLocal() as session:
        return ingestion_status(
            session, lease_seconds=request.app.state.settings.worker_lease_seconds
        )
