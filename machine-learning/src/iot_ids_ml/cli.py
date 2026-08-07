"""Console entry points."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from .native_corpus import NativeCorpusError, build_corpus_manifest
from .native_training import train_native_models
from .preparation import prepare_dataset
from .promotion import ProductionBundleError, promote_bundle, verify_bundle
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
    seeds = parser.add_mutually_exclusive_group()
    seeds.add_argument("--seed", type=int, help="Run one seed (intended for fixture tests)")
    seeds.add_argument(
        "--seeds",
        type=int,
        nargs="+",
        help="Evaluation seeds (default: 42 1337 2026)",
    )
    realistic = parser.add_mutually_exclusive_group()
    realistic.add_argument("--group-column", help="Extra capture/device/scenario group field")
    realistic.add_argument("--time-column", help="Extra reliable chronological field")
    return parser


def _prepare_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="iot-ids-prepare",
        description="Safely extract, validate, and record RT-IoT2022 provenance.",
    )
    parser.add_argument("archive", help="Path to the RT-IoT2022 zip archive")
    parser.add_argument("--output-dir", required=True, help="Prepared data directory")
    parser.add_argument(
        "--manifest-path",
        help="Provenance JSON path (default: OUTPUT_DIR/../dataset-manifest.json)",
    )
    parser.add_argument("--expected-archive-sha256")
    parser.add_argument("--expected-dataset-sha256")
    return parser


def _bundle_parser(program: str, *, promotion: bool) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog=program,
        description=(
            "Verify and atomically promote a model run."
            if promotion
            else "Verify a production model bundle and all referenced checksums."
        ),
    )
    if promotion:
        parser.add_argument("--run-dir", required=True)
    parser.add_argument("--production-dir", required=True)
    parser.add_argument("--expected-dataset-sha256", required=True)
    parser.add_argument("--expected-row-count", type=int, required=True)
    return parser


def _native_corpus_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="iot-ids-native-corpus",
        description="Validate NFStream capture provenance and freeze session-level splits.",
    )
    parser.add_argument("--capture-manifest", required=True)
    parser.add_argument("--label-manifest", required=True)
    parser.add_argument("--extractor-manifest", required=True)
    parser.add_argument("--extractor-fingerprint", required=True)
    parser.add_argument("--output", required=True)
    return parser


def _native_train_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="iot-ids-native-train",
        description="Train and gate models on a frozen NFStream-native corpus.",
    )
    parser.add_argument("csv")
    parser.add_argument("--corpus-manifest", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--seed", type=int, default=42)
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
            seeds=args.seeds,
            group_column=args.group_column,
            time_column=args.time_column,
        )
    except (SchemaValidationError, ValueError) as exc:
        print(json.dumps({"trained": False, "error": str(exc)}, indent=2), file=sys.stderr)
        return 2
    print(json.dumps({"trained": True, **result}, indent=2, sort_keys=True))
    return 0


def prepare_main(argv: Sequence[str] | None = None) -> int:
    args = _prepare_parser().parse_args(argv)
    try:
        result = prepare_dataset(
            args.archive,
            args.output_dir,
            manifest_path=args.manifest_path,
            expected_archive_sha256=args.expected_archive_sha256,
            expected_dataset_sha256=args.expected_dataset_sha256,
        )
    except (SchemaValidationError, ValueError, OSError) as exc:
        print(json.dumps({"prepared": False, "error": str(exc)}, indent=2), file=sys.stderr)
        return 2
    print(json.dumps({"prepared": True, **result}, indent=2, sort_keys=True))
    return 0


def promote_main(argv: Sequence[str] | None = None) -> int:
    args = _bundle_parser("iot-ids-promote", promotion=True).parse_args(argv)
    try:
        result = promote_bundle(
            args.run_dir,
            args.production_dir,
            expected_dataset_sha256=args.expected_dataset_sha256,
            expected_row_count=args.expected_row_count,
        )
    except (ProductionBundleError, ValueError, OSError) as exc:
        print(json.dumps({"promoted": False, "error": str(exc)}, indent=2), file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


def verify_main(argv: Sequence[str] | None = None) -> int:
    args = _bundle_parser("iot-ids-verify", promotion=False).parse_args(argv)
    try:
        result = verify_bundle(
            args.production_dir,
            expected_dataset_sha256=args.expected_dataset_sha256,
            expected_row_count=args.expected_row_count,
        )
    except (ProductionBundleError, ValueError, OSError) as exc:
        print(json.dumps({"valid": False, "error": str(exc)}, indent=2), file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


def native_corpus_main(argv: Sequence[str] | None = None) -> int:
    args = _native_corpus_parser().parse_args(argv)
    try:
        result = build_corpus_manifest(
            args.capture_manifest,
            args.label_manifest,
            args.extractor_manifest,
            extractor_fingerprint=args.extractor_fingerprint,
        )
        output = Path(args.output).expanduser()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    except (NativeCorpusError, ValueError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"valid": False, "error": str(exc)}, indent=2), file=sys.stderr)
        return 2
    print(json.dumps({"valid": True, "output": str(output), **result}, indent=2))
    return 0


def native_train_main(argv: Sequence[str] | None = None) -> int:
    args = _native_train_parser().parse_args(argv)
    try:
        result = train_native_models(
            args.csv,
            args.corpus_manifest,
            args.output_dir,
            seed=args.seed,
        )
    except (NativeCorpusError, ValueError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"trained": False, "error": str(exc)}, indent=2), file=sys.stderr)
        return 2
    print(json.dumps({"trained": True, **result}, indent=2, sort_keys=True))
    return 0
