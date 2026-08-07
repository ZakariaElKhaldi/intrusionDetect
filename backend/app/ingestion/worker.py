from __future__ import annotations

import os
import signal
import time
from datetime import timedelta
from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.database.models import IngestionJob, OutboxEvent
from app.database.session import create_engine_and_session
from app.features.canonical_schema import FlowObservation
from app.inference.model_registry import ModelRegistry
from app.ingestion.service import (
    claim_next_job,
    heartbeat,
    now_utc,
    recover_expired_leases,
)
from app.service import stage_observation

RETRY_DELAYS_SECONDS = (1, 5, 30)


class PermanentIngestionError(RuntimeError):
    """An event cannot succeed without changing its immutable payload or artifacts."""


def validate_extractor_compatibility(
    observation: FlowObservation, registry: ModelRegistry
) -> None:
    context = observation.network_context
    fingerprint = context.extractor_fingerprint if context else None
    from_pcap = observation.source.casefold().startswith("pcap") or fingerprint is not None
    if not from_pcap:
        return
    if not fingerprint:
        raise PermanentIngestionError(
            "PCAP-derived observations require an extractor fingerprint"
        )
    for stage, predictor in (
        ("detector", registry.detector),
        ("classifier", registry.classifier),
    ):
        approved = predictor.metadata.get("approved_extractor_fingerprints", [])
        legacy = predictor.metadata.get("extractor_fingerprint")
        if isinstance(approved, str):
            approved = [approved]
        if legacy:
            approved = [*approved, legacy]
        if fingerprint not in approved:
            raise PermanentIngestionError(
                f"{stage} model {predictor.version} is not approved for extractor "
                f"fingerprint {fingerprint}"
            )


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
                staged = stage_observation(observation, session, self.registry)
                for event in staged.events:
                    session.add(
                        OutboxEvent(
                            event_id=str(observation.event_id),
                            event_type=event["type"],
                            payload=event,
                        )
                    )
                job.state = "succeeded"
                job.completed_at = now_utc()
                job.lease_expires_at = None
                job.worker_id = None
                job.last_error = None
                session.commit()
            return True
        except Exception as exc:
            with self.session_factory() as session:
                job = session.get(IngestionJob, job_id)
                if job is None:
                    raise
                now = now_utc()
                job.last_error = f"{type(exc).__name__}: {exc}"[:10_000]
                job.lease_expires_at = None
                job.worker_id = None
                permanent = isinstance(exc, (PermanentIngestionError, ValueError))
                if permanent or job.attempts > len(RETRY_DELAYS_SECONDS):
                    job.state = "dead_letter"
                    job.completed_at = now
                else:
                    job.state = "retrying"
                    job.available_at = now + timedelta(
                        seconds=RETRY_DELAYS_SECONDS[job.attempts - 1]
                    )
                session.commit()
            return True


def run_worker() -> None:
    settings = Settings.from_env()
    engine, session_factory = create_engine_and_session(settings.database_url)
    registry = ModelRegistry(
        settings.model_artifact_path,
        settings.model_dir,
        allow_fallback=settings.allow_fallback,
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
