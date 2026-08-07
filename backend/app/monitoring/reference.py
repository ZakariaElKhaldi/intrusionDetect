from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


class DriftReferenceError(ValueError):
    pass


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_sha256(value: dict[str, Any]) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def load_drift_reference(
    bundle_dir: Path | None,
    manifest: dict[str, Any] | None,
    *,
    detector_model_version: str,
    classifier_model_version: str,
) -> dict[str, Any] | None:
    """Load a manifest-bound reference; return None for legacy bundles."""
    if bundle_dir is None or manifest is None:
        return None
    name = manifest.get("drift_reference")
    expected_checksum = manifest.get("drift_reference_sha256")
    if name is None and expected_checksum is None:
        return None
    if not isinstance(name, str) or not isinstance(expected_checksum, str):
        raise DriftReferenceError("drift reference manifest fields are incomplete")
    path = (bundle_dir / name).resolve()
    if path.parent != bundle_dir.resolve() or not path.is_file():
        raise DriftReferenceError("drift reference path is missing or escapes its bundle")
    if file_sha256(path) != expected_checksum:
        raise DriftReferenceError("drift reference checksum does not match manifest")
    try:
        reference = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DriftReferenceError(f"drift reference is not valid JSON: {exc}") from exc
    if reference.get("reference_schema_version") != "drift-reference-v1":
        raise DriftReferenceError("unsupported drift reference schema version")
    content = dict(reference)
    content_checksum = content.pop("content_sha256", None)
    if content_checksum != canonical_sha256(content):
        raise DriftReferenceError("drift reference content checksum is invalid")
    if reference.get("detector_model_version") != detector_model_version:
        raise DriftReferenceError("drift reference detector version is stale")
    if reference.get("classifier_model_version") != classifier_model_version:
        raise DriftReferenceError("drift reference classifier version is stale")
    if not reference.get("numeric_features") or not reference.get("categorical_features"):
        raise DriftReferenceError("drift reference contains no feature evidence")
    reference["artifact_sha256"] = expected_checksum
    return reference
