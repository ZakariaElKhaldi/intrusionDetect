from __future__ import annotations

import os
import signal
import time
from datetime import timedelta
from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.database.models import IngestionJob, OutboxEvent
from app.database.schema import verify_schema_current
from app.database.session import create_engine_and_session
from app.features.canonical_schema import FlowObservation
from app.inference.model_registry import ModelRegistry, ModelRouteError
from app.ingestion.service import (
    claim_next_job,
    heartbeat,
    now_utc,
    record_transition,
    recover_expired_leases,
)
from app.service import stage_observation

RETRY_DELAYS_SECONDS = (1, 5, 30)


class PermanentIngestionError(RuntimeError):
    """An event cannot succeed without changing its immutable payload or artifacts."""


def classify_failure(exc: Exception) -> tuple[str, bool]:
    message = str(exc).casefold()
    if isinstance(exc, PermanentIngestionError):
        if "extractor" in message or "fingerprint" in message:
            return "extractor_incompatible", False
        if "canonical schema" in message:
            return "schema_invalid", False
        return "permanent_ingestion_error", False
    if isinstance(exc, ValueError):
        return "validation_error", False
    if isinstance(exc, TimeoutError):
        return "inference_timeout", True
    return "inference_error", True


def validate_extractor_compatibility(
    observation: FlowObservation, registry: ModelRegistry
) -> None:
    context = observation.network_context
    fingerprint = context.extractor_fingerprint if context else None
    try:
        registry.resolve_route(observation.schema_version, fingerprint)
    except ModelRouteError as exc:
        raise PermanentIngestionError(str(exc)) from exc


class IngestionWorker:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        registry: ModelRegistry,
        *,
        lease_seconds: int = 60,
        worker_id: str | None = None,
    ) -> None:
        self.session_factory = session_factory
        self.registry = registry
        self.lease_seconds = lease_seconds
        self.worker_id = worker_id or f"worker-{os.getpid()}-{uuid4().hex[:8]}"

    def heartbeat(self) -> None:
        with self.session_factory() as session:
            heartbeat(session, self.worker_id)

    def recover_expired(self) -> int:
        with self.session_factory() as session:
            return recover_expired_leases(session)

    def process_one(self) -> bool:
        self.heartbeat()
        with self.session_factory() as session:
            job = claim_next_job(
                session,
                worker_id=self.worker_id,
                lease_seconds=self.lease_seconds,
            )
            if job is None:
                return False
            job_id = job.job_id

        try:
            with self.session_factory() as session:
                job = session.get(IngestionJob, job_id)
                if job is None or job.state != "processing":
                    return False
                try:
                    observation = FlowObservation.model_validate(job.payload)
                except Exception as exc:
                    raise PermanentIngestionError(
                        f"stored observation no longer satisfies the canonical schema: {exc}"
                    ) from exc
                validate_extractor_compatibility(observation, self.registry)
                staged = stage_observation(
                    observation,
                    session,
                    self.registry,
                    ingestion_channel=job.ingestion_channel,
                )
                for event in staged.events:
                    session.add(
                        OutboxEvent(
                            event_id=str(observation.event_id),
                            event_type=event["type"],
                            payload=event,
                        )
                    )
                record_transition(
                    session,
                    job,
                    from_state="processing",
                    to_state="succeeded",
                    reason_code="processing_succeeded",
                    worker_id=self.worker_id,
                    details={"outbox_events": len(staged.events)},
                )
                job.state = "succeeded"
                job.completed_at = now_utc()
                job.lease_expires_at = None
                job.worker_id = None
                job.last_error = None
                job.error_code = None
                job.retryable = None
                session.commit()
            return True
        except Exception as exc:
            with self.session_factory() as session:
                job = session.get(IngestionJob, job_id)
                if job is None:
                    raise
                now = now_utc()
                job.last_error = f"{type(exc).__name__}: {exc}"[:10_000]
                error_code, retryable = classify_failure(exc)
                job.error_code = error_code
                job.retryable = retryable
                job.lease_expires_at = None
                job.worker_id = None
                if not retryable or job.attempts > len(RETRY_DELAYS_SECONDS):
                    record_transition(
                        session,
                        job,
                        from_state="processing",
                        to_state="dead_letter",
                        reason_code=(
                            "permanent_failure" if not retryable else "retries_exhausted"
                        ),
                        error_code=error_code,
                        retryable=retryable,
                        worker_id=self.worker_id,
                        reason=job.last_error,
                        details={"attempt": job.attempts},
                    )
                    job.state = "dead_letter"
                    job.completed_at = now
                else:
                    delay = RETRY_DELAYS_SECONDS[job.attempts - 1]
                    record_transition(
                        session,
                        job,
                        from_state="processing",
                        to_state="retrying",
                        reason_code="retry_scheduled",
                        error_code=error_code,
                        retryable=True,
                        worker_id=self.worker_id,
                        reason=job.last_error,
                        details={"attempt": job.attempts, "delay_seconds": delay},
                    )
                    job.state = "retrying"
                    job.available_at = now + timedelta(seconds=delay)
                session.commit()
            return True


def run_worker() -> None:
    settings = Settings.from_env()
    settings.validate()
    engine, session_factory = create_engine_and_session(settings.database_url)
    verify_schema_current(engine)
    registry = ModelRegistry(
        settings.model_artifact_path,
        settings.model_dir,
        allow_fallback=settings.allow_fallback,
        nfstream_model_dir=settings.nfstream_model_dir,
    )
    worker = IngestionWorker(
        session_factory,
        registry,
        lease_seconds=settings.worker_lease_seconds,
    )
    stopping = False

    def stop(_signum: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    worker.recover_expired()
    try:
        while not stopping:
            processed = worker.process_one()
            if not processed:
                time.sleep(settings.worker_poll_seconds)
    finally:
        engine.dispose()


if __name__ == "__main__":
    run_worker()
