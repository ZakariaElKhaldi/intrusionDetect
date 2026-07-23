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
    binary_prediction: str
    attack_class: str | None
    confidence: float
    raw_features: dict


class FeedbackRequest(BaseModel):
    analyst: str = Field(min_length=1, max_length=128)
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
