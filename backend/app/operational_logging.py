from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

SAFE_FIELDS = (
    "event",
    "request_id",
    "instance_id",
    "http_request_method",
    "http_route",
    "http_response_status_code",
    "duration_ms",
    "error_type",
)


class JsonEventFormatter(logging.Formatter):
    """Serialize an allowlist of operational fields without request or secret data."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage().replace("\r", "\\r").replace("\n", "\\n"),
        }
        for field in SAFE_FIELDS:
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value
        return json.dumps(payload, separators=(",", ":"), ensure_ascii=True)


def configure_operational_logging(level: str, log_format: str) -> logging.Logger:
    logger = logging.getLogger("iot_ids")
    logger.disabled = False
    for name, existing in logging.Logger.manager.loggerDict.items():
        if name.startswith("iot_ids.") and isinstance(existing, logging.Logger):
            existing.disabled = False
    logger.handlers.clear()
    handler = logging.StreamHandler()
    if log_format == "json":
        handler.setFormatter(JsonEventFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
        )
    logger.addHandler(handler)
    logger.setLevel(level)
    logger.propagate = False
    return logger
