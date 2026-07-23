from __future__ import annotations

from typing import Any


def drift_snapshot(_: dict[str, Any]) -> dict[str, str]:
    return {"status": "not_enough_data"}

