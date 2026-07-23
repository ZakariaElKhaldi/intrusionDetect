from __future__ import annotations

import json

import pandas as pd
import pytest

from iot_ids_ml.schema import FEATURE_COLUMNS, SCHEMA_VERSION, TARGET_COLUMN
from iot_ids_ml.validation import SchemaValidationError, validate_dataset, validate_observations


def test_canonical_metadata_and_fixture_agree(repository_root, fixture_csv):
    metadata = json.loads(
        (repository_root / "data" / "schema" / "rt_iot2022_v1.json").read_text()
    )
    frame = pd.read_csv(fixture_csv)

    assert metadata["schema_version"] == SCHEMA_VERSION
    assert metadata["feature_count"] == 83
    assert metadata["feature_order"] == list(FEATURE_COLUMNS)
    assert frame.columns.tolist() == [*FEATURE_COLUMNS, TARGET_COLUMN]
    assert len(frame) == 32


def test_profile_records_validation_evidence(fixture_csv):
    result = validate_dataset(fixture_csv)

    assert result.profile["valid"] is True
    assert result.profile["feature_count"] == 83
    assert result.profile["row_count"] == 32
    assert result.profile["duplicate_feature_rows"] == 0
    assert sum(result.profile["class_frequencies"].values()) == 32
    assert len(result.profile["dataset_sha256"]) == 64


def test_invalid_schema_is_rejected_clearly(fixture_csv, tmp_path):
    frame = pd.read_csv(fixture_csv).drop(columns=["flow_duration"])
    invalid = tmp_path / "invalid.csv"
    frame.to_csv(invalid, index=False)

    with pytest.raises(SchemaValidationError, match="missing required columns.*flow_duration"):
        validate_dataset(invalid)


def test_inference_validation_reorders_but_rejects_missing(fixture_csv):
    frame = pd.read_csv(fixture_csv).drop(columns=[TARGET_COLUMN])
    reversed_frame = frame[list(reversed(frame.columns))]
    validated = validate_observations(reversed_frame)
    assert validated.columns.tolist() == list(FEATURE_COLUMNS)

    with pytest.raises(SchemaValidationError, match="missing required features"):
        validate_observations(frame.drop(columns=["proto"]))

