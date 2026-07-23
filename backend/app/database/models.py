from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class Observation(Base):
    __tablename__ = "observations"

    event_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    schema_version: Mapped[str] = mapped_column(String(64), index=True)
    flow_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    flow_ended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    source: Mapped[str] = mapped_column(String(64), index=True)
    raw_features: Mapped[dict] = mapped_column(JSON)
    ground_truth: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    prediction: Mapped[Prediction | None] = relationship(back_populates="observation")


class Prediction(Base):
    __tablename__ = "predictions"

    prediction_id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    event_id: Mapped[str] = mapped_column(
        ForeignKey("observations.event_id"), unique=True, index=True
    )
    model_version: Mapped[str] = mapped_column(String(128), index=True)
    binary_prediction: Mapped[str] = mapped_column(String(16), index=True)
    attack_class: Mapped[str | None] = mapped_column(String(128), nullable=True)
    confidence: Mapped[float] = mapped_column(Float)
    latency_ms: Mapped[float] = mapped_column(Float)
    end_to_end_latency_ms: Mapped[float] = mapped_column(Float)
    top_features: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    observation: Mapped[Observation] = relationship(back_populates="prediction")
    alert: Mapped[Alert | None] = relationship(back_populates="prediction")


class Alert(Base):
    __tablename__ = "alerts"

    alert_id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    event_id: Mapped[str] = mapped_column(ForeignKey("observations.event_id"), index=True)
    prediction_id: Mapped[str] = mapped_column(
        ForeignKey("predictions.prediction_id"), unique=True
    )
    severity: Mapped[str] = mapped_column(String(16), index=True)
    reasons: Mapped[list] = mapped_column(JSON, default=list)
    top_features: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(24), default="new", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    prediction: Mapped[Prediction] = relationship(back_populates="alert")
    feedback: Mapped[list[AnalystFeedback]] = relationship(back_populates="alert")


class ModelVersion(Base):
    __tablename__ = "model_versions"

    model_version: Mapped[str] = mapped_column(String(128), primary_key=True)
    model_type: Mapped[str] = mapped_column(String(128))
    artifact_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    schema_version: Mapped[str] = mapped_column(String(64))
    active: Mapped[bool] = mapped_column(Boolean, default=False)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AnalystFeedback(Base):
    __tablename__ = "analyst_feedback"

    feedback_id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    alert_id: Mapped[str] = mapped_column(ForeignKey("alerts.alert_id"), index=True)
    analyst: Mapped[str] = mapped_column(String(128))
    status: Mapped[str] = mapped_column(String(24))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    alert: Mapped[Alert] = relationship(back_populates="feedback")

