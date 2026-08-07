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


class IngestionEventResponse(BaseModel):
    event_id: UUID
    batch_id: UUID
    state: IngestionState
    attempts: int
    available_at: datetime
    lease_expires_at: datetime | None
    last_error: str | None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None


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
