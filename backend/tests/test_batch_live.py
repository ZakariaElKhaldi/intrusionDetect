from __future__ import annotations

import asyncio
import json
import threading
import time
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from conftest import observation

from app.api.auth import create_access_token
from app.api.live import live as live_endpoint
from app.config import Settings
from app.database.models import Base
from app.database.session import create_engine_and_session
from app.features.canonical_schema import FlowObservation
from app.inference.model_registry import ModelRegistry
from app.live import LiveConnectionManager
from app.main import create_app
from app.service import broadcast_staged, persist_observations


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
    assert normal["detection_score_calibrated"] is False
    assert normal["attack_class_score_calibrated"] is None
    assert attack["classifier_model_version"] == "deterministic-fallback-classifier-v1"
    assert attack["attack_class_score"] == 0.5
    assert attack["detection_score_calibrated"] is False
    assert attack["attack_class_score_calibrated"] is False
    assert (await fallback_client.get("/api/v1/models")).status_code == 200
    assert (await fallback_client.get("/api/v1/alerts")).status_code == 200


@pytest.mark.anyio
async def test_blocked_inference_transaction_does_not_stall_liveness(
    fallback_client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api import predictions as prediction_api

    original = prediction_api.persist_observations
    release = threading.Event()

    def delayed_persistence(*args, **kwargs):
        release.wait(timeout=0.75)
        return original(*args, **kwargs)

    monkeypatch.setattr(prediction_api, "persist_observations", delayed_persistence)
    timer = threading.Timer(0.75, release.set)
    timer.start()
    started = time.perf_counter()
    prediction_task = asyncio.create_task(
        fallback_client.post(
            "/predict/batch",
            json={"observations": [observation()]},
        )
    )
    await asyncio.sleep(0.05)
    scheduling_delay = time.perf_counter() - started
    liveness = await asyncio.wait_for(fallback_client.get("/livez"), timeout=0.4)
    release.set()
    prediction = await prediction_task
    timer.cancel()

    assert scheduling_delay < 0.4
    assert liveness.status_code == 200
    assert prediction.status_code == 201


class FakeSocket:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.messages: list[dict[str, Any]] = []

    async def send_json(self, message: dict[str, Any]) -> None:
        if self.fail:
            raise RuntimeError("disconnected")
        self.messages.append(message)


class FakeConnectSocket(FakeSocket):
    def __init__(self) -> None:
        super().__init__()
        self.accepted = False
        self.closed: tuple[int, str] | None = None

    async def accept(self) -> None:
        self.accepted = True

    async def close(self, *, code: int, reason: str) -> None:
        self.closed = (code, reason)


class FakeCounter:
    def __init__(self) -> None:
        self.value = 0

    def inc(self) -> None:
        self.value += 1


class FakePolicySocket(FakeConnectSocket):
    def __init__(
        self, *, origin: str | None, messages: list[str], auth_enabled: bool = False
    ) -> None:
        super().__init__()
        self.headers = {"origin": origin} if origin is not None else {}
        self.incoming = iter(messages)
        self.manager = LiveConnectionManager()
        self.origin_rejections = FakeCounter()
        self.connection_rejections = FakeCounter()
        self.app = SimpleNamespace(
            state=SimpleNamespace(
                settings=SimpleNamespace(
                    cors_origins=("https://console.example",),
                    auth_enabled=auth_enabled,
                    admin_username="admin",
                    secret_key="test-secret-key-that-is-at-least-32-bytes",
                ),
                metrics=SimpleNamespace(
                    live_origin_rejections=self.origin_rejections,
                    live_connection_rejections=self.connection_rejections,
                ),
                live=self.manager,
            )
        )

    async def receive_text(self) -> str:
        return next(self.incoming)


@pytest.mark.anyio
async def test_live_manager_rejects_connections_above_capacity() -> None:
    manager = LiveConnectionManager(max_connections=1)
    first = FakeConnectSocket()
    excess = FakeConnectSocket()

    assert await manager.connect(first) is True  # type: ignore[arg-type]
    assert await manager.connect(excess) is False  # type: ignore[arg-type]
    assert first in manager.connections
    assert first.messages == [{"type": "connection", "status": "connected"}]
    assert excess not in manager.connections
    assert excess.closed == (1013, "live connection capacity reached")


@pytest.mark.anyio
async def test_live_manager_counts_pending_authentication_toward_capacity() -> None:
    manager = LiveConnectionManager(max_connections=1)
    assert await manager.reserve() is True
    assert manager.pending_connections == 1
    assert await manager.reserve() is False

    await manager.release_reservation()
    assert manager.pending_connections == 0
    assert await manager.reserve() is True

    connected = FakeConnectSocket()
    await connected.accept()
    assert await manager.connect(connected, accepted=True, reserved=True) is True
    assert manager.pending_connections == 0
    assert connected in manager.connections


@pytest.mark.anyio
async def test_live_endpoint_enforces_browser_origin_and_message_allowlists() -> None:
    rejected = FakePolicySocket(
        origin="https://attacker.example", messages=[]
    )
    await live_endpoint(rejected)  # type: ignore[arg-type]
    assert rejected.accepted is True
    assert rejected.closed == (1008, "origin is not allowed")
    assert rejected.origin_rejections.value == 1

    allowed = FakePolicySocket(
        origin="https://console.example", messages=["ping", "unsupported"]
    )
    await live_endpoint(allowed)  # type: ignore[arg-type]
    assert allowed.messages == [
        {"type": "connection", "status": "connected"},
        {"type": "pong"},
    ]
    assert allowed.closed == (1008, "unsupported live message")
    assert allowed not in allowed.manager.connections


@pytest.mark.anyio
async def test_live_endpoint_authenticates_first_message_without_url_credentials() -> None:
    rejected = FakePolicySocket(
        origin="https://console.example",
        messages=['{"type":"authenticate","token":"invalid"}'],
        auth_enabled=True,
    )
    await live_endpoint(rejected)  # type: ignore[arg-type]
    assert rejected.closed == (1008, "authentication required")
    assert rejected not in rejected.manager.connections
    assert rejected.manager.pending_connections == 0

    token, _ = create_access_token(
        "admin", "test-secret-key-that-is-at-least-32-bytes"
    )
    allowed = FakePolicySocket(
        origin="https://console.example",
        messages=[
            json.dumps({"type": "authenticate", "token": token}),
            "ping",
            "unsupported",
        ],
        auth_enabled=True,
    )
    await live_endpoint(allowed)  # type: ignore[arg-type]
    assert allowed.messages == [
        {"type": "connection", "status": "connected"},
        {"type": "pong"},
    ]
    assert allowed.closed == (1008, "unsupported live message")


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
async def test_live_manager_times_out_slow_connections_without_blocking_healthy_ones() -> None:
    class SlowSocket(FakeSocket):
        async def send_json(self, message: dict[str, Any]) -> None:
            await asyncio.Event().wait()

    manager = LiveConnectionManager(send_timeout_seconds=0.02)
    healthy = FakeSocket()
    slow = SlowSocket()
    manager.connections.update({healthy, slow})  # type: ignore[arg-type]

    await asyncio.wait_for(
        manager.broadcast({"type": "prediction", "data": {"event_id": "fixture"}}),
        timeout=0.2,
    )

    assert healthy.messages[0]["type"] == "prediction"
    assert slow not in manager.connections


@pytest.mark.anyio
async def test_live_manager_serializes_broadcasts_per_connection() -> None:
    class SerialSocket(FakeSocket):
        def __init__(self) -> None:
            super().__init__()
            self.sending = False
            self.overlapped = False

        async def send_json(self, message: dict[str, Any]) -> None:
            if self.sending:
                self.overlapped = True
            self.sending = True
            await asyncio.sleep(0.01)
            self.messages.append(message)
            self.sending = False

    manager = LiveConnectionManager(send_timeout_seconds=0.2)
    socket = SerialSocket()
    manager.connections.add(socket)  # type: ignore[arg-type]

    await asyncio.gather(
        manager.broadcast({"type": "first"}),
        manager.broadcast({"type": "second"}),
    )

    assert socket.overlapped is False
    assert [message["type"] for message in socket.messages] == ["first", "second"]


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

    staged = persist_observations(
        (FlowObservation.model_validate(payload),),
        session_factory,
        ModelRegistry(allow_fallback=True),
    )[0]
    await broadcast_staged(staged, live)
    response = staged.response

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

    staged = persist_observations(
        (FlowObservation.model_validate(payload),),
        session_factory,
        ModelRegistry(allow_fallback=True),
    )[0]
    await broadcast_staged(staged, live)
    response = staged.response

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
        ),
        initialize_schema_for_tests=True,
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
