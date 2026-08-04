from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx
import pytest
from conftest import observation


@pytest.mark.anyio
async def test_dashboard_summary_and_alert_pagination(
    fallback_client: httpx.AsyncClient,
) -> None:
    normal = observation()
    attack = observation(attack=True)
    attack["features"]["flow_SYN_flag_count"] = 100
    assert (await fallback_client.post("/predict", json=normal)).status_code == 201
    attack_response = await fallback_client.post("/predict", json=attack)
    assert attack_response.status_code == 201

    summary = await fallback_client.get("/dashboard/summary", params={"range": "all"})
    assert summary.status_code == 200
    body = summary.json()
    assert body["predictions"] == {"total": 2, "attack": 1, "normal": 1}
    assert body["alerts"]["total"] == 1
    assert body["alerts"]["open"] == 1
    assert body["alerts"]["unresolved"] == 1
    assert body["persisted_totals"]["unresolved_alerts"] == 1
    assert body["family_counts"] == {"suspicious_activity": 1}
    assert body["median_detection_score"] is not None
    assert body["generated_at"] == body["checked_at"]
    assert body["scope"]["source"] == "persisted_database_records"
    assert body["scope"]["bucket_minutes"] == 60
    assert sum(point["total"] for point in body["severity_timeline"]) == 1

    alert_id = attack_response.json()["alert_id"]
    legacy = await fallback_client.get("/alerts")
    assert legacy.status_code == 200
    assert legacy.json()[0]["total_latency_ms"] >= 0
    severity = legacy.json()[0]["severity"]
    past = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    future = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    page = await fallback_client.get(
        "/alerts/page",
        params={
            "severity": severity,
            "status": "new",
            "family": "suspicious_activity",
            "q": f"  {alert_id}  ",
            "from": past,
            "to": future,
            "limit": 1,
            "offset": 0,
        },
    )
    assert page.status_code == 200
    payload = page.json()
    assert payload["total"] == 1
    assert payload["has_more"] is False
    assert payload["items"][0]["alert_id"] == alert_id
    assert payload["items"][0]["detector_latency_ms"] >= 0
    assert payload["items"][0]["classifier_latency_ms"] >= 0
    assert payload["items"][0]["total_latency_ms"] >= 0
    assert payload["filters"] == {
        "severity": severity,
        "status": "new",
        "family": "suspicious_activity",
        "q": alert_id,
        "from": past.replace("+00:00", "Z"),
        "to": future.replace("+00:00", "Z"),
    }

    empty = await fallback_client.get("/alerts/page", params={"from": future})
    assert empty.json()["total"] == 0
    assert empty.json()["filters"] == {
        "severity": None,
        "status": None,
        "family": None,
        "q": None,
        "from": future.replace("+00:00", "Z"),
        "to": None,
    }
    assert (
        await fallback_client.get("/dashboard/summary", params={"range": "invalid"})
    ).status_code == 422


@pytest.mark.anyio
async def test_alert_page_validates_time_window(fallback_client: httpx.AsyncClient) -> None:
    now = datetime.now(UTC)
    response = await fallback_client.get(
        "/alerts/page",
        params={"from": now.isoformat(), "to": (now - timedelta(minutes=1)).isoformat()},
    )
    assert response.status_code == 422
    assert "from must be earlier" in response.text
