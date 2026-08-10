from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from threading import RLock
from typing import Any

import numpy as np
import pandas as pd

from app.features.canonical_schema import FEATURE_ORDER
from app.inference.model_registry import ArtifactPredictor, ModelRegistry


@dataclass(slots=True)
class _StageExplainer:
    predictor: ArtifactPredictor
    pipeline: Any
    explainer: Any
    transformed_names: list[str]


class ExplanationService:
    """Build TreeExplainers lazily and retain bounded alert-level results in memory."""

    def __init__(self, registry: ModelRegistry, max_cached_alerts: int = 512) -> None:
        self.registry = registry
        self.max_cached_alerts = max_cached_alerts
        self._explainers: dict[str, _StageExplainer] = {}
        self._results: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._lock = RLock()

    def explain_alert(
        self,
        alert_id: str,
        features: dict[str, Any],
        predicted_class: str,
    ) -> dict[str, Any]:
        with self._lock:
            return self._explain_alert_locked(alert_id, features, predicted_class)

    def _explain_alert_locked(
        self,
        alert_id: str,
        features: dict[str, Any],
        predicted_class: str,
    ) -> dict[str, Any]:
        cache_key = (
            f"{alert_id}:{self.registry.detector.version}:"
            f"{self.registry.classifier.version}:{predicted_class}"
        )
        cached = self._results.get(cache_key)
        if cached is not None:
            self._results.move_to_end(cache_key)
            return cached

        explanations = [
            self._explain_stage("binary", self.registry.detector, features, "attack"),
            self._explain_stage(
                "multiclass", self.registry.classifier, features, predicted_class
            ),
        ]
        result = {"alert_id": alert_id, "explanations": explanations}
        self._results[cache_key] = result
        while len(self._results) > self.max_cached_alerts:
            self._results.popitem(last=False)
        return result

    def _stage_explainer(self, stage: str, predictor: Any) -> _StageExplainer:
        if not isinstance(predictor, ArtifactPredictor):
            raise RuntimeError("SHAP explanations require promoted tree model artifacts")
        cached = self._explainers.get(predictor.version)
        if cached is not None:
            return cached

        import shap

        pipeline = predictor.model
        while not hasattr(pipeline, "named_steps") and hasattr(pipeline, "estimator"):
            pipeline = pipeline.estimator
        if not hasattr(pipeline, "named_steps"):
            raise RuntimeError("promoted calibrated model has no explainable base pipeline")
        preprocess = pipeline.named_steps["preprocess"]
        classifier = pipeline.named_steps["classifier"]
        stage_explainer = _StageExplainer(
            predictor=predictor,
            pipeline=pipeline,
            explainer=shap.TreeExplainer(classifier),
            transformed_names=[str(name) for name in preprocess.get_feature_names_out()],
        )
        self._explainers[predictor.version] = stage_explainer
        return stage_explainer

    def _explain_stage(
        self,
        stage: str,
        predictor: Any,
        features: dict[str, Any],
        explained_class: str,
    ) -> dict[str, Any]:
        holder = self._stage_explainer(stage, predictor)
        pipeline = holder.pipeline
        raw = pd.DataFrame(
            [[features[name] for name in FEATURE_ORDER]], columns=FEATURE_ORDER
        )
        transformed = pipeline.named_steps["preprocess"].transform(raw)
        explanation = holder.explainer(transformed)
        values = np.asarray(explanation.values)
        base_values = np.asarray(explanation.base_values)
        classes = [str(value) for value in pipeline.classes_]
        class_index = classes.index(explained_class)

        if values.ndim == 3:
            impacts = values[0, :, class_index]
            base_value = float(base_values.reshape(-1)[class_index])
        elif values.ndim == 2:
            impacts = values[0]
            base_value = float(base_values.reshape(-1)[0])
            # Binary tree explainers expose the positive (classes_[1]) margin.
            if len(classes) == 2 and class_index == 0:
                impacts = -impacts
                base_value = -base_value
        else:  # pragma: no cover - defensive guard for unsupported SHAP output
            raise RuntimeError(f"unsupported SHAP value shape: {values.shape}")

        transformed_row = np.asarray(transformed).reshape(-1)
        contributions = [
            {
                "feature": self._raw_feature_name(name),
                "transformed_feature": name,
                "raw_value": features.get(self._raw_feature_name(name)),
                "transformed_value": float(value),
                "impact": float(impact),
            }
            for name, value, impact in zip(
                holder.transformed_names, transformed_row, impacts, strict=True
            )
        ]
        contributions.sort(key=lambda item: abs(item["impact"]), reverse=True)
        reconstructed = base_value + sum(item["impact"] for item in contributions)
        if hasattr(pipeline, "decision_function"):
            decision_values = np.asarray(pipeline.decision_function(raw))
            if len(classes) == 2:
                decision = float(decision_values.reshape(-1)[0])
                output_value = decision if class_index == 1 else -decision
            else:
                output_value = float(decision_values[0, class_index])
        else:
            output_value = float(pipeline.predict_proba(raw)[0, class_index])
        additivity_error = abs(reconstructed - output_value)
        if additivity_error > 1e-5:
            raise RuntimeError(
                f"SHAP additivity check failed for {stage}: error={additivity_error:.3g}"
            )
        return {
            "stage": stage,
            "model_version": predictor.version,
            "explained_class": explained_class,
            "base_value": base_value,
            "output_value": output_value,
            "additivity_error": additivity_error,
            "method": "SHAP TreeExplainer",
            "calibration_scope": (
                "contributions explain the fitted tree model before sigmoid calibration"
                if holder.predictor.metadata.get("probability_calibrated")
                else "model output is not probability calibrated"
            ),
            "output_units": (
                "raw_margin" if hasattr(pipeline, "decision_function") else "probability"
            ),
            "causal": False,
            "contributions": contributions,
        }

    @staticmethod
    def _raw_feature_name(transformed_name: str) -> str:
        name = transformed_name.split("__", 1)[-1]
        for categorical in ("proto", "service"):
            if name == categorical or name.startswith(f"{categorical}_"):
                return categorical
        return name
