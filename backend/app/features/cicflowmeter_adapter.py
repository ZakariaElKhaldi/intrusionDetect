from __future__ import annotations

from typing import Any, NoReturn


class UnsupportedCICFlowMeterAdapterError(RuntimeError):
    """Raised when callers try to silently map CICFlowMeter output."""


def map_cicflowmeter_features(record: dict[str, Any]) -> NoReturn:
    del record
    raise UnsupportedCICFlowMeterAdapterError(
        "CICFlowMeter-to-rt-iot2022-v1 value compatibility has not been established; "
        "field-name matching is intentionally disabled"
    )
