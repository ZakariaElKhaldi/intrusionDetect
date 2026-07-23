from __future__ import annotations

import asyncio

import httpx
import pytest
from conftest import observation


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
    await asyncio.sleep(0.02)
    state = await fallback_client.get("/api/v1/replay/status")
    assert state.json()["status"] == "completed"
    assert state.json()["processed"] == 1
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
