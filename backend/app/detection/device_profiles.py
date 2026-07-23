from __future__ import annotations

from typing import Any


def evaluate_device_profile(features: dict[str, Any]) -> list[str]:
    violation = features.get("device_profile_violation")
    return [str(violation)] if violation else []

