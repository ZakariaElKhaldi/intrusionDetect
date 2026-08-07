"""Deterministic provenance and session splitting for an NFStream-native corpus.

This module deliberately does not generate traffic or labels. It validates records
produced by an isolated, authorized capture lab and refuses incomplete evidence.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

NATIVE_SCHEMA_VERSION = "nfstream-iot-v1"
SPLIT_POLICY_VERSION = "capture-session-60-20-20-v1"
MIN_SESSIONS_PER_FAMILY = 15
MIN_COLLECTION_RUNS = 3


class NativeCorpusError(ValueError):
    """Capture or label provenance is insufficient for native model training."""


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_value(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def _load_object(path: str | Path) -> dict[str, Any]:
    source = Path(path)
    try:
        value = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise NativeCorpusError(f"cannot read valid JSON from {source}: {exc}") from exc
    if not isinstance(value, dict):
        raise NativeCorpusError(f"{source} must contain a JSON object")
    return value


def _require_digest(value: Any, field: str) -> str:
    if not isinstance(value, str) or len(value) != 64:
        raise NativeCorpusError(f"{field} must be a SHA-256 digest")
    try:
        bytes.fromhex(value)
    except ValueError as exc:
        raise NativeCorpusError(f"{field} must be hexadecimal") from exc
    return value


def validate_capture_manifest(value: dict[str, Any]) -> list[dict[str, Any]]:
    """Validate lab containment, checksums, and independent session coverage."""

    if value.get("schema_version") != NATIVE_SCHEMA_VERSION:
        raise NativeCorpusError("capture manifest schema_version is not nfstream-iot-v1")
    containment = value.get("containment")
    if not isinstance(containment, dict) or containment.get("external_egress") != "denied":
        raise NativeCorpusError("capture lab must attest that external egress was denied")
    if not containment.get("allowlisted_targets"):
        raise NativeCorpusError("capture lab must identify at least one allowlisted target")
    if not containment.get("fixed_duration_seconds") or not containment.get(
        "rate_limit_per_second"
    ):
        raise NativeCorpusError("capture lab must record fixed duration and rate limits")

    sessions = value.get("sessions")
    if not isinstance(sessions, list) or not sessions:
        raise NativeCorpusError("capture manifest has no sessions")
    required = {
        "session_id",
        "collection_run_id",
        "traffic_family",
        "capture_sha256",
        "generator_identity",
        "started_at",
        "ended_at",
    }
    seen_ids: set[str] = set()
    seen_captures: set[str] = set()
    normalized: list[dict[str, Any]] = []
    for position, session in enumerate(sessions):
        if not isinstance(session, dict) or not required.issubset(session):
            raise NativeCorpusError(f"capture session {position} is missing required provenance")
        session_id = str(session["session_id"])
        if session_id in seen_ids:
            raise NativeCorpusError(f"duplicate capture session_id {session_id!r}")
        capture = _require_digest(session["capture_sha256"], "capture_sha256")
        if capture in seen_captures:
            raise NativeCorpusError("one capture checksum cannot represent independent sessions")
        if session["started_at"] >= session["ended_at"]:
            raise NativeCorpusError(f"capture session {session_id!r} has invalid time bounds")
        seen_ids.add(session_id)
        seen_captures.add(capture)
        normalized.append(dict(session))

    by_family: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for session in normalized:
        by_family[str(session["traffic_family"])].append(session)
    if "normal" not in by_family:
        raise NativeCorpusError("capture manifest has no normal sessions")
    attack_families = set(by_family) - {"normal"}
    if len(attack_families) != 9:
        raise NativeCorpusError(
            f"capture manifest must contain nine attack families, got {len(attack_families)}"
        )
    for family, family_sessions in sorted(by_family.items()):
        if len(family_sessions) < MIN_SESSIONS_PER_FAMILY:
            raise NativeCorpusError(
                f"traffic family {family!r} has {len(family_sessions)} sessions; "
                f"at least {MIN_SESSIONS_PER_FAMILY} are required"
            )
        runs = {str(item["collection_run_id"]) for item in family_sessions}
        if len(runs) < MIN_COLLECTION_RUNS:
            raise NativeCorpusError(
                f"traffic family {family!r} spans {len(runs)} collection runs; "
                f"at least {MIN_COLLECTION_RUNS} are required"
            )
    return normalized


def validate_label_manifest(
    value: dict[str, Any], session_ids: set[str]
) -> dict[str, int]:
    """Require five-tuple/time/generator labels and explicit ambiguity exclusion."""

    if value.get("schema_version") != NATIVE_SCHEMA_VERSION:
        raise NativeCorpusError("label manifest schema_version is not nfstream-iot-v1")
    labels = value.get("labels")
    if not isinstance(labels, list) or not labels:
        raise NativeCorpusError("label manifest has no labels")
    counts: Counter[str] = Counter()
    required = {
        "session_id",
        "generator_identity",
        "source_ip",
        "source_port",
        "destination_ip",
        "destination_port",
        "protocol",
        "started_at",
        "ended_at",
        "traffic_family",
        "disposition",
    }
    for position, label in enumerate(labels):
        if not isinstance(label, dict) or not required.issubset(label):
            raise NativeCorpusError(f"label {position} is missing identity or boundary fields")
        if str(label["session_id"]) not in session_ids:
            raise NativeCorpusError(f"label {position} references an unknown capture session")
        disposition = label["disposition"]
        if disposition not in {"included", "excluded_ambiguous", "excluded_unmatched"}:
            raise NativeCorpusError(f"label {position} has an unsupported disposition")
        counts[str(disposition)] += 1
    if counts["included"] == 0:
        raise NativeCorpusError("label manifest contains no unambiguous matched labels")
    return dict(counts)


def assign_session_splits(
    sessions: list[dict[str, Any]], *, seed: str = SPLIT_POLICY_VERSION
) -> dict[str, str]:
    """Assign whole sessions to deterministic 60/20/20 family-stratified splits."""

    by_family: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for session in sessions:
        by_family[str(session["traffic_family"])].append(session)
    assignments: dict[str, str] = {}
    for family, values in sorted(by_family.items()):
        ordered = sorted(
            values,
            key=lambda item: _sha256_value(
                [seed, family, item["session_id"], item["capture_sha256"]]
            ),
        )
        count = len(ordered)
        train_end = int(count * 0.60)
        validation_end = train_end + int(count * 0.20)
        for index, session in enumerate(ordered):
            split = (
                "train"
                if index < train_end
                else "validation"
                if index < validation_end
                else "test"
            )
            assignments[str(session["session_id"])] = split
    return assignments


def build_corpus_manifest(
    capture_manifest_path: str | Path,
    label_manifest_path: str | Path,
    extractor_manifest_path: str | Path,
    *,
    extractor_fingerprint: str,
) -> dict[str, Any]:
    """Build content-addressed training input evidence without approving inference."""

    capture = _load_object(capture_manifest_path)
    labels = _load_object(label_manifest_path)
    sessions = validate_capture_manifest(capture)
    label_counts = validate_label_manifest(
        labels, {str(item["session_id"]) for item in sessions}
    )
    _require_digest(extractor_fingerprint, "extractor_fingerprint")
    assignments = assign_session_splits(sessions)
    split_counts = Counter(assignments.values())
    family_counts = Counter(str(item["traffic_family"]) for item in sessions)
    return {
        "corpus_manifest_version": "nfstream-native-corpus-v1",
        "schema_version": NATIVE_SCHEMA_VERSION,
        "extractor_fingerprint": extractor_fingerprint,
        "extractor_manifest_sha256": sha256_file(extractor_manifest_path),
        "capture_manifest_sha256": sha256_file(capture_manifest_path),
        "label_manifest_sha256": sha256_file(label_manifest_path),
        "split_policy": SPLIT_POLICY_VERSION,
        "session_assignments": dict(sorted(assignments.items())),
        "session_assignment_sha256": _sha256_value(assignments),
        "session_counts_by_split": dict(sorted(split_counts.items())),
        "session_counts_by_family": dict(sorted(family_counts.items())),
        "label_dispositions": label_counts,
        "inference_compatible": False,
        "state": "awaiting_training_and_promotion_gates",
    }
