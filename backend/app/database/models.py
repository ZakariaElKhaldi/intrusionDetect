from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
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
    ingestion_channel: Mapped[str] = mapped_column(
        String(32), default="direct_prediction", index=True
    )
    extractor_fingerprint: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
    raw_features: Mapped[dict] = mapped_column(JSON)
    network_context: Mapped[dict | None] = mapped_column(JSON, nullable=True)
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
    detector_model_version: Mapped[str] = mapped_column(String(128), index=True)
    classifier_model_version: Mapped[str | None] = mapped_column(
        String(128), nullable=True, index=True
    )
    binary_prediction: Mapped[str] = mapped_column(String(16), index=True)
    attack_class: Mapped[str | None] = mapped_column(String(128), nullable=True)
    confidence: Mapped[float] = mapped_column(Float)
    detection_score: Mapped[float] = mapped_column(Float)
    attack_class_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    latency_ms: Mapped[float] = mapped_column(Float)
    detector_latency_ms: Mapped[float] = mapped_column(Float)
    classifier_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
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


class IngestionJob(Base):
    __tablename__ = "ingestion_jobs"

    job_id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    batch_id: Mapped[str] = mapped_column(String(36), index=True)
    event_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    payload_hash: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSON)
    ingestion_channel: Mapped[str] = mapped_column(
        String(32), default="http_ingestion", index=True
    )
    state: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    lease_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    worker_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    retryable: Mapped[bool | None] = mapped_column(Boolean, nullable=True, index=True)
    redrive_count: Mapped[int] = mapped_column(Integer, default=0)
    last_redriven_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_redriven_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_redrive_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    transitions: Mapped[list[IngestionJobTransition]] = relationship(
        back_populates="job",
        cascade="all, delete-orphan",
        order_by="IngestionJobTransition.occurred_at",
    )


class IngestionJobTransition(Base):
    __tablename__ = "ingestion_job_transitions"

    transition_id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    job_id: Mapped[str] = mapped_column(
        ForeignKey("ingestion_jobs.job_id", ondelete="CASCADE"), index=True
    )
    event_id: Mapped[str] = mapped_column(String(36), index=True)
    from_state: Mapped[str | None] = mapped_column(String(24), nullable=True)
    to_state: Mapped[str] = mapped_column(String(24), index=True)
    reason_code: Mapped[str] = mapped_column(String(64))
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    retryable: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    worker_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    operator: Mapped[str | None] = mapped_column(String(128), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
    job: Mapped[IngestionJob] = relationship(back_populates="transitions")


class OutboxEvent(Base):
    __tablename__ = "outbox_events"

    outbox_id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    event_id: Mapped[str] = mapped_column(String(36), index=True)
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    publish_attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class WorkerState(Base):
    __tablename__ = "worker_state"

    worker_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    last_heartbeat_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DriftSnapshot(Base):
    __tablename__ = "drift_snapshots"

    snapshot_id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    status: Mapped[str] = mapped_column(String(32), index=True)
    reason: Mapped[str] = mapped_column(Text)
    window: Mapped[str] = mapped_column(String(16), index=True)
    cohort_key: Mapped[str] = mapped_column(String(512), index=True)
    cohort: Mapped[dict] = mapped_column(JSON, default=dict)
    reference: Mapped[dict] = mapped_column(JSON, default=dict)
    observation_count: Mapped[int] = mapped_column(Integer, default=0)
    aggregate_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    aggregate_threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
    evidence: Mapped[dict] = mapped_column(JSON, default=dict)
    deployment_eligible: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    shadow_mode: Mapped[bool] = mapped_column(Boolean, default=True)
    checked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )


class ValidationFailure(Base):
    __tablename__ = "validation_failures"

    failure_id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    error_code: Mapped[str] = mapped_column(String(64), index=True)
    ingestion_channel: Mapped[str] = mapped_column(String(32), index=True)
    schema_version: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    extractor_fingerprint: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
