from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class AlertResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    alert_id: UUID
    event_id: UUID
    severity: str
    reasons: list[str]
    top_features: list[dict]
    status: str
    created_at: datetime
    model_version: str
    detector_model_version: str
    classifier_model_version: str | None
    binary_prediction: str
    attack_class: str | None
    confidence: float
    detection_score: float
    attack_class_score: float | None
    detector_latency_ms: float
    classifier_latency_ms: float | None
    total_latency_ms: float
    raw_features: dict
    network_context: dict | None = None


class FeedbackRequest(BaseModel):
    status: Literal["new", "investigating", "confirmed", "false_positive", "resolved"]
    notes: str | None = Field(default=None, max_length=10_000)


class FeedbackResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    feedback_id: UUID
    alert_id: UUID
    analyst: str
    status: str
    notes: str | None
    created_at: datetime


class AlertDetail(AlertResponse):
    feedback: list[FeedbackResponse]


class AlertPageFilters(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    severity: str | None = None
    status: str | None = None
    family: str | None = None
    q: str | None = None
    from_time: datetime | None = Field(default=None, alias="from")
    to_time: datetime | None = Field(default=None, alias="to")


class AlertPage(BaseModel):
    items: list[AlertResponse]
    total: int
    limit: int
    offset: int
    has_more: bool
    filters: AlertPageFilters
