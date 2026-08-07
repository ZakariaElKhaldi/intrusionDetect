from __future__ import annotations

import hashlib
import json

import pytest

from app.monitoring.reference import DriftReferenceError, canonical_sha256, load_drift_reference


def write_reference(tmp_path):
    value = {
        "reference_schema_version": "drift-reference-v1",
        "detector_model_version": "detector-v1",
        "classifier_model_version": "classifier-v1",
        "numeric_features": {"duration": {"count": 10}},
        "categorical_features": {"proto": {"count": 10}},
    }
    value["content_sha256"] = canonical_sha256(value)
    path = tmp_path / "drift-reference.json"
    path.write_text(json.dumps(value), encoding="utf-8")
    checksum = hashlib.sha256(path.read_bytes()).hexdigest()
    return path, checksum


def test_reference_is_bound_to_manifest_and_model_versions(tmp_path) -> None:
    path, checksum = write_reference(tmp_path)
    result = load_drift_reference(
        tmp_path,
        {"drift_reference": path.name, "drift_reference_sha256": checksum},
        detector_model_version="detector-v1",
        classifier_model_version="classifier-v1",
    )
    assert result is not None
    assert result["artifact_sha256"] == checksum


def test_missing_reference_is_legacy_blocked_state_not_a_forged_default(tmp_path) -> None:
    assert (
        load_drift_reference(
            tmp_path,
            {},
            detector_model_version="detector-v1",
            classifier_model_version="classifier-v1",
        )
        is None
    )


def test_reference_rejects_tampering_and_stale_model(tmp_path) -> None:
    path, checksum = write_reference(tmp_path)
    manifest = {"drift_reference": path.name, "drift_reference_sha256": checksum}
    with pytest.raises(DriftReferenceError, match="stale"):
        load_drift_reference(
            tmp_path,
            manifest,
            detector_model_version="detector-v2",
            classifier_model_version="classifier-v1",
        )
    path.write_text("{}", encoding="utf-8")
    with pytest.raises(DriftReferenceError, match="manifest"):
        load_drift_reference(
            tmp_path,
            manifest,
            detector_model_version="detector-v1",
            classifier_model_version="classifier-v1",
        )
