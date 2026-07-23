from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter
from typing import Any

from .explanations import explain_features
from .model_registry import ModelRegistry


@dataclass(frozen=True, slots=True)
class InferenceResult:
    model_version: str
    binary_prediction: str
    attack_class: str | None
    confidence: float
    latency_ms: float
    top_features: list[dict[str, Any]]


def run_inference(registry: ModelRegistry, features: dict[str, Any]) -> InferenceResult:
    started = perf_counter()
    prediction, attack_class, confidence = registry.predictor.predict(features)
    latency = (perf_counter() - started) * 1000
    return InferenceResult(
        model_version=registry.predictor.version,
        binary_prediction=prediction,
        attack_class=attack_class,
        confidence=confidence,
        latency_ms=latency,
        top_features=explain_features(features),
    )

