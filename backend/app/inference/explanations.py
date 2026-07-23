from __future__ import annotations

from typing import Any


def explain_features(features: dict[str, Any], limit: int = 5) -> list[dict[str, Any]]:
    ranked = sorted(
        features.items(),
        key=lambda item: (
            0 if isinstance(item[1], bool) else abs(float(item[1]))
            if isinstance(item[1], (int, float))
            else 0
        ),
        reverse=True,
    )
    return [{"feature": key, "value": value} for key, value in ranked[:limit]]

