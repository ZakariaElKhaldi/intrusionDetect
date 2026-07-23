from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from .canonical_schema import FlowObservation


def validate_observation(value: FlowObservation | dict[str, Any]) -> FlowObservation:
    if isinstance(value, FlowObservation):
        return value
    try:
        return FlowObservation.model_validate(value)
    except ValidationError:
        raise

