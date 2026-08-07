from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

IngestionState = Literal[
    "queued", "processing", "retrying", "succeeded", "dead_letter"
]


class EnqueuedEvent(BaseModel):
    event_id: UUID
    state: IngestionState
    disposition: Literal["accepted", "duplicate"]


class IngestionBatchResponse(BaseModel):
    batch_id: UUID
    events: list[EnqueuedEvent]


class IngestionTransitionResponse(BaseModel):
    transition_id: UUID
    from_state: IngestionState | None
    to_state: IngestionState
    reason_code: str
    error_code: str | None
    retryable: bool | None
    worker_id: str | None
    operator: str | None
    reason: str | None
    details: dict
    occurred_at: datetime
    action: str
    attempt: int | None
    actor: str | None
    created_at: datetime


class IngestionEventResponse(BaseModel):
    event_id: UUID
    batch_id: UUID
    state: IngestionState
    attempts: int
    available_at: datetime
    lease_expires_at: datetime | None
    last_error: str | None
    error_code: str | None
    retryable: bool | None
    redrive_count: int
    last_redriven_at: datetime | None
    last_redriven_by: str | None
    last_redrive_reason: str | None
    source: str
    schema_version: str
    extractor_fingerprint: str | None
    model_version: str | None
    transitions: list[IngestionTransitionResponse]
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None


class IngestionJobSummary(BaseModel):
    event_id: UUID
    batch_id: UUID
    state: IngestionState
    attempts: int
    source: str
    schema_version: str
    extractor_fingerprint: str | None
    error_code: str | None
    retryable: bool | None
    redrive_count: int
    last_error: str | None
    available_at: datetime
    lease_expires_at: datetime | None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None


class IngestionJobListResponse(BaseModel):
    items: list[IngestionJobSummary]
    total: int
    limit: int
    next_cursor: str | None


class OutboxEventResponse(BaseModel):
    outbox_id: UUID
    event_id: UUID
    event_type: str
    status: Literal["pending", "published", "failed"]
    publish_attempts: int
    last_error: str | None
    created_at: datetime
    published_at: datetime | None


class OutboxEventListResponse(BaseModel):
    items: list[OutboxEventResponse]
    total: int
    limit: int
    next_cursor: str | None


class ComponentStatus(BaseModel):
    status: Literal["ready", "degraded", "blocked"]
    reason: str


class WorkerStatus(ComponentStatus):
    last_heartbeat_at: datetime | None


class OutboxStatus(ComponentStatus):
    pending: int
    published: int
    oldest_pending_age_seconds: float | None


class IngestionStatusResponse(BaseModel):
    queue_depth: int
    queued: int
    processing: int
    retrying: int
    succeeded: int
    dead_letter: int
    retries: int
    failures: int
    oldest_pending_age_seconds: float | None
    throughput_per_minute: int
    worker: WorkerStatus
    outbox: OutboxStatus
    generated_at: datetime
