from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest

from app.config import Settings
from app.ingestion.suricata_agent import EveFollower, normalize
from app.main import create_app


@pytest.mark.anyio
async def test_suricata_ingestion_is_authenticated_idempotent_and_not_model_evidence(
    tmp_path: Path, model_dir: Path
) -> None:
    token = "presentation-sensor-token-0000000000000001"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{tmp_path / 'sensor.db'}",
            model_dir=str(model_dir),
            allow_fallback=True,
            auth_enabled=False,
            allowed_hosts=("test",),
            sensor_token_hash=hashlib.sha256(token.encode()).hexdigest(),
            sensor_offline_seconds=30,
        ),
        initialize_schema_for_tests=True,
    )
    event = {
        "sensor_id": "lab-sensor",
        "interface": "iotlab0",
        "engine_version": "8.0.4",
        "rule_count": 3,
        "events": [
            {
                "timestamp": datetime.now(UTC).isoformat(),
                "event_type": "stats",
                "stats": {"capture": {"kernel_packets": 321, "kernel_drops": 2}},
            },
            {
                "timestamp": (datetime.now(UTC) - timedelta(hours=2)).isoformat(),
                "event_type": "alert",
                "flow_id": "998877",
                "src_ip": "172.30.0.40",
                "src_port": 49152,
                "dest_ip": "172.30.0.20",
                "dest_port": 1883,
                "proto": "TCP",
                "app_proto": "mqtt",
                "alert": {
                    "signature_id": 9900002,
                    "rev": 1,
                    "signature": "IOT LAB repeated MQTT authentication failure",
                    "category": "Attempted Administrator Privilege Gain",
                    "severity": 2,
                    "action": "allowed",
                },
            },
        ],
    }
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            denied = await client.post("/sensors/suricata/events", json=event)
            assert denied.status_code == 401
            first = await client.post(
                "/sensors/suricata/events",
                json=event,
                headers={"X-Sensor-Token": token},
            )
            assert first.status_code == 200
            assert first.json() == {
                "accepted_alerts": 1,
                "duplicate_alerts": 0,
                "observed_events": 2,
            }
            duplicate = await client.post(
                "/sensors/suricata/events",
                json=event,
                headers={"X-Sensor-Token": token},
            )
            assert duplicate.json()["duplicate_alerts"] == 1

            alerts = (await client.get("/alerts")).json()
            assert len(alerts) == 1
            alert = alerts[0]
            assert alert["detection_source"] == "suricata"
            assert alert["model_version"] is None
            assert alert["detection_score"] is None
            assert alert["network_context"]["source_ip"] == "172.30.0.40"
            assert alert["sensor_evidence"]["signature_id"] == 9900002
            assert (
                await client.get(f"/alerts/{alert['alert_id']}/explanation")
            ).status_code == 409

            summary = (await client.get("/dashboard/summary", params={"range": "all"})).json()
            assert summary["scope"]["time_field"] == "observed_at"
            assert summary["family_counts"] == {
                "IOT LAB repeated MQTT authentication failure": 1
            }
            assert summary["protocol_counts"] == {"tcp": 1}
            active_bucket = next(
                bucket for bucket in summary["severity_timeline"] if bucket["total"]
            )
            bucket_start = datetime.fromisoformat(active_bucket["bucket_start"])
            matching_page = await client.get(
                "/alerts/page",
                params={
                    "from": bucket_start.isoformat(),
                    "to": (bucket_start + timedelta(hours=1)).isoformat(),
                },
            )
            assert matching_page.json()["total"] == 1
            endpoint_search = await client.get(
                "/alerts/page", params={"q": "172.30.0.40"}
            )
            assert endpoint_search.json()["total"] == 1

            sensor = (await client.get("/sensors/status")).json()
            assert sensor["status"] == "online"
            assert sensor["aggregate"] == {
                "packets": 321,
                "capture_drops": 2,
                "events_seen": 4,
                "alerts_accepted": 1,
            }
            assert sensor["sensors"][0]["interface"] == "iotlab0"

            health = (await client.get("/health")).json()
            assert health["components"]["sensor"]["status"] == "ready"
            assert health["components"]["sensor"]["sensor_status"] == "online"


def test_eve_follower_commits_only_delivered_offsets_and_recovers_after_restart(
    tmp_path: Path,
) -> None:
    eve = tmp_path / "eve.json"
    checkpoint = tmp_path / "checkpoint.json"
    line = {
        "timestamp": "2026-08-20T20:00:00.000000+00:00",
        "event_type": "alert",
        "flow_id": 42,
        "alert": {
            "signature_id": 9900001,
            "signature": "IOT LAB TCP service scan",
            "category": "Network Scan",
            "severity": 2,
        },
    }
    eve.write_text(json.dumps(line) + "\n", encoding="utf-8")

    first_process = EveFollower(eve, checkpoint)
    records, offset = first_process.read(100)
    assert len(records) == 1
    assert not checkpoint.exists(), "reading must not acknowledge an undelivered event"

    retry_process = EveFollower(eve, checkpoint)
    retried, retry_offset = retry_process.read(100)
    assert retried == records
    retry_process.commit(retry_offset)

    restarted_process = EveFollower(eve, checkpoint)
    assert restarted_process.read(100)[0] == []
    assert offset == retry_offset


def test_native_suricata_alert_is_projected_to_the_strict_sensor_contract() -> None:
    normalized = normalize(
        {
            "timestamp": "2026-08-20T20:00:00.000000+0000",
            "event_type": "alert",
            "alert": {
                "gid": 1,
                "signature_id": 9900003,
                "rev": 1,
                "signature": "IOT LAB suspicious camera debug endpoint",
                "category": "Web Application Attack",
                "severity": 2,
                "action": "allowed",
                "metadata": {"source": ["lab"]},
            },
        }
    )

    assert normalized is not None
    assert normalized["alert"] == {
        "signature_id": 9900003,
        "rev": 1,
        "signature": "IOT LAB suspicious camera debug endpoint",
        "category": "Web Application Attack",
        "severity": 2,
        "action": "allowed",
    }
