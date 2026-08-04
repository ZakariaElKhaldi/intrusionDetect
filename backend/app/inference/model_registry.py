from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import joblib
import pandas as pd

from app.features.canonical_schema import FEATURE_ORDER, SCHEMA_VERSION


class Predictor(Protocol):
    version: str
    model_type: str
    target: str
    metadata: dict[str, Any]

    def predict_label(self, features: dict[str, Any]) -> tuple[str, float]: ...


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class DeterministicFallback:
    """Stable development-only detector. It is never enabled implicitly."""

    version = "deterministic-fallback-v1"
    model_type = "deterministic-rule-baseline"
    target = "binary"
    metadata: dict[str, Any] = {
        "fallback": True,
        "probability_calibrated": False,
        "target": "binary",
    }

    def predict_label(self, features: dict[str, Any]) -> tuple[str, float]:
        syn_count = float(features["flow_SYN_flag_count"])
        reset_count = float(features["flow_RST_flag_count"])
        packet_rate = float(features["flow_pkts_per_sec"])
        attack_score = min(
            0.99,
            0.02
            + min(syn_count / 100.0, 0.55)
            + min(reset_count / 100.0, 0.2)
            + min(packet_rate / 100_000.0, 0.2),
        )
        if attack_score >= 0.5:
            return "attack", attack_score
        return "normal", 1.0 - attack_score

    # Kept for integrations that used the original registry directly.
    def predict(self, features: dict[str, Any]) -> tuple[str, str | None, float]:
        label, score = self.predict_label(features)
        return label, "suspicious_activity" if label == "attack" else None, score


class FallbackAttackClassifier:
    version = "deterministic-fallback-classifier-v1"
    model_type = "deterministic-rule-attack-classifier"
    target = "multiclass"
    metadata: dict[str, Any] = {
        "fallback": True,
        "probability_calibrated": False,
        "target": "multiclass",
    }

    def predict_label(self, features: dict[str, Any]) -> tuple[str, float]:
        return "suspicious_activity", 0.5


class ArtifactPredictor:
    def __init__(self, artifact_path: Path, metadata_path: Path, expected_target: str):
        self.metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if self.metadata.get("schema_version") != SCHEMA_VERSION:
            raise ValueError("artifact schema_version does not match the canonical schema")
        if tuple(self.metadata.get("feature_order", ())) != FEATURE_ORDER:
            raise ValueError("artifact feature order does not match the canonical schema")
        if self.metadata.get("target") != expected_target:
            raise ValueError(f"expected a {expected_target} classifier artifact")
        actual_checksum = _sha256(artifact_path)
        if actual_checksum != self.metadata.get("artifact_sha256"):
            raise ValueError("model artifact checksum does not match metadata")

        self.model = joblib.load(artifact_path)
        self.version = str(self.metadata["model_version"])
        self.model_type = str(self.metadata.get("model_name", type(self.model).__name__))
        self.target = expected_target

    def predict_label(self, features: dict[str, Any]) -> tuple[str, float]:
        row = pd.DataFrame([[features[name] for name in FEATURE_ORDER]], columns=FEATURE_ORDER)
        label = str(self.model.predict(row)[0])
        confidence = 1.0
        if hasattr(self.model, "predict_proba"):
            probabilities = self.model.predict_proba(row)[0]
            classes = [str(item) for item in self.model.classes_]
            confidence = float(probabilities[classes.index(label)])
        if self.target == "binary":
            label = "attack" if label.lower() == "attack" else "normal"
        return label, confidence


def _discover_from_manifest(model_dir: Path) -> dict[str, tuple[Path, Path]] | None:
    manifest_path = model_dir / "manifest.json"
    if not manifest_path.is_file():
        return None
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("model manifest schema_version does not match the canonical schema")
    report_name = manifest.get("evaluation_report")
    report_checksum = manifest.get("evaluation_report_sha256")
    if report_name or report_checksum:
        report_path = model_dir / str(report_name)
        if not report_path.is_file() or _sha256(report_path) != report_checksum:
            raise ValueError("evaluation report checksum does not match manifest")

    discovered: dict[str, tuple[Path, Path]] = {}
    for target in ("binary", "multiclass"):
        entries = [item for item in manifest.get("models", []) if item.get("target") == target]
        if len(entries) != 1:
            raise ValueError(f"model manifest must contain exactly one {target} artifact")
        entry = entries[0]
        artifact = model_dir / entry["artifact"]
        metadata = model_dir / entry["metadata"]
        if not artifact.is_file() or not metadata.is_file():
            raise FileNotFoundError(
                f"model artifact or metadata does not exist: {artifact}, {metadata}"
            )
        if _sha256(artifact) != entry.get("artifact_sha256"):
            raise ValueError("model artifact checksum does not match manifest")
        if entry.get("metadata_sha256") and _sha256(metadata) != entry["metadata_sha256"]:
            raise ValueError("model metadata checksum does not match manifest")
        metadata_payload = json.loads(metadata.read_text(encoding="utf-8"))
        if metadata_payload.get("model_version") != entry.get("model_version"):
            raise ValueError("model metadata version does not match manifest")
        discovered[target] = (artifact, metadata)

    datasets = {
        json.loads(metadata.read_text(encoding="utf-8")).get("dataset_sha256")
        for _, metadata in discovered.values()
    }
    if len(datasets) != 1:
        raise ValueError("binary and multiclass artifacts were trained from different datasets")
    return discovered


