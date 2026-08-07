"""Versioned reference evidence for post-deployment distribution monitoring."""

from __future__ import annotations

import hashlib
import json
from typing import Any

import numpy as np
import pandas as pd
from scipy.spatial.distance import jensenshannon

from .schema import CATEGORICAL_FEATURES, FEATURE_COLUMNS, NORMAL_LABELS, SCHEMA_VERSION

REFERENCE_SCHEMA_VERSION = "drift-reference-v1"


def canonical_json_sha256(value: dict[str, Any]) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def _probabilities(values: np.ndarray) -> np.ndarray:
    smoothed = values.astype(float) + 0.5
    return smoothed / smoothed.sum()


def _numeric_edges(values: np.ndarray, bins: int = 20) -> np.ndarray:
    edges = np.unique(np.quantile(values, np.linspace(0, 1, bins + 1)))
    if len(edges) == 1:
        center = float(edges[0])
        width = max(abs(center) * 1e-9, 1e-9)
        edges = np.asarray([center - width, center + width])
    return edges.astype(float)


def _calibrated_js_threshold(
    values: np.ndarray,
    *,
    rng: np.random.Generator,
    edges: np.ndarray | None = None,
    vocabulary: tuple[str, ...] | None = None,
    rounds: int,
    window_size: int,
) -> float:
    size = min(window_size, len(values) // 2)
    if size < 2:
        return 1.0
    distances: list[float] = []
    for _ in range(rounds):
        selected = rng.choice(len(values), size=size * 2, replace=False)
        left = values[selected[:size]]
        right = values[selected[size:]]
        if edges is not None:
            left_counts, _ = np.histogram(left.astype(float), bins=edges)
            right_counts, _ = np.histogram(right.astype(float), bins=edges)
        else:
            assert vocabulary is not None
            keys = [*vocabulary, "__OTHER__"]
            left_counts = np.asarray(
                [np.sum(left == key) for key in keys[:-1]]
                + [np.sum(~np.isin(left, vocabulary))]
            )
            right_counts = np.asarray(
                [np.sum(right == key) for key in keys[:-1]]
                + [np.sum(~np.isin(right, vocabulary))]
            )
        distances.append(
            float(jensenshannon(_probabilities(left_counts), _probabilities(right_counts), base=2))
        )
    # A small floor avoids zero thresholds for constant or perfectly balanced features.
    return max(float(np.quantile(distances, 0.99)), 1e-6)


def _attack_score(estimator: Any, frame: pd.DataFrame) -> np.ndarray:
    if not len(frame):
        return np.asarray([], dtype=float)
    if not hasattr(estimator, "predict_proba"):
        return np.asarray([], dtype=float)
    classes = [str(value).casefold() for value in estimator.classes_]
    if "attack" not in classes:
        return np.asarray([], dtype=float)
    return np.asarray(estimator.predict_proba(frame)[:, classes.index("attack")], dtype=float)


def build_drift_reference(
    frame: pd.DataFrame,
    *,
    train_indices: np.ndarray,
    test_indices: np.ndarray,
    detector: Any,
    classifier: Any,
    detector_model_version: str,
    classifier_model_version: str,
    dataset_sha256: str,
    schema_version: str = SCHEMA_VERSION,
    random_seed: int = 42,
    calibration_rounds: int = 100,
    comparison_sample_size: int = 2_000,
    calibration_window_size: int = 5_000,
) -> dict[str, Any]:
    """Build reference evidence from the exact fit and untouched test partitions."""
    if len(set(train_indices).intersection(test_indices)):
        raise ValueError("drift reference train and test partitions must be disjoint")
    if not len(train_indices) or not len(test_indices):
        raise ValueError("drift reference requires non-empty train and test partitions")
    training = frame.iloc[train_indices]
    test = frame.iloc[test_indices]
    rng = np.random.default_rng(random_seed)
    numeric: dict[str, Any] = {}
    categorical: dict[str, Any] = {}
    for name in FEATURE_COLUMNS:
        values = training[name].to_numpy()
        if name in CATEGORICAL_FEATURES:
            strings = values.astype(str)
            vocabulary = tuple(sorted(np.unique(strings).tolist()))
            counts = {value: int(np.sum(strings == value)) for value in vocabulary}
            counts["__OTHER__"] = 0
            categorical[name] = {
                "count": int(len(strings)),
                "vocabulary": list(vocabulary),
                "counts": counts,
                "js_threshold": _calibrated_js_threshold(
                    strings,
                    rng=rng,
                    vocabulary=vocabulary,
                    rounds=calibration_rounds,
                    window_size=calibration_window_size,
                ),
            }
            continue
        numbers = values.astype(float)
        if np.any(~np.isfinite(numbers)):
            raise ValueError(f"training feature {name} contains non-finite values")
        edges = _numeric_edges(numbers)
        counts, _ = np.histogram(numbers, bins=edges)
        sample_size = min(comparison_sample_size, len(numbers))
        sample_indices = rng.choice(len(numbers), size=sample_size, replace=False)
        numeric[name] = {
            "count": int(len(numbers)),
            "min": float(np.min(numbers)),
            "max": float(np.max(numbers)),
            "quantiles": {
                "0.05": float(np.quantile(numbers, 0.05)),
                "0.5": float(np.quantile(numbers, 0.5)),
                "0.95": float(np.quantile(numbers, 0.95)),
            },
            "histogram_edges": edges.tolist(),
            "histogram_counts": counts.astype(int).tolist(),
            "comparison_sample": numbers[sample_indices].tolist(),
            "js_threshold": _calibrated_js_threshold(
                numbers,
                rng=rng,
                edges=edges,
                rounds=calibration_rounds,
                window_size=calibration_window_size,
            ),
        }

    test_features = test[list(FEATURE_COLUMNS)]
    detector_labels = np.asarray(detector.predict(test_features)).astype(str)
    routed = np.flatnonzero(np.char.lower(detector_labels) == "attack")
    classifier_labels = (
        np.asarray(classifier.predict(test_features.iloc[routed])).astype(str)
        if len(routed)
        else np.asarray([], dtype=str)
    )
    truth = test["Attack_type"].astype(str)
    binary_truth = truth.map(
        lambda value: "normal" if value in NORMAL_LABELS else "attack"
    )
    output_reference = {
        "test_count": int(len(test)),
        "detector_labels": {
            value: int(np.sum(detector_labels == value))
            for value in sorted(np.unique(detector_labels))
        },
        "detector_scores": _attack_score(detector, test_features).tolist(),
        "classifier_condition": "detector_prediction=attack",
        "classifier_labels": {
            value: int(np.sum(classifier_labels == value))
            for value in sorted(np.unique(classifier_labels))
        },
        "ground_truth_binary": binary_truth.value_counts().sort_index().to_dict(),
    }
    reference: dict[str, Any] = {
        "reference_schema_version": REFERENCE_SCHEMA_VERSION,
        "schema_version": schema_version,
        "dataset_sha256": dataset_sha256,
        "detector_model_version": detector_model_version,
        "classifier_model_version": classifier_model_version,
        "fit_partition": {
            "row_count": int(len(train_indices)),
            "indices_sha256": hashlib.sha256(
                np.asarray(train_indices, dtype=np.int64).tobytes()
            ).hexdigest(),
        },
        "held_out_partition": {
            "row_count": int(len(test_indices)),
            "indices_sha256": hashlib.sha256(
                np.asarray(test_indices, dtype=np.int64).tobytes()
            ).hexdigest(),
        },
        "calibration": {
            "method": "99th percentile of disjoint null-window Jensen-Shannon distances",
            "random_seed": random_seed,
            "rounds": calibration_rounds,
            "window_size": min(calibration_window_size, len(train_indices) // 2),
            "target_aggregate_false_alarm_rate": 0.01,
        },
        "numeric_features": numeric,
        "categorical_features": categorical,
        "outputs": output_reference,
    }
    reference["content_sha256"] = canonical_json_sha256(reference)
    return reference
