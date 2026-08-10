from __future__ import annotations

from pathlib import Path

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy.engine import Engine

BACKEND_ROOT = Path(__file__).resolve().parents[2]


def expected_schema_heads() -> set[str]:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    return set(ScriptDirectory.from_config(config).get_heads())


def verify_schema_current(engine: Engine) -> None:
    """Fail closed when the configured database has not reached every Alembic head."""

    with engine.connect() as connection:
        current = set(MigrationContext.configure(connection).get_current_heads())
    expected = expected_schema_heads()
    if current != expected:
        current_label = ", ".join(sorted(current)) if current else "uninitialized"
        expected_label = ", ".join(sorted(expected))
        raise RuntimeError(
            "database schema is not current "
            f"(current: {current_label}; expected: {expected_label}); "
            "run 'alembic upgrade head' before starting services"
        )
