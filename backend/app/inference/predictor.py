from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter
from typing import Any

from .explanations import explain_features
from .model_registry import ModelRegistry, ModelRoute


@dataclass(frozen=True, slots=True)
class InferenceResult:
    model_version: str
    detector_model_version: str
    classifier_model_version: str | None
    binary_prediction: str
    attack_class: str | None
    confidence: float
    detection_score: float
    attack_class_score: float | None
    latency_ms: float
    detector_latency_ms: float
    classifier_latency_ms: float | None
    top_features: list[dict[str, Any]]


def run_inference(
    registry: ModelRegistry | ModelRoute, features: dict[str, Any]
) -> InferenceResult:
    started = perf_counter()
    detector_started = perf_counter()
    prediction, detection_score = registry.detector.predict_label(features)
    detector_latency = (perf_counter() - detector_started) * 1000
    attack_class = None
    attack_class_score = None
    classifier_latency = None
    classifier_model_version = None
    if prediction == "attack":
        classifier_started = perf_counter()
        attack_class, attack_class_score = registry.classifier.predict_label(features)
        classifier_latency = (perf_counter() - classifier_started) * 1000
        classifier_model_version = registry.classifier.version
    latency = (perf_counter() - started) * 1000
    return InferenceResult(
        model_version=registry.detector.version,
        detector_model_version=registry.detector.version,
        classifier_model_version=classifier_model_version,
        binary_prediction=prediction,
        attack_class=attack_class,
        confidence=detection_score,
        detection_score=detection_score,
        attack_class_score=attack_class_score,
        latency_ms=latency,
        detector_latency_ms=detector_latency,
        classifier_latency_ms=classifier_latency,
        top_features=explain_features(features),
    )
