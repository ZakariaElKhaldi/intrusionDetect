from __future__ import annotations

import io
import json
from datetime import timedelta

import httpx
import pytest
from conftest import MODEL_DIR, observation
from sqlalchemy import func, select

from app.config import Settings
from app.database.models import Base, IngestionJob, Observation, OutboxEvent, Prediction
from app.database.session import create_engine_and_session
from app.features.canonical_schema import FlowObservation
from app.inference.model_registry import ModelRegistry
from app.ingestion.outbox import dispatch_one
from app.ingestion.producer import iter_lines
from app.ingestion.service import enqueue_observations, now_utc, recover_expired_leases
from app.ingestion.worker import IngestionWorker
from app.main import create_app


@pytest.mark.anyio
async def test_json_and_ndjson_enqueue_are_idempotent(client: httpx.AsyncClient) -> None:
    payload = observation()
    payload["network_context"] = {
        "source_ip": "192.0.2.1",
        "destination_ip": "198.51.100.2",
        "source_port": 12345,
        "destination_port": 1883,
        "protocol": "tcp",
    }
    first = await client.post("/api/v1/ingestion/events", json=[payload])
    assert first.status_code == 202
    assert first.json()["events"][0]["disposition"] == "accepted"
    direct = await client.post(
        "/api/v1/predict",
        json={**payload, "event_id": observation()["event_id"]},
    )
    assert direct.status_code == 201
    assert direct.json()["network_context"]["source_ip"] == "192.0.2.1"

    duplicate = await client.post(
        "/api/v1/ingestion/events",
        content=json.dumps(payload) + "\n",
        headers={"Content-Type": "application/x-ndjson"},
    )
    assert duplicate.status_code == 202
    assert duplicate.json()["events"][0]["disposition"] == "duplicate"
    status = (await client.get("/api/v1/ingestion/status")).json()
    assert status["queue_depth"] == 1


@pytest.mark.anyio
async def test_conflict_and_invalid_batch_persist_nothing(client: httpx.AsyncClient) -> None:
    payload = observation()
    assert (
        await client.post("/api/v1/ingestion/events", json=[payload])
    ).status_code == 202
    conflicting = {**payload, "source": "different-source"}
    response = await client.post("/api/v1/ingestion/events", json=[conflicting])
    assert response.status_code == 409

    second = observation()
    invalid = observation()
    invalid["features"].pop(next(iter(invalid["features"])))
    response = await client.post(
        "/api/v1/ingestion/events", json=[second, invalid]
    )
    assert response.status_code == 422
    assert (await client.get("/api/v1/ingestion/status")).json()["queue_depth"] == 1


@pytest.mark.anyio
async def test_queue_limit_rejects_entire_batch(tmp_path) -> None:
    app = create_app(
        Settings(
            database_url=f"sqlite:///{tmp_path / 'capacity.db'}",
            model_dir=str(MODEL_DIR),
            allow_fallback=True,
            ingestion_queue_limit=1,
        )
    )
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/ingestion/events", json=[observation(), observation()]
            )
            assert response.status_code == 429
            assert response.headers["Retry-After"] == "1"
            assert (await client.get("/ingestion/status")).json()["queue_depth"] == 0


def _worker_fixture(tmp_path):
    engine, session_factory = create_engine_and_session(
        f"sqlite:///{tmp_path / 'worker.db'}"
    )
    Base.metadata.create_all(engine)
    registry = ModelRegistry(model_dir=str(MODEL_DIR), allow_fallback=True)
    return engine, session_factory, registry


def test_worker_commits_prediction_job_and_outbox_atomically(tmp_path) -> None:
    engine, sessions, registry = _worker_fixture(tmp_path)
    payload = observation()
    with sessions() as session:
        enqueue_observations(
            [FlowObservation.model_validate(payload)], session, queue_limit=10
        )
    worker = IngestionWorker(sessions, registry, worker_id="test-worker")
    assert worker.process_one() is True
    with sessions() as session:
        job = session.scalar(select(IngestionJob))
        stored = session.get(Observation, payload["event_id"])
        prediction_count = session.scalar(select(func.count()).select_from(Prediction))
        outbox_count = session.scalar(select(func.count()).select_from(OutboxEvent))
        assert job.state == "succeeded"
        assert stored is not None
        assert prediction_count == 1
        assert outbox_count >= 1
    engine.dispose()


