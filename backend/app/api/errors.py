from __future__ import annotations

from collections.abc import Iterable
from typing import Any


def safe_validation_details(errors: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Retain actionable locations/messages without reflecting submitted values."""

    return [
        {
            "type": error.get("type", "value_error"),
            "loc": list(error.get("loc", ())),
            "msg": error.get("msg", "Invalid value"),
        }
        for error in errors
    ]
