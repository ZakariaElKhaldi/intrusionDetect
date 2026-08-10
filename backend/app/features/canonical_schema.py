from __future__ import annotations

import json
import math
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

RT_SCHEMA_VERSION = "rt-iot2022-v1"
NFSTREAM_SCHEMA_VERSION = "nfstream-iot-v1"
SCHEMA_VERSION = RT_SCHEMA_VERSION
SUPPORTED_SCHEMA_VERSIONS = frozenset({RT_SCHEMA_VERSION, NFSTREAM_SCHEMA_VERSION})


def _schema_path(schema_version: str = SCHEMA_VERSION) -> Path:
    configured = os.getenv("IOT_IDS_SCHEMA_PATH")
    filename = schema_version.replace("-", "_") + ".json"
    candidates = [
        Path(configured).expanduser() if configured and schema_version == SCHEMA_VERSION else None,
        Path(__file__).resolve().parents[3] / f"data/schema/{filename}",
        Path.cwd() / f"data/schema/{filename}",
        Path.cwd().parent / f"data/schema/{filename}",
    ]
    for candidate in candidates:
        if candidate and candidate.is_file():
            return candidate.resolve()
    raise RuntimeError(
        f"canonical schema data/schema/{filename} was not found"
    )


SCHEMA_DEFINITION = json.loads(_schema_path().read_text(encoding="utf-8"))
if SCHEMA_DEFINITION.get("schema_version") != SCHEMA_VERSION:
    raise RuntimeError("canonical schema version does not match backend contract")

FEATURE_ORDER = tuple(SCHEMA_DEFINITION["feature_order"])
CATEGORICAL_FEATURES = frozenset(
    SCHEMA_DEFINITION["types"]["categorical_string"]
)
NUMERIC_FEATURES = frozenset(FEATURE_ORDER) - CATEGORICAL_FEATURES


def schema_definition(schema_version: str) -> dict[str, Any]:
    if schema_version not in SUPPORTED_SCHEMA_VERSIONS:
        raise ValueError(f"unsupported schema_version {schema_version!r}")
    if schema_version == SCHEMA_VERSION:
        return SCHEMA_DEFINITION
    definition = json.loads(_schema_path(schema_version).read_text(encoding="utf-8"))
    if definition.get("schema_version") != schema_version:
        raise RuntimeError(f"schema definition does not match {schema_version}")
    # nfstream-iot-v1 intentionally preserves the established 83 field names.
    definition.setdefault("feature_order", list(FEATURE_ORDER))
    definition.setdefault("types", SCHEMA_DEFINITION["types"])
    if tuple(definition["feature_order"]) != FEATURE_ORDER:
        raise RuntimeError(f"{schema_version} does not preserve the canonical feature order")
    return definition


class NetworkContext(BaseModel):
    """Optional transport metadata; never passed to the model feature vector."""

    model_config = ConfigDict(extra="forbid")

    source_ip: str | None = Field(default=None, max_length=64)
    destination_ip: str | None = Field(default=None, max_length=64)
    source_port: int | None = Field(default=None, ge=0, le=65_535)
    destination_port: int | None = Field(default=None, ge=0, le=65_535)
    protocol: str | None = Field(default=None, max_length=32)
    interface: str | None = Field(default=None, max_length=128)
    capture_id: str | None = Field(default=None, max_length=256)
    extractor_fingerprint: str | None = Field(default=None, max_length=256)


class FlowObservation(BaseModel):
    """Versioned compatibility boundary shared by replay and live ingestion."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = SCHEMA_VERSION
    event_id: UUID
    flow_started_at: datetime
    flow_ended_at: datetime
    source: str = Field(min_length=1, max_length=64)
    features: dict[str, Any]
    ground_truth: str | None = None
    network_context: NetworkContext | None = None

    @field_validator("schema_version")
    @classmethod
    def validate_schema_version(cls, value: str) -> str:
        if value not in SUPPORTED_SCHEMA_VERSIONS:
            raise ValueError(
                f"schema_version must be one of {sorted(SUPPORTED_SCHEMA_VERSIONS)}"
            )
        return value

    @field_validator("features")
    @classmethod
    def validate_features(cls, features: dict[str, Any]) -> dict[str, Any]:
        received = tuple(features)
        if received != FEATURE_ORDER:
            missing = [name for name in FEATURE_ORDER if name not in features]
            extra = [name for name in features if name not in FEATURE_ORDER]
            if missing or extra:
                raise ValueError(
                    "features must exactly match the declared 83-field contract; "
                    f"missing={missing}, extra={extra}"
                )
            raise ValueError("features must use canonical order")

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
        fingerprint = (
            self.network_context.extractor_fingerprint if self.network_context else None
        )
        if self.schema_version == NFSTREAM_SCHEMA_VERSION and not fingerprint:
            raise ValueError(
                "nfstream-iot-v1 observations require an extractor_fingerprint"
            )
        return self


class PredictionContract(BaseModel):
    event_id: UUID
    model_version: str
    detector_model_version: str
    classifier_model_version: str | None
    binary_prediction: Literal["normal", "attack"]
    attack_class: str | None
    confidence: float = Field(ge=0, le=1)
    detection_score: float = Field(ge=0, le=1)
    detection_score_calibrated: bool
    attack_class_score: float | None = Field(default=None, ge=0, le=1)
    attack_class_score_calibrated: bool | None = None
    latency_ms: float = Field(ge=0)
    detector_latency_ms: float = Field(ge=0)
    classifier_latency_ms: float | None = Field(default=None, ge=0)


class PredictionResponse(PredictionContract):
    prediction_id: UUID
    raw_features: dict[str, Any]
    network_context: NetworkContext | None = None
    top_features: list[dict[str, Any]]
    end_to_end_latency_ms: float = Field(ge=0)
    total_latency_ms: float = Field(ge=0)
    alert_id: UUID | None = None


class BatchPredictionRequest(BaseModel):
    observations: list[FlowObservation] = Field(min_length=1, max_length=10_000)


class BatchPredictionResponse(BaseModel):
    predictions: list[PredictionResponse]