def test_worker_uses_all_retry_delays_then_dead_letters(monkeypatch, tmp_path) -> None:
    engine, sessions, registry = _worker_fixture(tmp_path)
    with sessions() as session:
        enqueue_observations(
            [FlowObservation.model_validate(observation())], session, queue_limit=10
        )

    def fail(*_args, **_kwargs):
        raise RuntimeError("temporary inference failure")

    monkeypatch.setattr("app.ingestion.worker.stage_observation", fail)
    worker = IngestionWorker(sessions, registry, worker_id="retry-worker")
    expected_delays = [1, 5, 30]
    for attempt, expected_delay in enumerate(expected_delays, start=1):
        assert worker.process_one() is True
        with sessions() as session:
            job = session.scalar(select(IngestionJob))
            assert job.state == "retrying"
            available = job.available_at
            if available.tzinfo is None:
                available = available.replace(tzinfo=now_utc().tzinfo)
            delay = (available - now_utc()).total_seconds()
            assert expected_delay - 1 <= delay <= expected_delay
            job.available_at = now_utc() - timedelta(seconds=1)
            session.commit()
        assert attempt == job.attempts
    assert worker.process_one() is True
    with sessions() as session:
        job = session.scalar(select(IngestionJob))
        assert job.state == "dead_letter"
        assert job.attempts == 4
    engine.dispose()


def test_unapproved_pcap_extractor_is_permanent_failure(tmp_path) -> None:
    engine, sessions, registry = _worker_fixture(tmp_path)
    payload = observation()
    payload["source"] = "pcap-offline"
    payload["network_context"] = {"extractor_fingerprint": "unapproved"}
    with sessions() as session:
        enqueue_observations(
            [FlowObservation.model_validate(payload)], session, queue_limit=10
        )
    worker = IngestionWorker(sessions, registry, worker_id="pcap-worker")
    assert worker.process_one() is True
    with sessions() as session:
        job = session.scalar(select(IngestionJob))
        assert job.state == "dead_letter"
        assert job.attempts == 1
        assert "not approved" in job.last_error
        assert session.get(Observation, payload["event_id"]) is None
    engine.dispose()


def test_expired_processing_lease_is_recovered(tmp_path) -> None:
    engine, sessions, _registry = _worker_fixture(tmp_path)
    item = FlowObservation.model_validate(observation())
    with sessions() as session:
        enqueue_observations([item], session, queue_limit=10)
        job = session.scalar(select(IngestionJob))
        job.state = "processing"
        job.lease_expires_at = now_utc() - timedelta(seconds=1)
        session.commit()
    with sessions() as session:
        assert recover_expired_leases(session) == 1
        job = session.scalar(select(IngestionJob))
        assert job.state == "retrying"
        assert job.worker_id is None
    engine.dispose()


class RecordingLive:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.messages: list[dict] = []

    async def broadcast(self, message: dict) -> None:
        if self.fail:
            raise RuntimeError("stream unavailable")
        self.messages.append(message)


@pytest.mark.anyio
async def test_outbox_retries_publish_failure_without_losing_event(tmp_path) -> None:
    engine, sessions, _registry = _worker_fixture(tmp_path)
    with sessions() as session:
        session.add(
            OutboxEvent(
                event_id=observation()["event_id"],
                event_type="prediction.created",
                payload={"type": "prediction.created", "data": {"value": 1}},
            )
        )
        session.commit()
    assert await dispatch_one(sessions, RecordingLive(fail=True)) is True  # type: ignore[arg-type]
    with sessions() as session:
        row = session.scalar(select(OutboxEvent))
        assert row.published_at is None
        assert row.publish_attempts == 1
    healthy = RecordingLive()
    assert await dispatch_one(sessions, healthy) is True  # type: ignore[arg-type]
    assert healthy.messages == [{"type": "prediction.created", "data": {"value": 1}}]
    with sessions() as session:
        assert session.scalar(select(OutboxEvent)).published_at is not None
    engine.dispose()


def test_producer_follow_waits_for_a_complete_ndjson_line(monkeypatch) -> None:
    handle = io.StringIO('{"event_id":"partial"}')
    sleeps = 0

    def finish_line(_seconds: float) -> None:
        nonlocal sleeps
        sleeps += 1
        if sleeps == 1:
            handle.seek(0, io.SEEK_END)
            handle.write("\n")

    monkeypatch.setattr("app.ingestion.producer.time.sleep", finish_line)
    lines = iter_lines(handle, follow=True, poll_seconds=0.01)
    assert next(lines) == '{"event_id":"partial"}\n'
    assert sleeps == 1
