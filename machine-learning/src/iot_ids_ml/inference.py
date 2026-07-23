"""Loading and predicting with versioned, validated pipeline artifacts."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import joblib
import pandas as pd

from .validation import sha256_file, validate_observations


class VersionedPredictor:
    """A saved preprocessing+model pipeline guarded by its metadata checksum."""

    def __init__(self, artifact_path: str | Path, metadata_path: str | Path):
        artifact = Path(artifact_path).expanduser().resolve()
        metadata_file = Path(metadata_path).expanduser().resolve()
        self.metadata = json.loads(metadata_file.read_text(encoding="utf-8"))
        actual_checksum = sha256_file(artifact)
        if actual_checksum != self.metadata["artifact_sha256"]:
            raise ValueError("Model artifact checksum does not match metadata")
        self.pipeline = joblib.load(artifact)

    def predict(self, observations: pd.DataFrame) -> list[dict[str, Any]]:
        features = validate_observations(observations)
        predictions = self.pipeline.predict(features)
        probabilities = (
            self.pipeline.predict_proba(features)
            if hasattr(self.pipeline, "predict_proba")
            else None
        )
        classes = [str(value) for value in self.pipeline.classes_]
        results: list[dict[str, Any]] = []
        for index, prediction in enumerate(predictions):
            result: dict[str, Any] = {
                "model_version": self.metadata["model_version"],
                "prediction": str(prediction),
                "target": self.metadata["target"],
            }
            if probabilities is not None:
                result["confidence_score"] = float(probabilities[index].max())
                result["confidence_is_calibrated_probability"] = False
                result["class_scores"] = {
                    label: float(probabilities[index, position])
                    for position, label in enumerate(classes)
                }
            results.append(result)
        return results

