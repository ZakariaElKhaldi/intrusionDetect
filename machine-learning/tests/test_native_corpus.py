from __future__ import annotations

import hashlib

import pytest

from iot_ids_ml.native_corpus import (
    NativeCorpusError,
    assign_session_splits,
    validate_capture_manifest,
    validate_label_manifest,
)


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _capture_manifest() -> dict:
    sessions = []
    for family in ("normal", *(f"attack-{index}" for index in range(9))):
        for index in range(15):
            sessions.append(
                {
                    "session_id": f"{family}-{index}",
                    "collection_run_id": f"run-{index % 3}",
                    "traffic_family": family,
                    "capture_sha256": _digest(f"{family}-{index}"),
                    "generator_identity": f"generator-{family}",
                    "started_at": f"2026-01-{index + 1:02d}T00:00:00Z",
                    "ended_at": f"2026-01-{index + 1:02d}T00:01:00Z",
                }
            )
    return {
        "schema_version": "nfstream-iot-v1",
        "containment": {
            "external_egress": "denied",
            "allowlisted_targets": ["lab-target"],
            "fixed_duration_seconds": 60,
            "rate_limit_per_second": 10,
        },
        "sessions": sessions,
    }


def test_capture_sessions_are_split_whole_and_60_20_20_per_family() -> None:
    sessions = validate_capture_manifest(_capture_manifest())
    first = assign_session_splits(sessions)
    assert assign_session_splits(list(reversed(sessions))) == first
    for family in ("normal", "attack-0"):
        family_splits = [
            first[item["session_id"]]
            for item in sessions
            if item["traffic_family"] == family
        ]
        assert family_splits.count("train") == 9
        assert family_splits.count("validation") == 3
        assert family_splits.count("test") == 3


def test_capture_manifest_refuses_unsafe_or_insufficient_collection() -> None:
    unsafe = _capture_manifest()
    unsafe["containment"]["external_egress"] = "allowed"
    with pytest.raises(NativeCorpusError, match="external egress"):
        validate_capture_manifest(unsafe)
    insufficient = _capture_manifest()
    insufficient["sessions"] = insufficient["sessions"][:-1]
    with pytest.raises(NativeCorpusError, match="at least 15"):
        validate_capture_manifest(insufficient)


def test_labels_require_five_tuple_time_generator_and_exclusion_disposition() -> None:
    manifest = _capture_manifest()
    sessions = validate_capture_manifest(manifest)
    label = {
        "session_id": "normal-0",
        "generator_identity": "generator-normal",
        "source_ip": "10.0.0.1",
        "source_port": 1000,
        "destination_ip": "10.0.0.2",
        "destination_port": 1883,
        "protocol": "tcp",
        "started_at": "2026-01-01T00:00:00Z",
        "ended_at": "2026-01-01T00:01:00Z",
        "traffic_family": "normal",
        "disposition": "included",
    }
    assert validate_label_manifest(
        {"schema_version": "nfstream-iot-v1", "labels": [label]},
        {item["session_id"] for item in sessions},
    ) == {"included": 1}
    label.pop("source_ip")
    with pytest.raises(NativeCorpusError, match="missing identity"):
        validate_label_manifest(
            {"schema_version": "nfstream-iot-v1", "labels": [label]},
            {item["session_id"] for item in sessions},
        )
