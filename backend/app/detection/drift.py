from __future__ import annotations

"""Calibrated, evidence-first distribution monitoring primitives.

These functions deliberately separate distribution change from model quality.
They do not retrain, promote, roll back, or stop inference.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from scipy.spatial.distance import jensenshannon
from scipy.stats import ks_2samp


def benjamini_hochberg(p_values: list[float]) -> list[float]:
    """Return false-discovery-rate adjusted p-values in input order."""
    if not p_values:
        return []
    values = np.asarray(p_values, dtype=float)
    if np.any(~np.isfinite(values)) or np.any((values < 0) | (values > 1)):
        raise ValueError("p-values must be finite values between zero and one")
    order = np.argsort(values)
    ranked = values[order]
    adjusted = ranked * len(values) / np.arange(1, len(values) + 1)
    adjusted = np.minimum.accumulate(adjusted[::-1])[::-1]
    result = np.empty_like(adjusted)
    result[order] = np.clip(adjusted, 0, 1)
    return result.tolist()


def _probabilities(counts: list[int] | np.ndarray) -> np.ndarray:
    values = np.asarray(counts, dtype=float)
    if values.ndim != 1 or not len(values) or np.any(values < 0):
        raise ValueError("histogram counts must be a non-empty non-negative vector")
    # A symmetric half-count avoids undefined zero/zero bins without hiding
    # unseen mass. Both reference and current histograms receive the same prior.
    values = values + 0.5
    return values / values.sum()


def _histogram_with_outliers(values: np.ndarray, edges: np.ndarray) -> np.ndarray:
    if len(edges) < 2 or np.any(np.diff(edges) <= 0):
        raise ValueError("reference histogram edges must be strictly increasing")
    interior, _ = np.histogram(values, bins=edges)
    return np.concatenate(
        ([np.sum(values < edges[0])], interior, [np.sum(values > edges[-1])])
    )


def numeric_drift(
    reference: dict[str, Any], current_values: list[float]
) -> dict[str, Any]:
    current = np.asarray(current_values, dtype=float)
    current = current[np.isfinite(current)]
    if not len(current):
        raise ValueError("numeric drift requires at least one finite current value")
    edges = np.asarray(reference["histogram_edges"], dtype=float)
    reference_counts = np.asarray(reference["histogram_counts"], dtype=int)
    if len(reference_counts) == len(edges) - 1:
        reference_counts = np.concatenate(([0], reference_counts, [0]))
    current_counts = _histogram_with_outliers(current, edges)
    if len(reference_counts) != len(current_counts):
        raise ValueError("reference histogram counts do not match its edges")
    distance = float(
        jensenshannon(
            _probabilities(reference_counts), _probabilities(current_counts), base=2
        )
    )
    sample = np.asarray(reference.get("comparison_sample", []), dtype=float)
    sample = sample[np.isfinite(sample)]
    if len(sample):
        ks = ks_2samp(sample, current, alternative="two-sided", method="auto")
        statistic, p_value = float(ks.statistic), float(ks.pvalue)
    else:
        statistic, p_value = 0.0, 1.0
    low = float(reference["min"])
    high = float(reference["max"])
    return {
        "kind": "numeric",
        "count": int(len(current)),
        "js_distance": distance,
        "js_threshold": float(reference["js_threshold"]),
        "ks_statistic": statistic,
        "ks_p_value": p_value,
        "range_exceedance_rate": float(np.mean((current < low) | (current > high))),
        "reference_median": float(reference["quantiles"]["0.5"]),
        "current_median": float(np.median(current)),
        "reference_p95": float(reference["quantiles"]["0.95"]),
        "current_p95": float(np.quantile(current, 0.95)),
    }


def categorical_drift(
    reference: dict[str, Any], current_values: list[str]
) -> dict[str, Any]:
    vocabulary = [str(value) for value in reference["vocabulary"]]
    reference_counts_by_value = {
        str(key): int(value) for key, value in reference["counts"].items()
    }
    known = set(vocabulary)
    current_counts = {value: 0 for value in vocabulary}
    current_counts["__OTHER__"] = 0
    unseen: dict[str, int] = {}
    for raw in current_values:
        value = str(raw)
        if value in known:
            current_counts[value] += 1
        else:
            current_counts["__OTHER__"] += 1
            unseen[value] = unseen.get(value, 0) + 1
    keys = [*vocabulary, "__OTHER__"]
    reference_counts = [reference_counts_by_value.get(key, 0) for key in keys]
    observed_counts = [current_counts[key] for key in keys]
    distance = float(
        jensenshannon(
            _probabilities(reference_counts), _probabilities(observed_counts), base=2
        )
    )
    total = len(current_values)
    unseen_count = sum(unseen.values())
    return {
        "kind": "categorical",
        "count": total,
        "js_distance": distance,
        "js_threshold": float(reference["js_threshold"]),
        "unseen_count": unseen_count,
        "unseen_rate": unseen_count / total if total else 0.0,
        "unseen_values": [
            {"value": value, "count": count}
            for value, count in sorted(unseen.items(), key=lambda item: (-item[1], item[0]))[
                :20
            ]
        ],
    }


def evaluate_feature_window(
    reference: dict[str, Any], rows: list[dict[str, Any]]
) -> dict[str, Any]:
    """Evaluate a bounded cohort window against a validated reference artifact."""
    if not rows:
        return {"status": "collecting", "observation_count": 0, "features": []}
    numeric_results: list[tuple[str, dict[str, Any]]] = []
    for name, evidence in reference.get("numeric_features", {}).items():
        numeric_results.append(
            (name, numeric_drift(evidence, [float(row[name]) for row in rows]))
        )
    adjusted = benjamini_hochberg(
        [result["ks_p_value"] for _, result in numeric_results]
    )
    features: list[dict[str, Any]] = []
    for (name, result), q_value in zip(numeric_results, adjusted, strict=True):
        result["ks_q_value"] = q_value
        result["drifted"] = bool(
            result["js_distance"] > result["js_threshold"] and q_value <= 0.05
        )
        features.append({"feature": name, **result})
    for name, evidence in reference.get("categorical_features", {}).items():
        result = categorical_drift(evidence, [str(row[name]) for row in rows])
        result["drifted"] = bool(result["js_distance"] > result["js_threshold"])
        features.append({"feature": name, **result})
    features.sort(
        key=lambda item: (
            not item["drifted"],
            -(item["js_distance"] / max(item["js_threshold"], 1e-12)),
            item["feature"],
        )
    )
    ratios = [
        item["js_distance"] / max(item["js_threshold"], 1e-12) for item in features
    ]
    aggregate = max(ratios, default=0.0)
    if not math.isfinite(aggregate):
        aggregate = 0.0
    return {
        "status": "warning" if any(item["drifted"] for item in features) else "healthy",
        "observation_count": len(rows),
        "aggregate_score": aggregate,
        "aggregate_threshold": 1.0,
        "features": features,
    }


def drift_snapshot(payload: dict[str, Any]) -> dict[str, Any]:
    """Backward-compatible entrypoint with an honest insufficient-data state."""
    reference = payload.get("reference")
    rows = payload.get("rows")
    if not isinstance(reference, dict) or not isinstance(rows, list):
        return {"status": "not_enough_data"}
    return evaluate_feature_window(reference, rows)
