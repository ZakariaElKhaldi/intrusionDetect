from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

ModelHealthStatus = Literal[
    "blocked",
    "incompatible_source",
    "collecting",
    "healthy",
    "warning",
    "critical",
]


class ModelHealthSnapshotResponse(BaseModel):
    status: ModelHealthStatus
    reason: str
    window: Literal["fast", "slow"]
    cohort: dict[str, Any] = Field(default_factory=dict)
    reference: dict[str, Any] = Field(default_factory=dict)
    observation_count: int = 0
    aggregate: dict[str, Any] = Field(default_factory=dict)
    features: list[dict[str, Any]] = Field(default_factory=list)
    unseen_categories: list[dict[str, Any]] = Field(default_factory=list)
    outputs: dict[str, Any] = Field(default_factory=dict)
    quality: dict[str, Any] = Field(default_factory=dict)
    performance: dict[str, Any] = Field(default_factory=dict)
    checked_at: datetime
    shadow_mode: bool = True


class ModelHealthHistoryPoint(BaseModel):
    checked_at: datetime
    status: ModelHealthStatus
    observation_count: int
    aggregate_score: float | None
    aggregate_threshold: float | None
    feature_alarm_count: int = 0
    output_alarm_count: int = 0
    output_aggregate_score: float | None = None


class ModelHealthHistoryResponse(BaseModel):
    items: list[ModelHealthHistoryPoint]
    limit: int
    next_cursor: str | None = None


class ModelHealthCohortsResponse(BaseModel):
    items: list[dict[str, Any]] = Field(default_factory=list)
