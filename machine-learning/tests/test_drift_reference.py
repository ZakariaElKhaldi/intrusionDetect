from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from iot_ids_ml.drift_reference import build_drift_reference, canonical_json_sha256
from iot_ids_ml.schema import FEATURE_COLUMNS


class Detector:
    classes_ = np.asarray(["attack", "normal"])

    def predict(self, frame):
        return np.where(frame["flow_SYN_flag_count"].to_numpy() > 0, "attack", "normal")

    def predict_proba(self, frame):
        attack = np.where(frame["flow_SYN_flag_count"].to_numpy() > 0, 0.9, 0.1)
        return np.column_stack((attack, 1 - attack))


class Classifier:
    def predict(self, frame):
        return np.repeat("DOS_SYN_Hping", len(frame))


def frame_fixture(rows: int = 40) -> pd.DataFrame:
    values: dict[str, object] = {}
    for name in FEATURE_COLUMNS:
        if name == "proto":
            values[name] = np.where(np.arange(rows) % 2, "tcp", "udp")
        elif name == "service":
            values[name] = np.where(np.arange(rows) % 2, "mqtt", "dns")
        else:
            values[name] = np.arange(rows, dtype=float)
    values["Attack_type"] = np.where(
        np.arange(rows) % 2, "DOS_SYN_Hping", "MQTT_Publish"
    )
    return pd.DataFrame(values)


def test_reference_is_deterministic_and_partition_bound() -> None:
    frame = frame_fixture()
    kwargs = {
        "train_indices": np.arange(30),
        "test_indices": np.arange(30, 40),
        "detector": Detector(),
        "classifier": Classifier(),
        "detector_model_version": "detector-v1",
        "classifier_model_version": "classifier-v1",
        "dataset_sha256": "a" * 64,
        "calibration_rounds": 5,
        "calibration_window_size": 10,
    }
    first = build_drift_reference(frame, **kwargs)
    second = build_drift_reference(frame, **kwargs)
    assert first == second
    assert first["reference_schema_version"] == "drift-reference-v1"
    assert len(first["numeric_features"]) == 81
    assert set(first["categorical_features"]) == {"proto", "service"}
    content = dict(first)
    digest = content.pop("content_sha256")
    assert digest == canonical_json_sha256(content)


def test_reference_rejects_partition_overlap() -> None:
    with pytest.raises(ValueError, match="disjoint"):
        build_drift_reference(
            frame_fixture(),
            train_indices=np.arange(30),
            test_indices=np.arange(29, 40),
            detector=Detector(),
            classifier=Classifier(),
            detector_model_version="detector-v1",
            classifier_model_version="classifier-v1",
            dataset_sha256="a" * 64,
            calibration_rounds=2,
        )
