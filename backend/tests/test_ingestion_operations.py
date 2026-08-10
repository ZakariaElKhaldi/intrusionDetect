from __future__ import annotations

from datetime import timedelta

import httpx
import pytest
from conftest import observation
from sqlalchemy import select

from app.database.models import IngestionJob, IngestionJobTransition, OutboxEvent
from app.features.canonical_schema import FlowObservation
from app.ingestion.service import (
    RedriveRefusedError,
    enqueue_observations,
    now_utc,
    redrive_events,
)


@pytest.mark.anyio
async def test_jobs_api_filters_pages_and_returns_transition_evidence(
    client: httpx.AsyncClient,
) -> None:
    first = observation()
    second = observation()
    second["source"] = "second-source"
    assert (await client.post("/api/v1/ingestion/events", json=[first, second])).status_code == 202

    page = await client.get(
        "/api/v1/ingestion/jobs", params={"source": "second-source", "limit": 1}
    )
    assert page.status_code == 200
    assert page.json()["total"] == 1
    assert page.json()["limit"] == 1
    assert page.json()["items"][0]["schema_version"] == "rt-iot2022-v1"

    detail = await client.get(f"/api/v1/ingestion/events/{second['event_id']}")
    assert detail.status_code == 200
    transition = detail.json()["transitions"][0]
    assert transition["action"] == "enqueued"
    assert transition["from_state"] is None
    assert transition["to_state"] == "queued"
    assert transition["created_at"]

    invalid = await client.get("/api/v1/ingestion/jobs", params={"cursor": "not-a-cursor"})
    assert invalid.status_code == 422


@pytest.mark.anyio
async def test_outbox_api_distinguishes_pending_failed_and_published(client) -> None:
    sessions = client._transport.app.state.SessionLocal  # type: ignore[attr-defined]
    event_id = observation()["event_id"]
    with sessions() as session:
        session.add_all(
            [
                OutboxEvent(event_id=event_id, event_type="pending", payload={}),
                OutboxEvent(
                    event_id=event_id,
                    event_type="failed",
                    payload={},
                    publish_attempts=2,
                    last_error="stream unavailable",
                ),
                OutboxEvent(
                    event_id=event_id,
                    event_type="published",
                    payload={},
                    publish_attempts=1,
                    published_at=now_utc(),
                ),
            ]
        )
        session.commit()

    response = await client.get("/api/v1/ingestion/outbox/events", params={"status": "failed"})
    assert response.status_code == 200
    assert response.json()["total"] == 1
    item = response.json()["items"][0]
    assert item["status"] == "failed"
    assert item["claimed"] is False
    assert item["claim_expires_at"] is None
    assert item["next_attempt_at"] is None


@pytest.mark.anyio
async def test_redrive_api_previews_then_audits_authenticated_operator(client) -> None:
    payload = observation()
    accepted = await client.post("/api/v1/ingestion/events", json=[payload])
    assert accepted.status_code == 202
    sessions = client._transport.app.state.SessionLocal  # type: ignore[attr-defined]
    with sessions() as session:
        job = session.scalar(
            select(IngestionJob).where(IngestionJob.event_id == payload["event_id"])
        )
        job.state = "dead_letter"
        job.error_code = "inference_timeout"
        job.retryable = True
        job.last_error = "temporary timeout"
        job.completed_at = now_utc()
        session.commit()

    body = {
        "event_ids": [payload["event_id"]],
        "reason": "model service recovered",
        "dry_run": True,
    }
    preview = await client.post("/api/v1/ingestion/jobs/redrive", json=body)
    assert preview.status_code == 200
    assert preview.json()["results"][0]["eligible"] is True
    with sessions() as session:
        assert session.scalar(select(IngestionJob)).state == "dead_letter"

    body["dry_run"] = False
    executed = await client.post("/api/v1/ingestion/jobs/redrive", json=body)
    assert executed.status_code == 200
    detail = await client.get(f"/api/v1/ingestion/events/{payload['event_id']}")
    transition = detail.json()["transitions"][-1]
    assert transition["action"] == "manual_redrive"
    assert transition["actor"] == "admin"


def test_manual_redrive_is_atomic_audited_and_preserves_payload_hash(tmp_path) -> None:
    from app.database.models import Base
    from app.database.session import create_engine_and_session

    engine, sessions = create_engine_and_session(f"sqlite:///{tmp_path / 'redrive.db'}")
    Base.metadata.create_all(engine)
    payload = FlowObservation.model_validate(observation())
    with sessions() as session:
        enqueue_observations([payload], session, queue_limit=10)
        job = session.scalar(select(IngestionJob))
        original_hash = job.payload_hash
        job.state = "dead_letter"
        job.attempts = 4
        job.completed_at = now_utc()
        job.error_code = "inference_timeout"
        job.retryable = True
        job.last_error = "TimeoutError: inference timed out"
        session.commit()

    with sessions() as session:
        result = redrive_events(
            session,
            [str(payload.event_id)],
            operator="on-call@example.test",
            reason="model service recovered",
        )
        assert result[0]["eligible"] is True

    with sessions() as session:
        job = session.scalar(select(IngestionJob))
        assert job.state == "queued"
        assert job.attempts == 0
        assert job.redrive_count == 1
        assert job.payload_hash == original_hash
        transition = session.scalar(
            select(IngestionJobTransition).where(
                IngestionJobTransition.reason_code == "manual_redrive"
            )
        )
        assert transition.operator == "on-call@example.test"
        assert transition.details["previous_attempts"] == 4

        job.state = "processing"
        job.lease_expires_at = now_utc() + timedelta(minutes=1)
        session.commit()
        with pytest.raises(RedriveRefusedError, match="not dead_letter"):
            redrive_events(
                session,
                [str(payload.event_id)],
                operator="on-call@example.test",
                reason="must not bypass lease",
            )
    engine.dispose()


def test_redrive_dry_run_never_mutates_and_rejects_permanent_failure(tmp_path) -> None:
    from app.database.models import Base
    from app.database.session import create_engine_and_session

    engine, sessions = create_engine_and_session(f"sqlite:///{tmp_path / 'dry-run.db'}")
    Base.metadata.create_all(engine)
    payload = FlowObservation.model_validate(observation())
    with sessions() as session:
        enqueue_observations([payload], session, queue_limit=10)
        job = session.scalar(select(IngestionJob))
        job.state = "dead_letter"
        job.error_code = "schema_invalid"
        job.retryable = False
        session.commit()
        result = redrive_events(
            session,
            [str(payload.event_id)],
            operator="auditor",
            reason="eligibility check",
            dry_run=True,
        )
        assert result[0]["eligible"] is False

    with sessions() as session:
        job = session.scalar(select(IngestionJob))
        assert job.state == "dead_letter"
        assert job.redrive_count == 0
    engine.dispose()
