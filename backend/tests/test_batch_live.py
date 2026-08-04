from __future__ import annotations

from typing import Any

import httpx
import pytest
from conftest import observation

from app.config import Settings
from app.database.models import Base
from app.database.session import create_engine_and_session
from app.features.canonical_schema import FlowObservation
from app.inference.model_registry import ModelRegistry
from app.live import LiveConnectionManager
from app.main import create_app
from app.service import process_observation


@pytest.mark.anyio
async def test_batch_prediction_and_versioned_alias(
    fallback_client: httpx.AsyncClient,
) -> None:
    normal_observation = observation()
    attack_observation = observation(attack=True)
    attack_observation["features"]["flow_SYN_flag_count"] = 100
    response = await fallback_client.post(
        "/api/v1/predict/batch",
        json={"observations": [normal_observation, attack_observation]},
    )
    assert response.status_code == 201
    predictions = response.json()["predictions"]
    assert len(predictions) == 2
    assert all(len(item["raw_features"]) == 83 for item in predictions)
    normal = next(item for item in predictions if item["binary_prediction"] == "normal")
    attack = next(item for item in predictions if item["binary_prediction"] == "attack")
    assert normal["classifier_model_version"] is None
    assert normal["classifier_latency_ms"] is None
    assert attack["classifier_model_version"] == "deterministic-fallback-classifier-v1"
    assert attack["attack_class_score"] == 0.5
    assert (await fallback_client.get("/api/v1/models")).status_code == 200
    assert (await fallback_client.get("/api/v1/alerts")).status_code == 200


class FakeSocket:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.messages: list[dict[str, Any]] = []

    async def send_json(self, message: dict[str, Any]) -> None:
        if self.fail:
            raise RuntimeError("disconnected")
        self.messages.append(message)


@pytest.mark.anyio
async def test_live_manager_broadcasts_and_removes_stale_connections() -> None:
    manager = LiveConnectionManager()
    healthy = FakeSocket()
    stale = FakeSocket(fail=True)
    manager.connections.update({healthy, stale})  # type: ignore[arg-type]
    await manager.broadcast({"type": "prediction", "data": {"event_id": "fixture"}})
    assert healthy.messages[0]["type"] == "prediction"
    assert stale not in manager.connections


@pytest.mark.anyio
async def test_service_broadcasts_authoritative_prediction_and_alert_events(
    tmp_path,
) -> None:
    engine, session_factory = create_engine_and_session(f"sqlite:///{tmp_path / 'events.db'}")
    Base.metadata.create_all(engine)
    live = LiveConnectionManager()
    socket = FakeSocket()
    live.connections.add(socket)  # type: ignore[arg-type]
    payload = observation(attack=True)
    payload["features"]["flow_SYN_flag_count"] = 100

    with session_factory() as session:
        response = await process_observation(
            FlowObservation.model_validate(payload),
            session,
            ModelRegistry(allow_fallback=True),
            live,
        )

    assert [message["type"] for message in socket.messages] == [
        "prediction.created",
        "alert.created",
    ]
    alert = socket.messages[1]["data"]
    assert alert["alert_id"] == str(response.alert_id)
    assert alert["severity"] in {"low", "medium", "high", "critical"}
    assert alert["attack_class"] == "suspicious_activity"
    assert alert["detector_model_version"] == "deterministic-fallback-v1"
    engine.dispose()


@pytest.mark.anyio
async def test_normal_prediction_broadcasts_no_alert_event(tmp_path) -> None:
    engine, session_factory = create_engine_and_session(f"sqlite:///{tmp_path / 'normal.db'}")
    Base.metadata.create_all(engine)
    live = LiveConnectionManager()
    socket = FakeSocket()
    live.connections.add(socket)  # type: ignore[arg-type]
    payload = observation()
    payload["features"]["flow_SYN_flag_count"] = 0
    payload["features"]["flow_RST_flag_count"] = 0
    payload["features"]["flow_pkts_per_sec"] = 0

    with session_factory() as session:
        response = await process_observation(
            FlowObservation.model_validate(payload),
            session,
            ModelRegistry(allow_fallback=True),
            live,
        )

    assert response.binary_prediction == "normal"
    assert response.alert_id is None
    assert [message["type"] for message in socket.messages] == ["prediction.created"]
    engine.dispose()


@pytest.mark.anyio
async def test_batch_failure_rolls_back_every_row_and_broadcasts_nothing(tmp_path) -> None:
    app = create_app(
        Settings(
            database_url=f"sqlite:///{tmp_path / 'atomic.db'}",
            allow_fallback=True,
            instance_id="atomic-test",
        )
    )
    socket = FakeSocket()
    app.state.live.connections.add(socket)  # type: ignore[arg-type]
    duplicate = observation()
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/predict/batch", json={"observations": [duplicate, duplicate]}
            )
            assert response.status_code == 409
            summary = (await client.get("/dashboard/summary", params={"range": "all"})).json()
            assert summary["predictions"]["total"] == 0
            assert (await client.get("/alerts")).json() == []
    assert socket.messages == []
