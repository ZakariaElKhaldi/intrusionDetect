"""Dataset and observation validation with reproducible profiling."""

from __future__ import annotations

import hashlib
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .schema import (
    CATEGORICAL_FEATURES,
    FEATURE_COLUMNS,
    IDENTIFIER_LIKE_COLUMNS,
    NUMERIC_FEATURES,
    SCHEMA_VERSION,
    TARGET_COLUMN,
)


class SchemaValidationError(ValueError):
    """Raised when a CSV or observation violates the canonical schema."""

    def __init__(self, issues: Iterable[str]):
        self.issues = tuple(issues)
        super().__init__("Schema validation failed: " + "; ".join(self.issues))


@dataclass(frozen=True)
class ValidatedDataset:
    frame: pd.DataFrame
    profile: dict[str, Any]
    metadata_columns: tuple[str, ...]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _json_scalar(value: Any) -> Any:
    return value.item() if hasattr(value, "item") else value


def validate_dataset(
    csv_path: str | Path,
    *,
    metadata_columns: Iterable[str] = (),
    require_target: bool = True,
) -> ValidatedDataset:
    """Load, validate, canonically order, and profile an RT-IoT2022 CSV."""

    path = Path(csv_path).expanduser().resolve()
    if not path.is_file():
        raise SchemaValidationError([f"CSV does not exist: {path}"])

    try:
        raw = pd.read_csv(path, low_memory=False)
    except Exception as exc:
        raise SchemaValidationError([f"CSV could not be read: {exc}"]) from exc

    original_columns = [str(column) for column in raw.columns]
    removed: list[dict[str, str]] = []
    for column in tuple(raw.columns):
        if str(column).startswith("Unnamed:") or column in IDENTIFIER_LIKE_COLUMNS:
            raw = raw.drop(columns=[column])
            removed.append(
                {
                    "column": str(column),
                    "reason": "CSV index artifact; excluded as identifier/leakage-prone",
                }
            )

    metadata = tuple(dict.fromkeys(str(column) for column in metadata_columns if column))
    expected = list(FEATURE_COLUMNS) + ([TARGET_COLUMN] if require_target else [])
    required = set(expected)
    allowed = required | set(metadata)
    actual = set(raw.columns)
    issues: list[str] = []

    missing_columns = sorted(required - actual)
    extra_columns = sorted(actual - allowed)
    missing_metadata = sorted(set(metadata) - actual)
    if missing_columns:
        issues.append(f"missing required columns: {missing_columns}")
    if extra_columns:
        issues.append(
            f"unexpected columns: {extra_columns}; pass grouping/time metadata explicitly"
        )
    if missing_metadata:
        issues.append(f"requested metadata columns are absent: {missing_metadata}")

    model_columns_in_file = [column for column in raw.columns if column in required]
    if not missing_columns and model_columns_in_file != expected:
        issues.append(
            "canonical column order mismatch; expected the 83 UCI features followed by Attack_type"
        )

    if issues:
        raise SchemaValidationError(issues)

    ordered = raw[[*expected, *metadata]].copy()
    coercion_failures: dict[str, int] = {}
    for column in NUMERIC_FEATURES:
        converted = pd.to_numeric(ordered[column], errors="coerce")
        failures = int((converted.isna() & ordered[column].notna()).sum())
        if failures:
            coercion_failures[column] = failures
        ordered[column] = converted

    missing_counts = {
        column: int(count)
        for column, count in ordered.isna().sum().items()
        if int(count) > 0
    }
    numeric_values = ordered[list(NUMERIC_FEATURES)].to_numpy(dtype=float, copy=False)
    infinite_count = int(np.isinf(numeric_values).sum())
    if coercion_failures:
        issues.append(f"non-numeric values in numeric features: {coercion_failures}")
    if missing_counts:
        issues.append(f"missing values: {missing_counts}")
    if infinite_count:
        issues.append(f"infinite numeric values: {infinite_count}")
    if require_target and ordered[TARGET_COLUMN].astype(str).str.strip().eq("").any():
        issues.append("target contains blank labels")
    if len(ordered) == 0:
        issues.append("dataset has no rows")
    if issues:
        raise SchemaValidationError(issues)

    categorical_cardinality = {
        column: int(ordered[column].nunique(dropna=False))
        for column in CATEGORICAL_FEATURES
    }
    label_counts = (
        {
            str(label): int(count)
            for label, count in ordered[TARGET_COLUMN].value_counts().sort_index().items()
        }
        if require_target
        else {}
    )
    suspicious_columns = [
        column
        for column in original_columns
        if column.startswith("Unnamed:")
        or any(token in column.lower() for token in ("uuid", "event_id", "row_id"))
    ]
    profile: dict[str, Any] = {
        "valid": True,
        "schema_version": SCHEMA_VERSION,
        "dataset_path": str(path),
        "dataset_sha256": sha256_file(path),
        "row_count": int(len(ordered)),
        "source_column_count": len(original_columns),
        "feature_count": len(FEATURE_COLUMNS),
        "target_column": TARGET_COLUMN if require_target else None,
        "class_frequencies": label_counts,
        "duplicate_rows": int(ordered.duplicated().sum()),
        "duplicate_feature_rows": int(ordered[list(FEATURE_COLUMNS)].duplicated().sum()),
        "missing_values": missing_counts,
        "infinite_values": infinite_count,
        "categorical_cardinality": categorical_cardinality,
        "identifier_or_leakage_candidates": suspicious_columns,
        "removed_features": removed,
        "metadata_columns": list(metadata),
        "feature_order": list(FEATURE_COLUMNS),
        "observed_dtypes": {
            column: str(dtype) for column, dtype in ordered[list(FEATURE_COLUMNS)].dtypes.items()
        },
        "limitations": [
            "Schema validation cannot prove Zeek/Flowmeter and CICFlowMeter value equivalence.",
            "Feature units are not reliably specified by the UCI variable metadata.",
        ],
    }
    return ValidatedDataset(frame=ordered, profile=profile, metadata_columns=metadata)


def validate_observations(frame: pd.DataFrame) -> pd.DataFrame:
    """Validate inference rows and return them in canonical feature order."""

    issues: list[str] = []
    missing = sorted(set(FEATURE_COLUMNS) - set(frame.columns))
    extra = sorted(set(frame.columns) - set(FEATURE_COLUMNS))
    if missing:
        issues.append(f"missing required features: {missing}")
    if extra:
        issues.append(f"unexpected features: {extra}")
    if issues:
        raise SchemaValidationError(issues)

    ordered = frame[list(FEATURE_COLUMNS)].copy()
    for column in NUMERIC_FEATURES:
        ordered[column] = pd.to_numeric(ordered[column], errors="coerce")
    missing_counts = {
        column: _json_scalar(count)
        for column, count in ordered.isna().sum().items()
        if count
    }
    if missing_counts:
        issues.append(f"missing or invalid values: {missing_counts}")
    numeric_values = ordered[list(NUMERIC_FEATURES)].to_numpy(dtype=float, copy=False)
    if np.isinf(numeric_values).any():
        issues.append("infinite numeric values")
    if issues:
        raise SchemaValidationError(issues)
    return ordered
