from __future__ import annotations

import shutil
from pathlib import Path

import httpx
import pytest

from app.config import Settings
from app.main import create_app

REPOSITORY = Path(__file__).resolve().parents[2]
SAMPLE = REPOSITORY / "data/sample/rt_iot2022_sample.csv"


@pytest.mark.anyio
async def test_health_echoes_instance_and_invalidates_dataset_cache_on_stat_change(
    tmp_path: Path,
) -> None:
    dataset = tmp_path / "replay.csv"
    shutil.copyfile(SAMPLE, dataset)
    app = create_app(
        Settings(
            database_url=f"sqlite:///{tmp_path / 'health.db'}",
            allow_fallback=True,
            replay_dataset_path=str(dataset),
            instance_id="project-demo-42",
            allowed_hosts=("test",),
        ),
        initialize_schema_for_tests=True,
    )
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            first = (await client.get("/health")).json()
            assert first["instance_id"] == "project-demo-42"
            assert first["readiness"] == "degraded"
            assert first["components"]["database"]["status"] == "ready"
            assert first["components"]["dataset"]["status"] == "ready"
            live = await client.get("/livez")
            assert live.status_code == 200
            assert live.json() == {"status": "alive"}
            assert live.headers["x-content-type-options"] == "nosniff"
            assert live.headers["referrer-policy"] == "no-referrer"
            assert live.headers["x-request-id"]
            supplied_request_id = await client.get(
                "/livez", headers={"X-Request-ID": "operator-check:42"}
            )
            assert supplied_request_id.headers["x-request-id"] == "operator-check:42"
            replaced_request_id = await client.get(
                "/livez", headers={"X-Request-ID": "not allowed/request-id"}
            )
            assert replaced_request_id.headers["x-request-id"] != "not allowed/request-id"
            rejected_host = await client.get(
                "/livez", headers={"Host": "untrusted.example"}
            )
            assert rejected_host.status_code == 400
            preflight = await client.options(
                "/predict",
                headers={
                    "Origin": "http://localhost:5173",
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "authorization,content-type",
                },
            )
            assert preflight.status_code == 200
            assert preflight.headers["access-control-allow-origin"] == (
                "http://localhost:5173"
            )
            assert "access-control-allow-credentials" not in preflight.headers
            ready = await client.get("/readyz")
            assert ready.status_code == 200
            metrics = await client.get("/metrics")
            assert metrics.status_code == 200
            assert metrics.headers["content-type"].startswith("text/plain")
            assert "iot_ids_database_up 1.0" in metrics.text
            assert "iot_ids_ingestion_queue_depth 0.0" in metrics.text
            assert 'route="/livez"' in metrics.text
            assert "iot_ids_http_request_duration_seconds_bucket" in metrics.text

            with dataset.open("a", encoding="utf-8") as handle:
                handle.write("\n")
            second = (await client.get("/health")).json()
            assert second["dataset_checksum"] != first["dataset_checksum"]
            assert second["checked_at"] >= first["checked_at"]

            dataset.write_text("wrong,header\n1,2\n", encoding="utf-8")
            blocked = (await client.get("/health")).json()
            assert blocked["readiness"] == "blocked"
            assert blocked["dataset_ready"] is False
            assert blocked["components"]["dataset"]["status"] == "blocked"
            assert "schema mismatch" in blocked["dataset_error"]
            not_ready = await client.get("/readyz")
            assert not_ready.status_code == 503
            assert not_ready.json()["readiness"] == "blocked"
