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

    def predict(self, features: dict[str, Any]) -> tuple[str, str | None, float]:
        ...


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class DeterministicFallback:
    """Stable development baseline, clearly identified as an untrained fallback."""

    version = "deterministic-fallback-v1"
    model_type = "deterministic-rule-baseline"
    metadata: dict[str, Any] = {"fallback": True, "probability_calibrated": False}

    def predict(self, features: dict[str, Any]) -> tuple[str, str | None, float]:
        syn_count = float(features["flow_SYN_flag_count"])
        reset_count = float(features["flow_RST_flag_count"])
        packet_rate = float(features["flow_pkts_per_sec"])
        score = min(
            0.99,
            0.02
            + min(syn_count / 100.0, 0.55)
            + min(reset_count / 100.0, 0.2)
            + min(packet_rate / 100_000.0, 0.2),
        )
        if score >= 0.5:
            return "attack", "suspicious_activity", score
        return "normal", None, 1.0 - score


class ArtifactPredictor:
    def __init__(self, artifact_path: Path, metadata_path: Path):
        self.metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if self.metadata.get("schema_version") != SCHEMA_VERSION:
            raise ValueError("artifact schema_version does not match the canonical schema")
        if tuple(self.metadata.get("feature_order", ())) != FEATURE_ORDER:
            raise ValueError("artifact feature order does not match the canonical schema")
        if self.metadata.get("target") != "binary":
            raise ValueError("the serving API requires a binary classifier artifact")
        actual_checksum = _sha256(artifact_path)
        if actual_checksum != self.metadata.get("artifact_sha256"):
            raise ValueError("model artifact checksum does not match metadata")

        self.model = joblib.load(artifact_path)
        self.version = str(self.metadata["model_version"])
        self.model_type = str(self.metadata.get("model_name", type(self.model).__name__))

    def predict(self, features: dict[str, Any]) -> tuple[str, str | None, float]:
        row = pd.DataFrame([[features[name] for name in FEATURE_ORDER]], columns=FEATURE_ORDER)
        predicted = self.model.predict(row)[0]
        label = str(predicted)
        confidence = 1.0
        if hasattr(self.model, "predict_proba"):
            probabilities = self.model.predict_proba(row)[0]
            classes = [str(item) for item in self.model.classes_]
            confidence = float(probabilities[classes.index(label)])
        is_attack = label.lower() == "attack"
        return ("attack" if is_attack else "normal", label if is_attack else None, confidence)


def _discover_from_manifest(model_dir: Path) -> tuple[Path, Path] | None:
    manifest_path = model_dir / "manifest.json"
    if not manifest_path.is_file():
        return None
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("model manifest schema_version does not match the canonical schema")
    binary = next(
        (item for item in manifest.get("models", []) if item.get("target") == "binary"),
        None,
    )
    if not binary:
        raise ValueError("model manifest does not contain a binary artifact")
    artifact = model_dir / binary["artifact"]
    metadata = model_dir / binary["metadata"]
    if artifact.is_file() and _sha256(artifact) != binary.get("artifact_sha256"):
        raise ValueError("model artifact checksum does not match manifest")
    metadata_payload = (
        json.loads(metadata.read_text(encoding="utf-8")) if metadata.is_file() else {}
    )
    if metadata_payload and metadata_payload.get("model_version") != binary.get("model_version"):
        raise ValueError("model metadata version does not match manifest")
    return artifact, metadata


def _serving_metrics(model_dir: Path, model_name: str) -> dict[str, Any]:
    report_path = model_dir / "evaluation-report.json"
    if not report_path.is_file():
        return {}
    report = json.loads(report_path.read_text(encoding="utf-8"))
    evaluation = (
        report.get("experiments", {})
        .get("binary", {})
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
    ):
        self.model_dir = Path(model_dir).expanduser().resolve() if model_dir else None
        self.artifact_path: str | None = None
        self.predictor: Predictor = DeterministicFallback()

        discovered: tuple[Path, Path] | None = None
        if artifact_path:
            artifact = Path(artifact_path).expanduser().resolve()
            metadata = artifact.with_suffix(".metadata.json")
            discovered = (artifact, metadata)
        elif self.model_dir:
            discovered = _discover_from_manifest(self.model_dir)

        if discovered:
            artifact, metadata = discovered
            if not artifact.is_file() or not metadata.is_file():
                raise FileNotFoundError(
                    f"model artifact or metadata does not exist: {artifact}, {metadata}"
                )
            self.predictor = ArtifactPredictor(artifact, metadata)
            self.artifact_path = str(artifact)
            if self.model_dir:
                self.predictor.metadata["metrics"] = _serving_metrics(
                    self.model_dir,
                    self.predictor.model_type,
                )

    @property
    def descriptor(self) -> ModelDescriptor:
        metadata = dict(getattr(self.predictor, "metadata", {}))
        metadata["feature_order"] = list(FEATURE_ORDER)
        return ModelDescriptor(
            model_version=self.predictor.version,
            model_type=self.predictor.model_type,
            artifact_path=self.artifact_path,
            metadata_json=metadata,
        )

    @property
    def descriptors(self) -> list[ModelDescriptor]:
        active = self.descriptor
        if not self.model_dir:
            return [active]
        report_path = self.model_dir / "evaluation-report.json"
        if not report_path.is_file():
            return [active]
        report = json.loads(report_path.read_text(encoding="utf-8"))
        models = (
            report.get("experiments", {})
            .get("binary", {})
            .get("splits", {})
            .get("stratified_random", {})
            .get("models", {})
        )
        dataset_id = str(report.get("dataset_sha256", "unknown"))[:8]
        candidates = []
        for name in models:
            if name == active.model_type:
                continue
            candidates.append(
                ModelDescriptor(
                    model_version=f"candidate-{name}-{dataset_id}",
                    model_type=name,
                    artifact_path=None,
                    active=False,
                    metadata_json={
                        "metrics": _serving_metrics(self.model_dir, name),
                        "schema_version": SCHEMA_VERSION,
                        "not_promoted": True,
                    },
                )
            )
        return [active, *candidates]
