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
        )
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