def _is_fixture_run(model_dir: Path) -> bool:
    report_path = model_dir / "evaluation-report.json"
    if not report_path.is_file():
        return False
    report = json.loads(report_path.read_text(encoding="utf-8"))
    return report.get("dataset_role") == "fixture" or report.get("profile", {}).get(
        "row_count"
    ) == 32


def _serving_metrics(model_dir: Path, model_name: str, target: str = "binary") -> dict[str, Any]:
    report_path = model_dir / "evaluation-report.json"
    if not report_path.is_file():
        return {}
    report = json.loads(report_path.read_text(encoding="utf-8"))
    evaluation = (
        report.get("experiments", {})
        .get(target, {})
        .get("splits", {})
        .get("stratified_random", {})
        .get("models", {})
        .get(model_name, {})
    )
    test = evaluation.get("test", {})
    operational = evaluation.get("operational", {})
    return {
        "macro_f1": test.get("f1_macro"),
        "weighted_f1": test.get("f1_weighted"),
        "false_positive_rate": test.get("false_positive_rate"),
        "inference_ms": operational.get("median_inference_latency_ms"),
        "p95_inference_ms": operational.get("p95_inference_latency_ms"),
        "evaluation_scope": (
            "synthetic fixture"
            if report.get("profile", {}).get("row_count") == 32
            else "dataset"
        ),
        "classes": test.get("classes"),
        "confusion_matrix": test.get("confusion_matrix"),
    }


@dataclass(frozen=True, slots=True)
class ModelDescriptor:
    model_version: str
    model_type: str
    artifact_path: str | None
    schema_version: str = SCHEMA_VERSION
    active: bool = True
    metadata_json: dict[str, Any] | None = None


class ModelRegistry:
    def __init__(
        self,
        artifact_path: str | None = None,
        model_dir: str | None = None,
        *,
        allow_fallback: bool = False,
    ):
        self.model_dir = Path(model_dir).expanduser().resolve() if model_dir else None
        self.artifact_paths: dict[str, str | None] = {"binary": None, "multiclass": None}

        discovered: dict[str, tuple[Path, Path]] | None = None
        if artifact_path:
            artifact = Path(artifact_path).expanduser().resolve()
            # A legacy explicit binary override still needs the sibling production
            # manifest so the cascade cannot silently lose attack classification.
            discovered = _discover_from_manifest(artifact.parent)
            if discovered:
                discovered["binary"] = (artifact, artifact.with_suffix(".metadata.json"))
        elif self.model_dir:
            discovered = _discover_from_manifest(self.model_dir)

        if discovered:
            if self.model_dir and _is_fixture_run(self.model_dir) and not allow_fallback:
                raise RuntimeError(
                    "fixture-trained artifacts cannot be served as production models; "
                    "set IOT_IDS_ALLOW_FALLBACK=true only for development"
                )
            self.detector = ArtifactPredictor(*discovered["binary"], "binary")
            self.classifier = ArtifactPredictor(*discovered["multiclass"], "multiclass")
            for target, (artifact, _) in discovered.items():
                self.artifact_paths[target] = str(artifact)
            if self.model_dir:
                self.detector.metadata["metrics"] = _serving_metrics(
                    self.model_dir, self.detector.model_type, "binary"
                )
                self.classifier.metadata["metrics"] = _serving_metrics(
                    self.model_dir, self.classifier.model_type, "multiclass"
                )
        elif allow_fallback:
            self.detector = DeterministicFallback()
            self.classifier = FallbackAttackClassifier()
        else:
            raise RuntimeError(
                "a valid binary+multiclass production manifest is required; "
                "set IOT_IDS_ALLOW_FALLBACK=true only for development"
            )

        # Backward-compatible name for callers that inspect the binary predictor.
        self.predictor = self.detector
        self.artifact_path = self.artifact_paths["binary"]

    def _descriptor(self, predictor: Predictor) -> ModelDescriptor:
        metadata = dict(predictor.metadata)
        metadata["feature_order"] = list(FEATURE_ORDER)
        return ModelDescriptor(
            model_version=predictor.version,
            model_type=predictor.model_type,
            artifact_path=self.artifact_paths[predictor.target],
            metadata_json=metadata,
        )

    @property
    def descriptor(self) -> ModelDescriptor:
        return self._descriptor(self.detector)

    @property
    def descriptors(self) -> list[ModelDescriptor]:
        return [self._descriptor(self.detector), self._descriptor(self.classifier)]
