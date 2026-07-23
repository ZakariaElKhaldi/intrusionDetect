from __future__ import annotations

import json
import math
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SCHEMA_VERSION = "rt-iot2022-v1"


def _schema_path() -> Path:
    configured = os.getenv("IOT_IDS_SCHEMA_PATH")
    candidates = [
        Path(configured).expanduser() if configured else None,
        Path(__file__).resolve().parents[3] / "data/schema/rt_iot2022_v1.json",
        Path.cwd() / "data/schema/rt_iot2022_v1.json",
        Path.cwd().parent / "data/schema/rt_iot2022_v1.json",
    ]
    for candidate in candidates:
        if candidate and candidate.is_file():
            return candidate.resolve()
    raise RuntimeError(
        "canonical schema data/schema/rt_iot2022_v1.json was not found; "
        "set IOT_IDS_SCHEMA_PATH explicitly"
    )


SCHEMA_DEFINITION = json.loads(_schema_path().read_text(encoding="utf-8"))
if SCHEMA_DEFINITION.get("schema_version") != SCHEMA_VERSION:
    raise RuntimeError("canonical schema version does not match backend contract")

FEATURE_ORDER = tuple(SCHEMA_DEFINITION["feature_order"])
CATEGORICAL_FEATURES = frozenset(
    SCHEMA_DEFINITION["types"]["categorical_string"]
)
NUMERIC_FEATURES = frozenset(FEATURE_ORDER) - CATEGORICAL_FEATURES


class FlowObservation(BaseModel):
    """Versioned compatibility boundary shared by replay and live ingestion."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["rt-iot2022-v1"] = SCHEMA_VERSION
    event_id: UUID
    flow_started_at: datetime
    flow_ended_at: datetime
    source: str = Field(min_length=1, max_length=64)
    features: dict[str, Any]
    ground_truth: str | None = None

    @field_validator("features")
    @classmethod
    def validate_features(cls, features: dict[str, Any]) -> dict[str, Any]:
        received = tuple(features)
        if received != FEATURE_ORDER:
            missing = [name for name in FEATURE_ORDER if name not in features]
            extra = [name for name in features if name not in FEATURE_ORDER]
            if missing or extra:
                raise ValueError(
                    f"features must exactly match {SCHEMA_VERSION}; "
                    f"missing={missing}, extra={extra}"
                )
            raise ValueError(f"features must use canonical order for {SCHEMA_VERSION}")

        validated: dict[str, Any] = {}
        for name, value in features.items():
            if name in CATEGORICAL_FEATURES:
                if not isinstance(value, str) or not value.strip():
                    raise ValueError(f"feature {name!r} must be a non-blank string")
                validated[name] = value
                continue
            if isinstance(value, bool):
                raise ValueError(f"feature {name!r} must be numeric, not boolean")
            try:
                numeric = float(value)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"feature {name!r} must be float-compatible") from exc
            if not math.isfinite(numeric):
                raise ValueError(f"feature {name!r} must be finite")
            validated[name] = numeric
        return validated

    @model_validator(mode="after")
    def validate_times(self) -> FlowObservation:
        if self.flow_ended_at < self.flow_started_at:
            raise ValueError("flow_ended_at must be on or after flow_started_at")
        return self


class PredictionContract(BaseModel):
    event_id: UUID
    model_version: str
    binary_prediction: Literal["normal", "attack"]
    attack_class: str | None
    confidence: float = Field(ge=0, le=1)
    latency_ms: float = Field(ge=0)


class PredictionResponse(PredictionContract):
    prediction_id: UUID
    raw_features: dict[str, Any]
    top_features: list[dict[str, Any]]
    end_to_end_latency_ms: float = Field(ge=0)
    alert_id: UUID | None = None


class BatchPredictionRequest(BaseModel):
    observations: list[FlowObservation] = Field(min_length=1, max_length=10_000)


class BatchPredictionResponse(BaseModel):
    predictions: list[PredictionResponse]
