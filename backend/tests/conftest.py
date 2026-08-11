from __future__ import annotations

import asyncio
import csv
import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import httpx
import pytest

# Importing app.main constructs the default ASGI app. Unit tests create their own
# configured apps below, so the module-level instance may use the explicit dev fallback.
os.environ.setdefault("IOT_IDS_ALLOW_FALLBACK", "true")

from app.config import Settings
from app.main import create_app

REPOSITORY = Path(__file__).resolve().parents[2]
SAMPLE = REPOSITORY / "data/sample/rt_iot2022_sample.csv"
MODEL_DIR = REPOSITORY / "models/production"


def _responsive_loop_factory() -> asyncio.AbstractEventLoop:
    """Bound selector sleeps so completed worker callbacks cannot miss a wake-up.

    Remove this workaround after the upstream AnyIO worker timing race is fixed:
    https://github.com/agronholm/anyio/issues/1265
    """
    loop = asyncio.new_event_loop()

    def wake() -> None:
        if not loop.is_closed():
            loop.call_later(0.01, wake)

    loop.call_soon(wake)
    return loop


@pytest.fixture
def anyio_backend() -> tuple[str, dict[str, object]]:
    return "asyncio", {"loop_factory": _responsive_loop_factory}


@pytest.fixture
def model_dir() -> Path:
    return MODEL_DIR


def observation(*, attack: bool = False) -> dict:
    with SAMPLE.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    row = next(
        item
        for item in rows
        if (
            item["Attack_type"]
            not in {"MQTT", "Thing_speak", "Wipro_bulb_Dataset", "Amazon-Alexa"}
        )
        == attack
    )
    ground_truth = row.pop("Attack_type")
    now = datetime.now(UTC).isoformat()
    return {
        "schema_version": "rt-iot2022-v1",
        "event_id": str(uuid4()),
        "flow_started_at": now,
        "flow_ended_at": now,
        "source": "test-suite",
        "features": row,
        "ground_truth": ground_truth,
    }


@pytest.fixture
async def client(tmp_path: Path) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(
        Settings(
            database_url=f"sqlite:///{tmp_path / 'test.db'}",
            model_dir=str(MODEL_DIR),
            allow_fallback=True,
            instance_id="backend-test-production",
            auth_enabled=False,
            allowed_hosts=("test",),
        ),
        initialize_schema_for_tests=True,
    )
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
        ) as value:
            yield value


@pytest.fixture
async def fallback_client(tmp_path: Path) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(
        Settings(
            database_url=f"sqlite:///{tmp_path / 'fallback.db'}",
            model_dir=None,
            model_artifact_path=None,
            allow_fallback=True,
            replay_dataset_path=str(SAMPLE),
            instance_id="backend-test-fallback",
            auth_enabled=False,
            allowed_hosts=("test",),
        ),
        initialize_schema_for_tests=True,
    )
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
        ) as value:
            yield value
