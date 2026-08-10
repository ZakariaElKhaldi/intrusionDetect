from __future__ import annotations

import asyncio

import httpx
import pytest
from conftest import observation


async def _wait_for_replay(
    client: httpx.AsyncClient, path: str = "/replay/status"
) -> dict:
    for _ in range(100):
        state = (await client.get(path)).json()
        if state["status"] in {"completed", "failed", "stopped"}:
            return state
        await asyncio.sleep(0.02)
    pytest.fail("replay did not reach a terminal state within two seconds")


@pytest.mark.anyio
async def test_replay_start_pause_resume_speed_and_stop(
    fallback_client: httpx.AsyncClient,
) -> None:
    payload = {
        "observations": [observation(), observation(attack=True)],
        "interval_ms": 1000,
        "speed": 1,
        "scenario": "mixed-test",
    }
    started = await fallback_client.post("/replay/start", json=payload)
    assert started.status_code == 202
    assert started.json()["scenario"] == "mixed-test"

    await asyncio.sleep(0)
    paused = await fallback_client.post("/replay/pause")
    assert paused.status_code == 200
    assert paused.json()["status"] == "paused"

    resumed = await fallback_client.post("/replay/resume", json={"speed": 5})
    assert resumed.status_code == 200
    assert resumed.json()["speed"] == 5

    stopped = await fallback_client.post("/replay/stop")
    assert stopped.status_code == 200
    assert stopped.json()["status"] == "stopped"


@pytest.mark.anyio
async def test_replay_completes_and_persists_predictions(
    fallback_client: httpx.AsyncClient,
) -> None:
    attack = observation(attack=True)
    attack["features"]["flow_SYN_flag_count"] = 100
    payload = {
        "observations": [attack],
        "interval_ms": 0,
        "speed": 2,
        "scenario": "single-attack",
    }
    assert (await fallback_client.post("/api/v1/replay/start", json=payload)).status_code == 202
    state = await _wait_for_replay(fallback_client, "/api/v1/replay/status")
    assert state["status"] == "completed"
    assert state["processed"] == 1
    alerts = await fallback_client.get("/alerts")
    assert len(alerts.json()) == 1


@pytest.mark.anyio
async def test_replay_rejects_invalid_state_transitions(
    fallback_client: httpx.AsyncClient,
) -> None:
    paused = await fallback_client.post("/replay/pause")
    assert paused.status_code == 409
    resumed = await fallback_client.post("/replay/resume", json={"speed": 1})
    assert resumed.status_code == 409


@pytest.mark.anyio
async def test_dataset_replay_is_server_managed_lazy_and_filterable(
    fallback_client: httpx.AsyncClient,
) -> None:
    response = await fallback_client.post(
        "/replay/start",
        json={
            "mode": "dataset",
            "scenario": "attack",
            "offset": 0,
            "limit": 2,
            "interval_ms": 0,
            "speed": 100,
        },
    )
    assert response.status_code == 202
    assert response.json()["mode"] == "dataset"
    assert response.json()["total"] == 2
    state = await _wait_for_replay(fallback_client)
    assert state["status"] == "completed"
    assert state["processed"] == 2


@pytest.mark.anyio
async def test_dataset_replay_rejects_client_observations(
    fallback_client: httpx.AsyncClient,
) -> None:
    response = await fallback_client.post(
        "/replay/start",
        json={"mode": "dataset", "observations": [observation()]},
    )
    assert response.status_code == 422
