from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import pytest

from app.inference.model_registry import ModelRegistry, ModelRouteError


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _native_bundle(source: Path, destination: Path, fingerprint: str) -> None:
    destination.mkdir()
    source_manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
    manifest = dict(source_manifest)
    manifest["schema_version"] = "nfstream-iot-v1"
    shutil.copy2(
        source / manifest["evaluation_report"],
        destination / manifest["evaluation_report"],
    )
    bindings = {}
    model_entries = []
    for source_entry in manifest["models"]:
        entry = dict(source_entry)
        shutil.copy2(source / entry["artifact"], destination / entry["artifact"])
        metadata = json.loads((source / entry["metadata"]).read_text(encoding="utf-8"))
        metadata["schema_version"] = "nfstream-iot-v1"
        (destination / entry["metadata"]).write_text(json.dumps(metadata), encoding="utf-8")
        entry["metadata_sha256"] = _sha256(destination / entry["metadata"])
        model_entries.append(entry)
        bindings[entry["target"]] = {
            "model_version": entry["model_version"],
            "artifact_sha256": entry["artifact_sha256"],
        }
    manifest["models"] = model_entries
    gates = {
        name: {"passed": True}
        for name in (
            "detector_recall",
            "normal_false_positive_rate",
            "cascade_macro_f1",
            "per_attack_family_recall",
            "test_support",
        )
    }
    evidence = {
        "evidence_version": "extractor-model-compatibility-v1",
        "status": "approved",
        "schema_version": "nfstream-iot-v1",
        "extractor_fingerprint": fingerprint,
        "extractor_manifest_sha256": "1" * 64,
        "corpus_manifest_sha256": "2" * 64,
        "label_manifest_sha256": "3" * 64,
        "evaluation_report_sha256": manifest["evaluation_report_sha256"],
        "training_split_policy": "capture-session-60-20-20-v1",
        "evaluation_policy_version": "nfstream-native-promotion-v1",
        "models": bindings,
        "promotion_gates": gates,
    }
    evidence_path = destination / "compatibility-evidence.json"
    evidence_path.write_text(json.dumps(evidence), encoding="utf-8")
    manifest["compatibility_evidence"] = evidence_path.name
    manifest["compatibility_evidence_sha256"] = _sha256(evidence_path)
    (destination / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def test_registry_discovers_binary_pipeline_and_metadata(model_dir: Path) -> None:
    registry = ModelRegistry(model_dir=str(model_dir), allow_fallback=True)
    descriptor = registry.descriptor
    assert descriptor.model_version.startswith("binary-")
    assert descriptor.schema_version == "rt-iot2022-v1"
    assert descriptor.metadata_json
    assert len(descriptor.metadata_json["feature_order"]) == 83
    assert descriptor.metadata_json["target"] == "binary"
    assert len(registry.descriptors) == 2
    assert {item.metadata_json["target"] for item in registry.descriptors} == {
        "binary",
        "multiclass",
    }


def test_registry_requires_explicit_development_fallback() -> None:
    with pytest.raises(RuntimeError, match="ALLOW_FALLBACK"):
        ModelRegistry()

    registry = ModelRegistry(allow_fallback=True)
    assert registry.detector.metadata["fallback"] is True
    assert registry.classifier.metadata["fallback"] is True


def test_registry_rejects_fixture_artifacts_without_development_flag(
    model_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.inference.model_registry._is_fixture_run", lambda _model_dir: True
    )
    with pytest.raises(RuntimeError, match="fixture-trained"):
        ModelRegistry(model_dir=str(model_dir))


def test_registry_rejects_manifest_checksum_mismatch(
    tmp_path: Path, model_dir: Path
) -> None:
    manifest = json.loads((model_dir / "manifest.json").read_text(encoding="utf-8"))
    binary = next(item for item in manifest["models"] if item["target"] == "binary")
    artifact_source = model_dir / binary["artifact"]
    metadata_source = model_dir / binary["metadata"]
    (tmp_path / binary["artifact"]).write_bytes(artifact_source.read_bytes() + b"corrupt")
    (tmp_path / binary["metadata"]).write_bytes(metadata_source.read_bytes())
    report_name = manifest["evaluation_report"]
    (tmp_path / report_name).write_bytes((model_dir / report_name).read_bytes())
    (tmp_path / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(ValueError, match="checksum does not match manifest"):
        ModelRegistry(model_dir=str(tmp_path))


def test_explicit_artifact_override_loads_sidecar(model_dir: Path) -> None:
    manifest = json.loads((model_dir / "manifest.json").read_text(encoding="utf-8"))
    binary = next(item for item in manifest["models"] if item["target"] == "binary")
    registry = ModelRegistry(
        artifact_path=str(model_dir / binary["artifact"]), allow_fallback=True
    )
    assert registry.predictor.version == binary["model_version"]


def test_registry_preserves_rt_route_and_blocks_uninstalled_native_route(
    model_dir: Path,
) -> None:
    registry = ModelRegistry(model_dir=str(model_dir), allow_fallback=True)
    route = registry.resolve_route("rt-iot2022-v1", None)
    assert route.detector is registry.detector
    with pytest.raises(ModelRouteError, match="no approved model route"):
        registry.resolve_route("nfstream-iot-v1", "a" * 64)
    with pytest.raises(ModelRouteError, match="no approved rt-iot2022-v1"):
        registry.resolve_route("rt-iot2022-v1", "a" * 64)


def test_invalid_native_bundle_does_not_disable_rt_serving(
    tmp_path: Path, model_dir: Path
) -> None:
    native = tmp_path / "native"
    native.mkdir()
    (native / "manifest.json").write_text(
        json.dumps({"schema_version": "nfstream-iot-v1"}), encoding="utf-8"
    )
    registry = ModelRegistry(
        model_dir=str(model_dir), allow_fallback=True, nfstream_model_dir=str(native)
    )
    assert registry.resolve_route("rt-iot2022-v1", None).detector is registry.detector
    assert registry.native_route_error is not None
    with pytest.raises(ModelRouteError, match="configured native bundle is invalid"):
        registry.resolve_route("nfstream-iot-v1", "a" * 64)


def test_native_route_requires_checksum_linked_bundle_evidence(
    tmp_path: Path, model_dir: Path
) -> None:
    fingerprint = "a" * 64
    native = tmp_path / "native"
    _native_bundle(model_dir, native, fingerprint)
    registry = ModelRegistry(
        model_dir=str(model_dir), allow_fallback=True, nfstream_model_dir=str(native)
    )
    route = registry.resolve_route("nfstream-iot-v1", fingerprint)
    assert route.schema_version == "nfstream-iot-v1"
    assert {item.schema_version for item in registry.descriptors} == {
        "rt-iot2022-v1",
        "nfstream-iot-v1",
    }
    assert route.compatibility_evidence["evidence_sha256"] == _sha256(
        native / "compatibility-evidence.json"
    )
    with pytest.raises(ModelRouteError, match="no approved model route"):
        registry.resolve_route("nfstream-iot-v1", "b" * 64)


def test_tampered_native_evidence_is_not_activated(
    tmp_path: Path, model_dir: Path
) -> None:
    native = tmp_path / "native"
    _native_bundle(model_dir, native, "a" * 64)
    evidence_path = native / "compatibility-evidence.json"
    evidence_path.write_bytes(evidence_path.read_bytes() + b" ")
    registry = ModelRegistry(
        model_dir=str(model_dir), allow_fallback=True, nfstream_model_dir=str(native)
    )
    assert "checksum" in registry.native_route_error
    assert registry.resolve_route("rt-iot2022-v1", None).detector is registry.detector
