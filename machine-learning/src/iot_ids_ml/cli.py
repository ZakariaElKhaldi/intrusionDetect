"""Console entry points."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence

from .training import train_baselines
from .validation import SchemaValidationError, validate_dataset


def _profile_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="iot-ids-profile",
        description="Validate and print a reproducible RT-IoT2022 dataset profile.",
    )
    parser.add_argument("csv", help="Path to a fixture or real RT-IoT2022 CSV")
    parser.add_argument(
        "--metadata-column",
        action="append",
        default=[],
        help="Allow and profile an extra non-feature column (repeatable)",
    )
    return parser


def _train_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="iot-ids-train",
        description="Train binary and multiclass leakage-safe baseline pipelines.",
    )
    parser.add_argument("csv", help="Path to a fixture or real RT-IoT2022 CSV")
    parser.add_argument("--output-dir", required=True, help="Artifact/report directory")
    parser.add_argument("--seed", type=int, default=42)
    realistic = parser.add_mutually_exclusive_group()
    realistic.add_argument("--group-column", help="Extra capture/device/scenario group field")
    realistic.add_argument("--time-column", help="Extra reliable chronological field")
    return parser


def profile_main(argv: Sequence[str] | None = None) -> int:
    args = _profile_parser().parse_args(argv)
    try:
        result = validate_dataset(args.csv, metadata_columns=args.metadata_column)
    except SchemaValidationError as exc:
        print(json.dumps({"valid": False, "issues": list(exc.issues)}, indent=2), file=sys.stderr)
        return 2
    print(json.dumps(result.profile, indent=2, sort_keys=True))
    return 0


def train_main(argv: Sequence[str] | None = None) -> int:
    args = _train_parser().parse_args(argv)
    try:
        result = train_baselines(
            args.csv,
            args.output_dir,
            seed=args.seed,
            group_column=args.group_column,
            time_column=args.time_column,
        )
    except (SchemaValidationError, ValueError) as exc:
        print(json.dumps({"trained": False, "error": str(exc)}, indent=2), file=sys.stderr)
        return 2
    print(json.dumps({"trained": True, **result}, indent=2, sort_keys=True))
    return 0
