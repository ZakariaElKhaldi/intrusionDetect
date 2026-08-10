from __future__ import annotations

import httpx
import pytest
from conftest import observation


@pytest.mark.anyio
async def test_health_models_and_packaged_prediction(client: httpx.AsyncClient) -> None:
    health = await client.get("/health")
    assert health.status_code == 200
    assert health.json()["model_version"].startswith("binary-")
    assert health.json()["dataset_ready"] is False
    assert health.json()["dataset_checksum"] is None
    assert health.json()["production_bundle_valid"] is True
    assert health.json()["fallback_status"]["active"] is False
    assert health.json()["instance_id"] == "backend-test-production"
    assert health.json()["readiness"] == "blocked"
    assert health.json()["components"]["dataset"]["status"] == "blocked"
    assert health.json()["components"]["detector"]["status"] == "ready"
    assert health.json()["components"]["classifier"]["status"] == "ready"
    assert health.json()["components"]["bundle"]["valid"] is True
    assert health.json()["checked_at"]

    models = await client.get("/models")
    assert models.status_code == 200
    assert models.json()[0]["schema_version"] == "rt-iot2022-v1"

    prediction = await client.post("/predict", json=observation())
    assert prediction.status_code == 201
    body = prediction.json()
    assert body["model_version"] == health.json()["model_version"]
    assert body["binary_prediction"] in {"normal", "attack"}
    assert body["detector_model_version"] == body["model_version"]
    assert body["detection_score"] == body["confidence"]
    if body["binary_prediction"] == "normal":
        assert body["classifier_model_version"] is None
        assert body["attack_class_score"] is None
    else:
        assert body["classifier_model_version"].startswith("multiclass-")
        assert body["attack_class"]
        assert body["attack_class_score"] is not None
    assert len(body["raw_features"]) == 83
    assert body["end_to_end_latency_ms"] >= body["latency_ms"]
    assert body["total_latency_ms"] == body["end_to_end_latency_ms"]


@pytest.mark.anyio
async def test_stage_evaluation_is_compact_and_requires_filter(
    client: httpx.AsyncClient,
) -> None:
    missing = await client.get("/evaluation")
    assert missing.status_code == 422

    response = await client.get("/evaluation", params={"stage": "binary"})
    assert response.status_code == 200
    body = response.json()
    assert body["stage"] == "binary"
    assert len(body["evaluation_seeds"]) == 3
    assert len(body["candidates"]) == 4
    assert sum(candidate["selected"] for candidate in body["candidates"]) == 1
    assert body["selected_champion"]["target"] == "binary"
    assert all("test_metrics" in candidate for candidate in body["candidates"])
    champion = next(candidate for candidate in body["candidates"] if candidate["selected"])
    assert champion["test_metrics"]["macro_f1"] > 0
    assert champion["class_support"]["normal"] > 0
    assert champion["selection_value"] > 0
    assert len(body["threshold_analysis"]["points"]) > 10
    assert body["threshold_analysis"]["operating_threshold"] == 0.5
    assert body["cascade_summary"]["detector_false_negatives"] >= 0
    assert body["cascade_summary"] == body["cascade_evaluation"]
    assert "Random-split evidence is not deployment validation." in body[
        "measurement_notes"
    ]

    multiclass = (
        await client.get("/evaluation", params={"stage": "multiclass"})
    ).json()
    assert all(
        candidate["test_metrics"]["false_positive_rate"] is None
        for candidate in multiclass["candidates"]
    )


@pytest.mark.anyio
async def test_alert_shap_explanations_cover_both_cascade_stages_and_are_additive(
    client: httpx.AsyncClient,
) -> None:
    prediction = await client.post("/predict", json=observation(attack=True))
    assert prediction.status_code == 201
    predicted = prediction.json()
    assert predicted["binary_prediction"] == "attack"

    first = await client.get(f"/alerts/{predicted['alert_id']}/explanation")
    second = await client.get(f"/alerts/{predicted['alert_id']}/explanation")
    assert first.status_code == 200
    assert second.json() == first.json()
    explanations = first.json()["explanations"]
    assert {item["stage"] for item in explanations} == {"binary", "multiclass"}
    assert next(item for item in explanations if item["stage"] == "binary")[
        "explained_class"
    ] == "attack"
    assert next(item for item in explanations if item["stage"] == "multiclass")[
        "explained_class"
    ] == predicted["attack_class"]
    for explanation in explanations:
        assert explanation["method"] == "SHAP TreeExplainer"
        assert explanation["causal"] is False
        reconstructed = explanation["base_value"] + sum(
            item["impact"] for item in explanation["contributions"]
        )
        assert reconstructed == pytest.approx(explanation["output_value"], abs=1e-8)
        assert all("raw_value" in item for item in explanation["contributions"])


@pytest.mark.anyio
async def test_fallback_exposes_status_but_not_false_shap_claims(
    fallback_client: httpx.AsyncClient,
) -> None:
    health = (await fallback_client.get("/health")).json()
    assert health["fallback"] is True
    assert health["fallback_status"]["detector"] is True
    assert health["production_bundle_valid"] is False
    assert health["dataset_ready"] is True
    assert len(health["dataset_checksum"]) == 64
    assert health["dataset_checksum_matches_training"] is None
    assert health["readiness"] == "degraded"
    assert (await fallback_client.get("/evaluation", params={"stage": "binary"})).status_code == 503

    payload = observation()
    payload["features"]["flow_SYN_flag_count"] = 100
    predicted = (await fallback_client.post("/predict", json=payload)).json()
    explanation = await fallback_client.get(
        f"/alerts/{predicted['alert_id']}/explanation"
    )
    assert explanation.status_code == 503
    assert "promoted tree model artifacts" in explanation.text


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
    assert alerts.json()[0]["classifier_model_version"] == (
        "deterministic-fallback-classifier-v1"
    )
    assert alerts.json()[0]["attack_class"] == "suspicious_activity"
    assert len(alerts.json()[0]["raw_features"]) == 83

    detail = await fallback_client.get(f"/alerts/{alert_id}")
    assert detail.status_code == 200
    assert detail.json()["confidence"] >= 0.5

    feedback = await fallback_client.post(
        f"/alerts/{alert_id}/feedback",
        json={"analyst": "spoofed-identity", "status": "investigating", "notes": "Reviewing"},
    )
    assert feedback.status_code == 201
    assert feedback.json()["status"] == "investigating"
    assert feedback.json()["analyst"] == "admin"
