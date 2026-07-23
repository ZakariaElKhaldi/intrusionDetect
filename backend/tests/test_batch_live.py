from __future__ import annotations

from typing import Any

import httpx
import pytest
from conftest import observation

from app.live import LiveConnectionManager


@pytest.mark.anyio
async def test_batch_prediction_and_versioned_alias(
    fallback_client: httpx.AsyncClient,
) -> None:
    response = await fallback_client.post(
        "/api/v1/predict/batch",
        json={"observations": [observation(), observation(attack=True)]},
    )
    assert response.status_code == 201
    predictions = response.json()["predictions"]
    assert len(predictions) == 2
    assert all(len(item["raw_features"]) == 83 for item in predictions)
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

