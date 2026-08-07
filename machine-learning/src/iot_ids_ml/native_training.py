"""NFStream-native four-candidate training on immutable capture-session splits."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

from .drift_reference import build_drift_reference
from .evaluation import classification_metrics, metrics_from_predictions
from .native_compatibility import build_compatibility_evidence
from .native_corpus import NATIVE_SCHEMA_VERSION, NativeCorpusError, sha256_file
from .schema import FEATURE_COLUMNS, NORMAL_LABELS, TARGET_COLUMN
from .training import model_candidates

SESSION_COLUMN = "capture_session"


def validate_native_training_frame(
    frame: pd.DataFrame, corpus_manifest: dict[str, Any]
) -> dict[str, np.ndarray]:
    """Resolve row indices from the signed whole-session assignment only."""

    required = {*FEATURE_COLUMNS, TARGET_COLUMN, SESSION_COLUMN}
    missing = sorted(required - set(frame.columns))
    if missing:
        raise NativeCorpusError(f"native training CSV is missing columns: {missing}")
    assignments = corpus_manifest.get("session_assignments")
    if not isinstance(assignments, dict) or not assignments:
        raise NativeCorpusError("corpus manifest has no session assignments")
    row_sessions = frame[SESSION_COLUMN].astype(str)
    unknown = sorted(set(row_sessions) - set(assignments))
    if unknown:
        raise NativeCorpusError(f"training rows reference unassigned sessions: {unknown}")
    partitions = {
        split: np.flatnonzero(row_sessions.map(assignments).to_numpy() == split)
        for split in ("train", "validation", "test")
    }
    if any(len(indices) == 0 for indices in partitions.values()):
        raise NativeCorpusError("train, validation and test partitions must all contain rows")
    session_sets = {
        split: set(row_sessions.iloc[indices]) for split, indices in partitions.items()
    }
    if any(
        session_sets[left] & session_sets[right]
        for left, right in (("train", "validation"), ("train", "test"), ("validation", "test"))
    ):
        raise NativeCorpusError("capture sessions cross training partitions")
    return partitions


def _fit_stage(
    x: pd.DataFrame,
    y: pd.Series,
    partitions: dict[str, np.ndarray],
    *,
    population: np.ndarray,
    seed: int,
) -> tuple[str, Any, dict[str, Any]]:
    stage_partitions = {
        name: indices[population[indices]] for name, indices in partitions.items()
    }
    if any(len(indices) == 0 for indices in stage_partitions.values()):
        raise NativeCorpusError("a native target has an empty train, validation or test split")
    evaluations: dict[str, Any] = {}
    fitted: dict[str, Any] = {}
    for name, estimator in model_candidates(seed).items():
        estimator.fit(x.iloc[stage_partitions["train"]], y.iloc[stage_partitions["train"]])
        fitted[name] = estimator
        evaluations[name] = {
            "validation": classification_metrics(
                estimator,
                x.iloc[stage_partitions["validation"]],
                y.iloc[stage_partitions["validation"]],
            ),
            "test": classification_metrics(
                estimator, x.iloc[stage_partitions["test"]], y.iloc[stage_partitions["test"]]
            ),
        }
    selected_name = sorted(
        evaluations,
        key=lambda name: (-evaluations[name]["validation"]["f1_macro"], name),
    )[0]
    return selected_name, fitted[selected_name], {
        "candidates": evaluations,
        "selected_model_name": selected_name,
        "selected_test": evaluations[selected_name]["test"],
    }


def train_native_models(
    csv_path: str | Path,
    corpus_manifest_path: str | Path,
    output_dir: str | Path,
    *,
    seed: int = 42,
) -> dict[str, Any]:
    """Train native detector/cascade candidates and emit non-forgeable bundle evidence.

    A failed gate is a successful evaluation run with ``status=blocked``; its manifest
    cannot be loaded by the serving registry.
    """

    corpus_path = Path(corpus_manifest_path)
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    if corpus.get("schema_version") != NATIVE_SCHEMA_VERSION:
        raise NativeCorpusError("corpus manifest is not nfstream-iot-v1")
    frame = pd.read_csv(csv_path)
    partitions = validate_native_training_frame(frame, corpus)
    x = frame[list(FEATURE_COLUMNS)]
    source_labels = frame[TARGET_COLUMN].astype(str)
    attack_mask = ~source_labels.isin(NORMAL_LABELS)
    binary_labels = source_labels.map(
        lambda value: "attack" if value not in NORMAL_LABELS else "normal"
    )

    binary_name, detector, binary_report = _fit_stage(
        x,
        binary_labels,
        partitions,
        population=np.ones(len(frame), dtype=bool),
        seed=seed,
    )
    multiclass_name, classifier, multiclass_report = _fit_stage(
        x,
        source_labels,
        partitions,
        population=attack_mask.to_numpy(),
        seed=seed,
    )
    test_indices = partitions["test"]
    truth = source_labels.iloc[test_indices].map(
        lambda value: "normal" if value in NORMAL_LABELS else value
    ).to_numpy()
    detector_predictions = detector.predict(x.iloc[test_indices])
    cascade = np.full(len(test_indices), "normal", dtype=object)
    routed = np.flatnonzero(detector_predictions == "attack")
    if len(routed):
        cascade[routed] = classifier.predict(x.iloc[test_indices[routed]])
    dataset_sha256 = sha256_file(csv_path)
    versions = {
        "binary": f"nfstream-binary-{binary_name}-{dataset_sha256[:12]}",
        "multiclass": f"nfstream-multiclass-{multiclass_name}-{dataset_sha256[:12]}",
    }
    report = {
        "schema_version": NATIVE_SCHEMA_VERSION,
        "dataset_sha256": dataset_sha256,
        "corpus_manifest_sha256": sha256_file(corpus_path),
        "split_policy": corpus["split_policy"],
        "seed": seed,
        "candidate_architectures": sorted(model_candidates(seed)),
        "experiments": {
            "binary": binary_report,
            "multiclass": multiclass_report,
        },
        "cascade_evaluation": {"metrics": metrics_from_predictions(truth, cascade)},
    }
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=False)
    models = []
    for target, name, estimator in (
        ("binary", binary_name, detector),
        ("multiclass", multiclass_name, classifier),
    ):
        version = versions[target]
        artifact = output / f"{version}.joblib"
        joblib.dump(estimator, artifact, compress=3)
        metadata = {
            "schema_version": NATIVE_SCHEMA_VERSION,
            "feature_order": list(FEATURE_COLUMNS),
            "target": target,
            "model_name": name,
            "model_version": version,
            "dataset_sha256": report["dataset_sha256"],
            "artifact_sha256": sha256_file(artifact),
        }
        metadata_path = output / f"{version}.metadata.json"
        metadata_path.write_text(json.dumps(metadata, sort_keys=True), encoding="utf-8")
        models.append(
            {
                "target": target,
                "model_version": version,
                "artifact": artifact.name,
                "artifact_sha256": metadata["artifact_sha256"],
                "metadata": metadata_path.name,
                "metadata_sha256": sha256_file(metadata_path),
            }
        )
    report_path = output / "evaluation-report.json"
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    drift_reference = build_drift_reference(
        frame,
        train_indices=partitions["train"],
        test_indices=partitions["test"],
        detector=detector,
        classifier=classifier,
        detector_model_version=versions["binary"],
        classifier_model_version=versions["multiclass"],
        dataset_sha256=dataset_sha256,
        schema_version=NATIVE_SCHEMA_VERSION,
    )
    drift_reference_path = output / "drift-reference.json"
    drift_reference_path.write_text(
        json.dumps(drift_reference, indent=2, sort_keys=True), encoding="utf-8"
    )
    manifest = {
        "schema_version": NATIVE_SCHEMA_VERSION,
        "evaluation_report": report_path.name,
        "evaluation_report_sha256": sha256_file(report_path),
        "drift_reference": drift_reference_path.name,
        "drift_reference_sha256": sha256_file(drift_reference_path),
        "models": models,
    }
    manifest_path = output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    evidence = build_compatibility_evidence(
        output,
        corpus_path,
        report_path,
        extractor_fingerprint=corpus["extractor_fingerprint"],
    )
    evidence_path = output / "compatibility-evidence.json"
    evidence_path.write_text(json.dumps(evidence, indent=2, sort_keys=True), encoding="utf-8")
    manifest["compatibility_evidence"] = evidence_path.name
    manifest["compatibility_evidence_sha256"] = sha256_file(evidence_path)
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    return {"output_dir": str(output), "status": evidence["status"], "models": models}
