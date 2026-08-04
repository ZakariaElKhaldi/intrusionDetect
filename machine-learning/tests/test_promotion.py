from __future__ import annotations

import json

import pytest

from iot_ids_ml.promotion import ProductionBundleError, promote_bundle, verify_bundle
from iot_ids_ml.training import train_baselines
from iot_ids_ml.validation import sha256_file


def _mark_as_production(run_dir):
    report_path = run_dir / "evaluation-report.json"
    report = json.loads(report_path.read_text())
    report["dataset_role"] = "production_training"
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    manifest_path = run_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["evaluation_report_sha256"] = sha256_file(report_path)
    for model in manifest["models"]:
        metadata_path = run_dir / model["metadata"]
        metadata = json.loads(metadata_path.read_text())
        metadata["dataset_role"] = "production_training"
        metadata_path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n")
        model["metadata_sha256"] = sha256_file(metadata_path)
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return report


def test_fixture_bundle_is_rejected(fixture_csv, tmp_path):
    run = tmp_path / "run"
    train_baselines(fixture_csv, run, seed=7)
    report = json.loads((run / "evaluation-report.json").read_text())

    with pytest.raises(ProductionBundleError, match="Fixture-trained"):
        verify_bundle(
            run,
            expected_dataset_sha256=report["dataset_sha256"],
            expected_row_count=32,
        )


def test_verified_bundle_promotes_without_stale_files(fixture_csv, tmp_path):
    run = tmp_path / "run"
    train_baselines(fixture_csv, run, seed=7)
    report = _mark_as_production(run)
    production = tmp_path / "production"
    production.mkdir()
    (production / "old.joblib").write_bytes(b"stale")

    result = promote_bundle(
        run,
        production,
        expected_dataset_sha256=report["dataset_sha256"],
        expected_row_count=32,
    )

    assert result["promoted"] is True
    assert not (production / "old.joblib").exists()
    assert verify_bundle(
        production,
        expected_dataset_sha256=report["dataset_sha256"],
        expected_row_count=32,
    )["valid"]


def test_metadata_tampering_is_rejected(fixture_csv, tmp_path):
    run = tmp_path / "run"
    train_baselines(fixture_csv, run, seed=7)
    report = _mark_as_production(run)
    manifest = json.loads((run / "manifest.json").read_text())
    metadata_path = run / manifest["models"][0]["metadata"]
    metadata_path.write_text(metadata_path.read_text() + " ")

    with pytest.raises(ProductionBundleError, match="metadata_entry"):
        verify_bundle(
            run,
            expected_dataset_sha256=report["dataset_sha256"],
            expected_row_count=32,
        )
