from __future__ import annotations

import pandas as pd
import pytest

from iot_ids_ml.native_corpus import NativeCorpusError
from iot_ids_ml.native_training import validate_native_training_frame
from iot_ids_ml.schema import FEATURE_COLUMNS, TARGET_COLUMN


def _frame() -> pd.DataFrame:
    rows = []
    for session, label in (("train-1", "MQTT"), ("validation-1", "DOS"), ("test-1", "DOS")):
        row = {name: 0.0 for name in FEATURE_COLUMNS}
        row["proto"] = "tcp"
        row["service"] = "mqtt"
        row[TARGET_COLUMN] = label
        row["capture_session"] = session
        rows.append(row)
    return pd.DataFrame(rows)


def test_native_training_uses_only_manifest_session_assignments() -> None:
    manifest = {
        "session_assignments": {
            "train-1": "train",
            "validation-1": "validation",
            "test-1": "test",
        }
    }
    partitions = validate_native_training_frame(_frame(), manifest)
    assert {name: len(indices) for name, indices in partitions.items()} == {
        "train": 1,
        "validation": 1,
        "test": 1,
    }


def test_native_training_refuses_rows_outside_signed_sessions() -> None:
    with pytest.raises(NativeCorpusError, match="unassigned sessions"):
        validate_native_training_frame(
            _frame(),
            {"session_assignments": {"train-1": "train", "test-1": "test"}},
        )
