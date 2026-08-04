from __future__ import annotations

import json
import zipfile

import pandas as pd
import pytest

from iot_ids_ml.preparation import prepare_dataset
from iot_ids_ml.validation import validate_dataset


def test_prepare_accepts_named_index_and_records_provenance(fixture_csv, tmp_path):
    frame = pd.read_csv(fixture_csv)
    indexed = tmp_path / "indexed.csv"
    frame.to_csv(indexed, index=True, index_label="no")
    archive = tmp_path / "archive.zip"
    with zipfile.ZipFile(archive, "w") as handle:
        handle.write(indexed, "RT_IOT2022.csv")

    prepared = prepare_dataset(archive, tmp_path / "raw")
    destination = tmp_path / "raw" / "RT_IOT2022.csv"
    manifest = json.loads((tmp_path / "dataset-manifest.json").read_text())

    assert prepared["extracted"]["rows"] == 32
    assert destination.is_file()
    assert manifest["archive"]["member"] == "RT_IOT2022.csv"
    assert validate_dataset(destination).profile["row_count"] == 32


def test_prepare_rejects_traversal_member(tmp_path):
    archive = tmp_path / "unsafe.zip"
    with zipfile.ZipFile(archive, "w") as handle:
        handle.writestr("../dataset.csv", "bad")

    with pytest.raises(ValueError, match="Unsafe archive member"):
        prepare_dataset(archive, tmp_path / "raw")

