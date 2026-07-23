from __future__ import annotations

import httpx
import pytest
from conftest import observation


@pytest.mark.anyio
async def test_health_models_and_packaged_prediction(client: httpx.AsyncClient) -> None:
    health = await client.get("/health")
    assert health.status_code == 200
    assert health.json()["model_version"].startswith("binary-")

    models = await client.get("/models")
    assert models.status_code == 200
    assert models.json()[0]["schema_version"] == "rt-iot2022-v1"

    prediction = await client.post("/predict", json=observation())
    assert prediction.status_code == 201
    body = prediction.json()
    assert body["model_version"] == health.json()["model_version"]
    assert body["binary_prediction"] in {"normal", "attack"}
    assert len(body["raw_features"]) == 83
    assert body["end_to_end_latency_ms"] >= body["latency_ms"]


@pytest.mark.anyio
async def test_schema_errors_are_clear_and_duplicate_ids_conflict(
    client: httpx.AsyncClient,
) -> None:
    payload = observation()
    payload["features"].pop("proto")
    invalid = await client.post("/predict", json=payload)
    assert invalid.status_code == 422
    assert "missing" in invalid.text

    payload = observation()
    assert (await client.post("/predict", json=payload)).status_code == 201
    duplicate = await client.post("/predict", json=payload)
    assert duplicate.status_code == 409
    assert "event_id already exists" in duplicate.text


@pytest.mark.anyio
async def test_alert_detail_and_feedback(fallback_client: httpx.AsyncClient) -> None:
    payload = observation()
    payload["features"]["flow_SYN_flag_count"] = 100
    prediction = await fallback_client.post("/predict", json=payload)
    assert prediction.status_code == 201
    alert_id = prediction.json()["alert_id"]
    assert alert_id

    alerts = await fallback_client.get("/alerts")
    assert alerts.status_code == 200
    assert alerts.json()[0]["model_version"] == "deterministic-fallback-v1"
    assert len(alerts.json()[0]["raw_features"]) == 83

    detail = await fallback_client.get(f"/alerts/{alert_id}")
    assert detail.status_code == 200
    assert detail.json()["confidence"] >= 0.5

    feedback = await fallback_client.post(
        f"/alerts/{alert_id}/feedback",
        json={"analyst": "test-analyst", "status": "investigating", "notes": "Reviewing"},
    )
    assert feedback.status_code == 201
    assert feedback.json()["status"] == "investigating"

