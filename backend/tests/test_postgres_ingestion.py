from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest
from conftest import observation
from sqlalchemy import delete, func, select

from app.database.models import Base, IngestionJob, IngestionJobTransition, OutboxEvent
from app.database.session import create_engine_and_session
from app.features.canonical_schema import FlowObservation
from app.ingestion.outbox import _claim_one, _mark_published
from app.ingestion.service import (
    claim_next_job,
    enqueue_observations,
    now_utc,
    redrive_events,
)

pytestmark = pytest.mark.postgres


@pytest.fixture
def postgres_sessions():
    database_url = os.getenv("IOT_IDS_TEST_POSTGRES_URL")
    if not database_url:
        pytest.skip("set IOT_IDS_TEST_POSTGRES_URL to run PostgreSQL integration tests")
    if not database_url.startswith(("postgresql://", "postgresql+psycopg://")):
        pytest.fail("IOT_IDS_TEST_POSTGRES_URL must be a PostgreSQL URL")

    engine, sessions = create_engine_and_session(database_url)
    Base.metadata.create_all(engine)
    with sessions() as session:
        existing_jobs = session.scalar(select(func.count()).select_from(IngestionJob))
    if existing_jobs:
        engine.dispose()
        pytest.fail(
            "PostgreSQL integration tests require an empty disposable database"
        )
    try:
        yield sessions
    finally:
        engine.dispose()


def _delete_jobs(sessions, event_ids: list[str]) -> None:
    with sessions.begin() as session:
        session.execute(
            delete(IngestionJobTransition).where(
                IngestionJobTransition.event_id.in_(event_ids)
            )
        )
        session.execute(delete(IngestionJob).where(IngestionJob.event_id.in_(event_ids)))


def test_postgres_outbox_claim_allows_only_one_dispatcher(postgres_sessions) -> None:
    event_id = observation()["event_id"]
    with postgres_sessions.begin() as session:
        session.add(
            OutboxEvent(
                event_id=event_id,
                event_type="prediction.created",
                payload={"type": "prediction.created", "data": {}},
            )
        )

    start = Barrier(2)

    def claim():
        start.wait()
        return _claim_one(postgres_sessions, lease_seconds=30)

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            claims = [
                future.result(timeout=10)
                for future in (executor.submit(claim), executor.submit(claim))
            ]
        claimed = [claim for claim in claims if claim is not None]
        assert len(claimed) == 1
        assert _mark_published(postgres_sessions, claimed[0]) is True
        with postgres_sessions() as session:
            row = session.scalar(
                select(OutboxEvent).where(OutboxEvent.event_id == event_id)
            )
            assert row.published_at is not None
            assert row.publish_attempts == 1
    finally:
        with postgres_sessions.begin() as session:
            session.execute(delete(OutboxEvent).where(OutboxEvent.event_id == event_id))


def test_postgres_claim_skips_a_row_locked_by_another_worker(postgres_sessions) -> None:
    payloads = [FlowObservation.model_validate(observation()) for _ in range(2)]
    event_ids = [str(payload.event_id) for payload in payloads]
    try:
        with postgres_sessions() as session:
            enqueue_observations(payloads, session, queue_limit=100)
            first = session.scalar(
                select(IngestionJob).where(IngestionJob.event_id == event_ids[0])
            )
            second = session.scalar(
                select(IngestionJob).where(IngestionJob.event_id == event_ids[1])
            )
            first.created_at = now_utc() - timedelta(minutes=1)
            second.created_at = now_utc()
            session.commit()

        with postgres_sessions() as lock_session:
            locked = lock_session.scalar(
                select(IngestionJob)
                .where(IngestionJob.event_id == event_ids[0])
                .with_for_update()
            )
            assert locked is not None

            with postgres_sessions() as claimant_session:
                claimed = claim_next_job(
                    claimant_session, worker_id="postgres-worker-b", lease_seconds=60
                )
                assert claimed is not None
                assert claimed.event_id == event_ids[1]
            lock_session.rollback()

        with postgres_sessions() as session:
            first = session.scalar(
                select(IngestionJob).where(IngestionJob.event_id == event_ids[0])
            )
            second = session.scalar(
                select(IngestionJob).where(IngestionJob.event_id == event_ids[1])
            )
            assert first.state == "queued"
            assert first.attempts == 0
            assert second.state == "processing"
            assert second.attempts == 1
    finally:
        _delete_jobs(postgres_sessions, event_ids)


def test_postgres_redrive_and_claim_race_preserves_transition_order(
    postgres_sessions,
) -> None:
    payload = FlowObservation.model_validate(observation())
    event_id = str(payload.event_id)
    try:
        with postgres_sessions() as session:
            enqueue_observations([payload], session, queue_limit=100)
            job = session.scalar(
                select(IngestionJob).where(IngestionJob.event_id == event_id)
            )
            job.state = "dead_letter"
            job.error_code = "inference_timeout"
            job.retryable = True
            job.completed_at = now_utc()
            session.commit()

        start = Barrier(2)

        def redrive() -> None:
            with postgres_sessions() as session:
                start.wait()
                redrive_events(
                    session,
                    [event_id],
                    operator="postgres-integration-test",
                    reason="verify redrive and claim serialization",
                )

        def claim() -> str | None:
            with postgres_sessions() as session:
                start.wait()
                row = claim_next_job(
                    session, worker_id="postgres-race-worker", lease_seconds=60
                )
                return row.event_id if row else None

        with ThreadPoolExecutor(max_workers=2) as executor:
            redrive_future = executor.submit(redrive)
            claim_future = executor.submit(claim)
            redrive_future.result(timeout=10)
            claimed_event_id = claim_future.result(timeout=10)

        with postgres_sessions() as session:
            job = session.scalar(
                select(IngestionJob).where(IngestionJob.event_id == event_id)
            )
            transitions = list(
                session.scalars(
                    select(IngestionJobTransition)
                    .where(IngestionJobTransition.event_id == event_id)
                    .order_by(IngestionJobTransition.occurred_at)
                )
            )
            actions = [transition.reason_code for transition in transitions]
            assert job.redrive_count == 1
            assert actions.count("manual_redrive") == 1
            assert actions.count("claimed") <= 1
            if claimed_event_id == event_id:
                assert job.state == "processing"
                assert actions.index("manual_redrive") < actions.index("claimed")
            else:
                assert claimed_event_id is None
                assert job.state == "queued"
    finally:
        _delete_jobs(postgres_sessions, [event_id])
