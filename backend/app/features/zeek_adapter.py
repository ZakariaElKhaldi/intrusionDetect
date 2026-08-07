from __future__ import annotations

from typing import Any, NoReturn


class UnsupportedZeekAdapterError(RuntimeError):
    """Raised when callers try to treat Zeek fields as RT-IoT2022 fields."""


def map_zeek_features(record: dict[str, Any]) -> NoReturn:
    del record
    raise UnsupportedZeekAdapterError(
        "Zeek-to-rt-iot2022-v1 value compatibility has not been established; "
        "field-name matching is intentionally disabled"
    )
