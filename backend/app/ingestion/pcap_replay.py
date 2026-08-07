from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.features.nfstream_extractor import MANIFEST


class PcapCompatibilityError(RuntimeError):
    pass


def load_compatibility_evidence(path: str | Path) -> dict[str, Any]:
    evidence_path = Path(path).expanduser().resolve()
    try:
        value = json.loads(evidence_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PcapCompatibilityError(f"invalid compatibility evidence: {exc}") from exc
    if not isinstance(value, dict):
        raise PcapCompatibilityError("compatibility evidence must be a JSON object")
    return value


def require_validated_extractor(
    evidence: dict[str, Any] | None = None,
    *,
    detector_model_version: str | None = None,
    classifier_model_version: str | None = None,
) -> None:
    if evidence is None:
        raise PcapCompatibilityError(
            "PCAP inference is blocked: validate-only output is inspection evidence, not "
            "RT-IoT2022 value-compatibility evidence"
        )
    if evidence.get("schema_version") != MANIFEST.schema_version:
        raise PcapCompatibilityError("compatibility evidence schema version does not match")
    if evidence.get("extractor_fingerprint") != MANIFEST.fingerprint:
        raise PcapCompatibilityError("compatibility evidence extractor fingerprint does not match")
    if evidence.get("inference_compatible") is not True:
        raise PcapCompatibilityError("compatibility evidence has not approved inference")
    checksums = evidence.get("validated_fixture_checksums")
    if not isinstance(checksums, list) or not checksums:
        raise PcapCompatibilityError(
            "compatibility evidence has no validated golden-corpus checksums"
        )
    model_versions = evidence.get("compatible_model_versions")
    if not isinstance(model_versions, dict):
        raise PcapCompatibilityError("compatibility evidence has no compatible model versions")
    if not all(
        isinstance(model_versions.get(stage), str) and model_versions[stage].strip()
        for stage in ("detector", "classifier")
    ):
        raise PcapCompatibilityError(
            "compatibility evidence must name compatible detector and classifier versions"
        )
    expected = {
        "detector": detector_model_version,
        "classifier": classifier_model_version,
    }
    for stage, active_version in expected.items():
        if active_version is not None and model_versions.get(stage) != active_version:
            raise PcapCompatibilityError(
                f"compatibility evidence does not cover active {stage} model {active_version!r}"
            )
