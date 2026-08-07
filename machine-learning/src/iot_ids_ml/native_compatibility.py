"""Promotion gates and content-addressed NFStream/model compatibility evidence."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from .native_corpus import NATIVE_SCHEMA_VERSION, SPLIT_POLICY_VERSION, sha256_file

EVALUATION_POLICY_VERSION = "nfstream-native-promotion-v1"


class NativePromotionError(ValueError):
    """A native model run is incomplete or failed its declared serving gates."""


def wilson_interval(successes: int, support: int, z: float = 1.959963984540054) -> list[float]:
    if support <= 0 or not 0 <= successes <= support:
        raise NativePromotionError("Wilson intervals require 0 <= successes <= support")
    probability = successes / support
    denominator = 1 + z * z / support
    center = (probability + z * z / (2 * support)) / denominator
    margin = z * math.sqrt(
        probability * (1 - probability) / support + z * z / (4 * support * support)
    ) / denominator
    lower = 0.0 if successes == 0 else max(0.0, center - margin)
    upper = 1.0 if successes == support else min(1.0, center + margin)
    return [lower, upper]


def _metric_gate(
    value: float, support: int, *, threshold: float, minimum: bool
) -> dict[str, Any]:
    successes = round(value * support)
    return {
        "value": value,
        "support": support,
        "wilson_95": wilson_interval(successes, support),
        "threshold": threshold,
        "comparison": ">=" if minimum else "<=",
        "passed": value >= threshold if minimum else value <= threshold,
    }


def promotion_gates(report: dict[str, Any]) -> dict[str, Any]:
    """Evaluate the untouched test evidence used by the native promotion policy."""

    try:
        detector = report["experiments"]["binary"]["selected_test"]
        cascade = report["cascade_evaluation"]["metrics"]
        attack = detector["per_class"]["attack"]
        normal = detector["per_class"]["normal"]
        per_family = {
            name: metrics
            for name, metrics in cascade["per_class"].items()
            if name != "normal"
        }
    except (KeyError, TypeError) as exc:
        raise NativePromotionError(
            "native report must expose selected_test and cascade per-class evidence"
        ) from exc
    if len(per_family) != 9:
        raise NativePromotionError(
            f"native cascade evidence must contain nine attack families, got {len(per_family)}"
        )
    detector_recall = _metric_gate(
        float(attack["recall"]), int(attack["support"]), threshold=0.95, minimum=True
    )
    false_positives = round(float(detector["false_positive_rate"]) * int(normal["support"]))
    normal_fpr = {
        "value": float(detector["false_positive_rate"]),
        "support": int(normal["support"]),
        "wilson_95": wilson_interval(false_positives, int(normal["support"])),
        "threshold": 0.02,
        "comparison": "<=",
        "passed": float(detector["false_positive_rate"]) <= 0.02,
    }
    cascade_macro = _metric_gate(
        float(cascade["f1_macro"]),
        sum(int(item["support"]) for item in cascade["per_class"].values()),
        threshold=0.85,
        minimum=True,
    )
    family_evidence = {
        name: _metric_gate(
            float(metrics["recall"]),
            int(metrics["support"]),
            threshold=0.70,
            minimum=True,
        )
        for name, metrics in sorted(per_family.items())
    }
    family_gate = {
        "families": family_evidence,
        "passed": all(item["passed"] for item in family_evidence.values()),
    }
    support_gate = {
        "normal": int(normal["support"]),
        "attack_families": {
            name: int(metrics["support"]) for name, metrics in sorted(per_family.items())
        },
        "minimum_normal": 1000,
        "minimum_per_attack_family": 200,
        "passed": int(normal["support"]) >= 1000
        and all(int(item["support"]) >= 200 for item in per_family.values()),
    }
    return {
        "detector_recall": detector_recall,
        "normal_false_positive_rate": normal_fpr,
        "cascade_macro_f1": cascade_macro,
        "per_attack_family_recall": family_gate,
        "test_support": support_gate,
    }


def build_compatibility_evidence(
    bundle_dir: str | Path,
    corpus_manifest_path: str | Path,
    evaluation_report_path: str | Path,
    *,
    extractor_fingerprint: str,
) -> dict[str, Any]:
    """Bind corpus, labels, evaluation policy, and model bytes into one artifact."""

    directory = Path(bundle_dir)
    manifest_path = directory / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    corpus = json.loads(Path(corpus_manifest_path).read_text(encoding="utf-8"))
    report = json.loads(Path(evaluation_report_path).read_text(encoding="utf-8"))
    if manifest.get("schema_version") != NATIVE_SCHEMA_VERSION:
        raise NativePromotionError("model bundle is not nfstream-iot-v1")
    if corpus.get("schema_version") != NATIVE_SCHEMA_VERSION:
        raise NativePromotionError("corpus manifest is not nfstream-iot-v1")
    if corpus.get("extractor_fingerprint") != extractor_fingerprint:
        raise NativePromotionError("corpus extractor fingerprint does not match")
    gates = promotion_gates(report)
    approved = all(item.get("passed") is True for item in gates.values())
    models: dict[str, dict[str, str]] = {}
    for entry in manifest.get("models", []):
        artifact = directory / str(entry["artifact"])
        actual = sha256_file(artifact)
        if actual != entry.get("artifact_sha256"):
            raise NativePromotionError("model artifact checksum does not match manifest")
        models[str(entry["target"])] = {
            "model_version": str(entry["model_version"]),
            "artifact_sha256": actual,
        }
    if set(models) != {"binary", "multiclass"}:
        raise NativePromotionError("native bundle requires binary and multiclass models")
    return {
        "evidence_version": "extractor-model-compatibility-v1",
        "status": "approved" if approved else "blocked",
        "schema_version": NATIVE_SCHEMA_VERSION,
        "extractor_fingerprint": extractor_fingerprint,
        "extractor_manifest_sha256": corpus["extractor_manifest_sha256"],
        "corpus_manifest_sha256": sha256_file(corpus_manifest_path),
        "label_manifest_sha256": corpus["label_manifest_sha256"],
        "training_split_policy": SPLIT_POLICY_VERSION,
        "evaluation_policy_version": EVALUATION_POLICY_VERSION,
        "evaluation_report_sha256": sha256_file(evaluation_report_path),
        "models": models,
        "promotion_gates": gates,
    }
