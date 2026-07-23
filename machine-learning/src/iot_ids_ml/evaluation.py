"""Metrics and lightweight operational benchmarks."""

from __future__ import annotations

import io
import math
import time
from typing import Any

import joblib
import numpy as np
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    balanced_accuracy_score,
    confusion_matrix,
    matthews_corrcoef,
    precision_recall_curve,
    precision_recall_fscore_support,
)


def _finite(value: float) -> float | None:
    return float(value) if math.isfinite(float(value)) else None


def classification_metrics(estimator: Any, x: Any, y: Any) -> dict[str, Any]:
    predictions = estimator.predict(x)
    labels = sorted(
        set(estimator.classes_) | set(np.asarray(y).tolist()) | set(predictions.tolist()),
        key=str,
    )
    classes = [str(item) for item in labels]
    precision_macro, recall_macro, f1_macro, _ = precision_recall_fscore_support(
        y, predictions, average="macro", zero_division=0
    )
    precision_weighted, recall_weighted, f1_weighted, _ = (
        precision_recall_fscore_support(
            y, predictions, average="weighted", zero_division=0
        )
    )
    per_precision, per_recall, per_f1, per_support = (
        precision_recall_fscore_support(
            y, predictions, labels=labels, average=None, zero_division=0
        )
    )
    matrix = confusion_matrix(y, predictions, labels=labels)

    per_class: dict[str, dict[str, Any]] = {}
    false_positive_rates: list[float] = []
    for index, label in enumerate(classes):
        tp = int(matrix[index, index])
        fp = int(matrix[:, index].sum() - tp)
        fn = int(matrix[index, :].sum() - tp)
        tn = int(matrix.sum() - tp - fp - fn)
        fpr = fp / (fp + tn) if fp + tn else 0.0
        false_positive_rates.append(fpr)
        per_class[label] = {
            "precision": float(per_precision[index]),
            "recall": float(per_recall[index]),
            "f1": float(per_f1[index]),
            "support": int(per_support[index]),
            "one_vs_rest_false_positive_rate": float(fpr),
        }

    result: dict[str, Any] = {
        "accuracy": float(accuracy_score(y, predictions)),
        "balanced_accuracy": float(balanced_accuracy_score(y, predictions)),
        "precision": float(precision_macro),
        "recall": float(recall_macro),
        "f1": float(f1_macro),
        "precision_macro": float(precision_macro),
        "recall_macro": float(recall_macro),
        "f1_macro": float(f1_macro),
        "precision_weighted": float(precision_weighted),
        "recall_weighted": float(recall_weighted),
        "f1_weighted": float(f1_weighted),
        "matthews_correlation_coefficient": float(matthews_corrcoef(y, predictions)),
        "macro_one_vs_rest_false_positive_rate": float(np.mean(false_positive_rates)),
        "classes": classes,
        "per_class": per_class,
        "confusion_matrix": matrix.tolist(),
    }
    positive_supports = [int(value) for value in per_support if int(value) > 0]
    if positive_supports:
        rare_support = min(positive_supports)
        rare_recalls = [
            float(per_recall[index])
            for index, support in enumerate(per_support)
            if int(support) == rare_support
        ]
        result["rare_class_recall"] = float(np.mean(rare_recalls))
        result["rare_class_test_support"] = rare_support

    if set(classes) == {"attack", "normal"}:
        normal_index = classes.index("normal")
        attack_index = classes.index("attack")
        normal_total = int(matrix[normal_index, :].sum())
        result["false_positive_rate"] = (
            float(matrix[normal_index, attack_index] / normal_total)
            if normal_total
            else 0.0
        )

        attack_metrics = per_class["attack"]
        result["precision"] = attack_metrics["precision"]
        result["recall"] = attack_metrics["recall"]
        result["f1"] = attack_metrics["f1"]
        result["alert_rate"] = float(np.mean(predictions == "attack"))

    estimator_labels = list(estimator.classes_)
    estimator_classes = [str(item) for item in estimator_labels]
    if hasattr(estimator, "predict_proba"):
        probabilities = estimator.predict_proba(x)
        pr_auc: dict[str, float | None] = {}
        pr_curves: dict[str, dict[str, list[float]]] = {}
        if len(estimator_labels) == 2 and len(labels) == 2:
            positive_index = (
                estimator_classes.index("attack") if "attack" in estimator_classes else 1
            )
            binary_y = (np.asarray(y) == estimator_labels[positive_index]).astype(int)
            if 0 < binary_y.sum() < len(binary_y):
                label = estimator_classes[positive_index]
                pr_auc[label] = _finite(
                    average_precision_score(binary_y, probabilities[:, positive_index])
                )
                precision, recall, thresholds = precision_recall_curve(
                    binary_y, probabilities[:, positive_index]
                )
                pr_curves[label] = {
                    "precision": precision.astype(float).tolist(),
                    "recall": recall.astype(float).tolist(),
                    "thresholds": thresholds.astype(float).tolist(),
                }
        else:
            encoded = np.column_stack(
                [(np.asarray(y) == label).astype(int) for label in estimator_labels]
            )
            for index, label in enumerate(estimator_classes):
                positives = int(encoded[:, index].sum())
                if 0 < positives < len(encoded):
                    pr_auc[label] = _finite(
                        average_precision_score(encoded[:, index], probabilities[:, index])
                    )
                    precision, recall, thresholds = precision_recall_curve(
                        encoded[:, index], probabilities[:, index]
                    )
                    pr_curves[label] = {
                        "precision": precision.astype(float).tolist(),
                        "recall": recall.astype(float).tolist(),
                        "thresholds": thresholds.astype(float).tolist(),
                    }
                else:
                    pr_auc[label] = None
        result["one_vs_rest_pr_auc"] = pr_auc
        result["precision_recall_curves"] = pr_curves
        result["probability_note"] = (
            "Raw predict_proba output; not calibrated and not a guaranteed probability."
        )
    return result


def operational_metrics(estimator: Any, x: Any) -> dict[str, Any]:
    if len(x) == 0:
        raise ValueError("Cannot benchmark an empty evaluation partition")
    estimator.predict(x.iloc[: min(4, len(x))])
    per_row_ms: list[float] = []
    for position in range(len(x)):
        started = time.perf_counter_ns()
        estimator.predict(x.iloc[position : position + 1])
        per_row_ms.append((time.perf_counter_ns() - started) / 1_000_000)

    started = time.perf_counter()
    estimator.predict(x)
    batch_seconds = max(time.perf_counter() - started, np.finfo(float).eps)
    buffer = io.BytesIO()
    joblib.dump(estimator, buffer, compress=3)
    return {
        "median_inference_latency_ms": float(np.median(per_row_ms)),
        "p95_inference_latency_ms": float(np.percentile(per_row_ms, 95)),
        "predictions_per_second": float(len(x) / batch_seconds),
        "serialized_model_size_bytes": len(buffer.getvalue()),
        "benchmark_rows": int(len(x)),
    }
