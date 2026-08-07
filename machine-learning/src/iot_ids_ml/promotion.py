"""Validation and atomic promotion of production model bundles."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

from .drift_reference import canonical_json_sha256
from .schema import FEATURE_COLUMNS, SCHEMA_VERSION
from .validation import sha256_file


class ProductionBundleError(ValueError):
    """Raised when a model bundle cannot safely be served or promoted."""


def _load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ProductionBundleError(f"Cannot read valid JSON from {path}: {exc}") from exc


def verify_bundle(
    bundle_dir: str | Path,
    *,
    expected_dataset_sha256: str,
    expected_row_count: int,
    reject_fixture: bool = True,
) -> dict[str, Any]:
    """Verify the manifest, report, model metadata, and every referenced checksum."""

    directory = Path(bundle_dir).expanduser().resolve()
    manifest_path = directory / "manifest.json"
    manifest = _load_json(manifest_path)
    if manifest.get("schema_version") != SCHEMA_VERSION:
        raise ProductionBundleError("Production manifest schema version is incompatible")
    report_path = directory / str(manifest.get("evaluation_report", ""))
    report = _load_json(report_path)
    if sha256_file(report_path) != manifest.get("evaluation_report_sha256"):
        raise ProductionBundleError("Evaluation report checksum does not match manifest")
    if report.get("dataset_sha256") != expected_dataset_sha256:
        raise ProductionBundleError("Production bundle was trained from a different dataset")
    if report.get("profile", {}).get("row_count") != expected_row_count:
        raise ProductionBundleError("Production bundle has an unexpected source row count")
    if reject_fixture and report.get("dataset_role") == "fixture":
        raise ProductionBundleError("Fixture-trained models cannot be promoted to production")

    drift_name = manifest.get("drift_reference")
    drift_checksum = manifest.get("drift_reference_sha256")
    if (drift_name is None) != (drift_checksum is None):
        raise ProductionBundleError("Drift reference manifest fields are incomplete")
    drift_reference: dict[str, Any] | None = None
    if drift_name is not None:
        drift_path = directory / str(drift_name)
        drift_reference = _load_json(drift_path)
        if sha256_file(drift_path) != drift_checksum:
            raise ProductionBundleError("Drift reference checksum does not match manifest")
        content = dict(drift_reference)
        content_checksum = content.pop("content_sha256", None)
        if (
            drift_reference.get("reference_schema_version") != "drift-reference-v1"
            or content_checksum != canonical_json_sha256(content)
            or drift_reference.get("dataset_sha256") != expected_dataset_sha256
        ):
            raise ProductionBundleError("Drift reference provenance is invalid")

    models = manifest.get("models")
    if not isinstance(models, list) or {item.get("target") for item in models} != {
        "binary",
        "multiclass",
    }:
        raise ProductionBundleError("Manifest must reference one binary and one multiclass model")
    verified_models: list[dict[str, Any]] = []
    for entry in models:
        artifact_path = directory / str(entry.get("artifact", ""))
        metadata_path = directory / str(entry.get("metadata", ""))
        if not artifact_path.is_file() or not metadata_path.is_file():
            raise ProductionBundleError("Manifest references a missing model file")
        metadata = _load_json(metadata_path)
        actual_metadata_sha = sha256_file(metadata_path)
        actual_artifact_sha = sha256_file(artifact_path)
        checks = {
            "target": metadata.get("target") == entry.get("target"),
            "version": metadata.get("model_version") == entry.get("model_version"),
            "schema": metadata.get("schema_version") == SCHEMA_VERSION,
            "features": metadata.get("feature_order") == list(FEATURE_COLUMNS),
            "dataset": metadata.get("dataset_sha256") == expected_dataset_sha256,
            "artifact_entry": actual_artifact_sha == entry.get("artifact_sha256"),
            "artifact_metadata": actual_artifact_sha == metadata.get("artifact_sha256"),
            "metadata_entry": actual_metadata_sha == entry.get("metadata_sha256"),
        }
        if reject_fixture:
            checks["not_fixture"] = metadata.get("dataset_role") != "fixture"
        if not all(checks.values()):
            failures = sorted(name for name, valid in checks.items() if not valid)
            raise ProductionBundleError(
                f"Model {entry.get('model_version', '<unknown>')} failed: {failures}"
            )
        verified_models.append(
            {
                "target": entry["target"],
                "model_version": entry["model_version"],
                "artifact_sha256": actual_artifact_sha,
            }
        )
    if drift_reference is not None:
        versions = {item["target"]: item["model_version"] for item in verified_models}
        if (
            drift_reference.get("detector_model_version") != versions["binary"]
            or drift_reference.get("classifier_model_version") != versions["multiclass"]
        ):
            raise ProductionBundleError("Drift reference model versions are stale")
    return {
        "valid": True,
        "bundle_dir": str(directory),
        "dataset_sha256": expected_dataset_sha256,
        "row_count": expected_row_count,
        "models": verified_models,
    }


def promote_bundle(
    run_dir: str | Path,
    production_dir: str | Path,
    *,
    expected_dataset_sha256: str,
    expected_row_count: int,
) -> dict[str, Any]:
    """Copy a verified run and replace production as one recoverable directory swap."""

    source = Path(run_dir).expanduser().resolve()
    destination = Path(production_dir).expanduser().resolve()
    verification = verify_bundle(
        source,
        expected_dataset_sha256=expected_dataset_sha256,
        expected_row_count=expected_row_count,
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{destination.name}-staging-", dir=destination.parent))
    backup = destination.with_name(f".{destination.name}-previous")
    moved_old = False
    try:
        manifest = _load_json(source / "manifest.json")
        names = {"manifest.json", str(manifest["evaluation_report"])}
        if manifest.get("drift_reference"):
            names.add(str(manifest["drift_reference"]))
        for model in manifest["models"]:
            names.update((str(model["artifact"]), str(model["metadata"])))
        for name in sorted(names):
            shutil.copy2(source / name, staging / name)
        verify_bundle(
            staging,
            expected_dataset_sha256=expected_dataset_sha256,
            expected_row_count=expected_row_count,
        )
        if backup.exists():
            shutil.rmtree(backup)
        if destination.exists():
            os.replace(destination, backup)
            moved_old = True
        os.replace(staging, destination)
        if moved_old:
            shutil.rmtree(backup)
        return {**verification, "production_dir": str(destination), "promoted": True}
    except Exception:
        if moved_old and not destination.exists() and backup.exists():
            os.replace(backup, destination)
        raise
    finally:
        if staging.exists():
            shutil.rmtree(staging)
