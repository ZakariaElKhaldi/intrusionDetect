from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.inference.model_registry import ModelRegistry


def test_registry_discovers_binary_pipeline_and_metadata(model_dir: Path) -> None:
    registry = ModelRegistry(model_dir=str(model_dir))
    descriptor = registry.descriptor
    assert descriptor.model_version.startswith("binary-")
    assert descriptor.schema_version == "rt-iot2022-v1"
    assert descriptor.metadata_json
    assert len(descriptor.metadata_json["feature_order"]) == 83
    assert descriptor.metadata_json["target"] == "binary"


def test_registry_rejects_manifest_checksum_mismatch(
    tmp_path: Path, model_dir: Path
) -> None:
    manifest = json.loads((model_dir / "manifest.json").read_text(encoding="utf-8"))
    binary = next(item for item in manifest["models"] if item["target"] == "binary")
    artifact_source = model_dir / binary["artifact"]
    metadata_source = model_dir / binary["metadata"]
    (tmp_path / binary["artifact"]).write_bytes(artifact_source.read_bytes() + b"corrupt")
    (tmp_path / binary["metadata"]).write_bytes(metadata_source.read_bytes())
    (tmp_path / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(ValueError, match="checksum does not match manifest"):
        ModelRegistry(model_dir=str(tmp_path))


def test_explicit_artifact_override_loads_sidecar(model_dir: Path) -> None:
    manifest = json.loads((model_dir / "manifest.json").read_text(encoding="utf-8"))
    binary = next(item for item in manifest["models"] if item["target"] == "binary")
    registry = ModelRegistry(artifact_path=str(model_dir / binary["artifact"]))
    assert registry.predictor.version == binary["model_version"]

