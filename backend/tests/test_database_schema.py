from __future__ import annotations

from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.config import Config

from alembic import command
from app.database.schema import expected_schema_heads, verify_schema_current
from app.database.session import create_engine_and_session

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _alembic_config() -> Config:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    return config


def test_schema_check_rejects_uninitialized_and_stale_databases(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database_url = f"sqlite:///{tmp_path / 'schema.db'}"
    engine, _ = create_engine_and_session(database_url)
    with pytest.raises(RuntimeError, match="current: uninitialized"):
        verify_schema_current(engine)
    engine.dispose()

    monkeypatch.setenv("IOT_IDS_DATABASE_URL", database_url)
    monkeypatch.setenv("IOT_IDS_AUTH_ENABLED", "false")
    command.upgrade(_alembic_config(), "20260807_02")

    engine, _ = create_engine_and_session(database_url)
    with pytest.raises(RuntimeError, match="current: 20260807_02"):
        verify_schema_current(engine)
    engine.dispose()


def test_schema_check_accepts_every_declared_alembic_head(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database_url = f"sqlite:///{tmp_path / 'schema.db'}"
    monkeypatch.setenv("IOT_IDS_DATABASE_URL", database_url)
    monkeypatch.setenv("IOT_IDS_AUTH_ENABLED", "false")
    command.upgrade(_alembic_config(), "head")

    engine, _ = create_engine_and_session(database_url)
    verify_schema_current(engine)
    inspector = sa.inspect(engine)
    outbox_columns = {
        column["name"] for column in inspector.get_columns("outbox_events")
    }
    outbox_indexes = {
        index["name"] for index in inspector.get_indexes("outbox_events")
    }
    assert {"claim_token", "claim_expires_at", "next_attempt_at"} <= outbox_columns
    assert "ix_outbox_events_delivery_claim" in outbox_indexes
    engine.dispose()
    assert expected_schema_heads() == {"20260810_04"}
