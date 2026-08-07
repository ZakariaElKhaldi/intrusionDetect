"""Leakage-safe baseline training and versioned artifact creation."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import resource
import shutil
import subprocess
import tempfile
import time
import tracemalloc
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.calibration import CalibratedClassifierCV, FrozenEstimator
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupShuffleSplit, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.tree import DecisionTreeClassifier

from .drift_reference import build_drift_reference
from .evaluation import (
    classification_metrics,
    detector_threshold_curve,
    metrics_from_predictions,
    operational_metrics,
)
from .schema import (
    CATEGORICAL_FEATURES,
    FEATURE_COLUMNS,
    GROUP_COLUMN_CANDIDATES,
    NORMAL_LABELS,
    NUMERIC_FEATURES,
    SCHEMA_VERSION,
    TARGET_COLUMN,
    TIME_COLUMN_CANDIDATES,
)
from .validation import ValidatedDataset, sha256_file, validate_dataset


@dataclass(frozen=True)
class TrainingConfig:
    random_seed: int = 42
    test_fraction: float = 0.20
    validation_fraction: float = 0.20


DEFAULT_EVALUATION_SEEDS = (42, 1337, 2026)


def _publish_run(staging: Path, destination: Path) -> None:
    """Replace a generated run directory without mixing old and new artifacts."""

    if destination.exists():
        allowed_names = {
            "manifest.json",
            "evaluation-report.json",
            "drift-reference.json",
            ".gitkeep",
        }
        unknown = [
            item.name
            for item in destination.iterdir()
            if item.name not in allowed_names
            and not item.name.endswith((".joblib", ".metadata.json"))
        ]
        if unknown:
            raise ValueError(
                f"Refusing to replace non-run directory {destination}; "
                f"unexpected entries: {unknown}"
            )
    backup = destination.with_name(f".{destination.name}-previous")
    moved_old = False
    if backup.exists():
        shutil.rmtree(backup)
    try:
        if destination.exists():
            os.replace(destination, backup)
            moved_old = True
        os.replace(staging, destination)
        if moved_old:
            shutil.rmtree(backup)
    except Exception:
        if moved_old and not destination.exists() and backup.exists():
            os.replace(backup, destination)
        raise


def _preprocessor(*, scale: bool) -> ColumnTransformer:
    numeric_steps: list[tuple[str, Any]] = [("impute", SimpleImputer(strategy="median"))]
    if scale:
        numeric_steps.append(("scale", StandardScaler()))
    numeric = Pipeline(numeric_steps)
    categorical = Pipeline(
        [
            ("impute", SimpleImputer(strategy="most_frequent")),
            (
                "encode",
                OneHotEncoder(handle_unknown="ignore", sparse_output=False),
            ),
        ]
    )
    return ColumnTransformer(
        [
            ("numeric", numeric, list(NUMERIC_FEATURES)),
            ("categorical", categorical, list(CATEGORICAL_FEATURES)),
        ],
        sparse_threshold=0.0,
    )


def model_candidates(seed: int) -> dict[str, Pipeline]:
    return {
        "logistic_regression": Pipeline(
            [
                ("preprocess", _preprocessor(scale=True)),
                (
                    "classifier",
                    LogisticRegression(
                        max_iter=600,
                        class_weight="balanced",
                        random_state=seed,
                    ),
                ),
            ]
        ),
        "decision_tree": Pipeline(
            [
                ("preprocess", _preprocessor(scale=False)),
                (
                    "classifier",
                    DecisionTreeClassifier(
                        class_weight="balanced",
                        max_depth=14,
                        min_samples_leaf=2,
                        random_state=seed,
                    ),
                ),
            ]
        ),
        "random_forest": Pipeline(
            [
                ("preprocess", _preprocessor(scale=False)),
                (
                    "classifier",
                    RandomForestClassifier(
                        n_estimators=80,
                        class_weight="balanced_subsample",
                        max_depth=18,
                        min_samples_leaf=2,
                        n_jobs=1,
                        random_state=seed,
                    ),
                ),
            ]
        ),
        "hist_gradient_boosting": Pipeline(
            [
                ("preprocess", _preprocessor(scale=False)),
                (
                    "classifier",
                    HistGradientBoostingClassifier(
                        max_iter=80,
                        learning_rate=0.08,
                        max_leaf_nodes=31,
                        l2_regularization=0.1,
                        random_state=seed,
                    ),
                ),
            ]
        ),
    }


def _partition_summary(y: pd.Series, indices: np.ndarray) -> dict[str, Any]:
    counts = y.iloc[indices].value_counts().sort_index()
    return {
        "rows": int(len(indices)),
        "class_counts": {str(label): int(count) for label, count in counts.items()},
    }


def stratified_split(y: pd.Series, config: TrainingConfig) -> dict[str, np.ndarray]:
    counts = y.value_counts()
    if len(counts) < 2:
        raise ValueError("Target must contain at least two classes")
    if int(counts.min()) < 3:
        raise ValueError(
            "Every target class needs at least three observations for train/validation/test"
        )
    indices = np.arange(len(y))
    class_count = len(counts)
    test_size = max(class_count, int(np.ceil(config.test_fraction * len(indices))))
    train_val, test = train_test_split(
        indices,
        test_size=test_size,
        random_state=config.random_seed,
        stratify=y,
    )
    relative_validation = config.validation_fraction / (1.0 - config.test_fraction)
    validation_size = max(class_count, int(np.ceil(relative_validation * len(train_val))))
    train, validation = train_test_split(
        train_val,
        test_size=validation_size,
        random_state=config.random_seed,
        stratify=y.iloc[train_val],
    )
    return {
        "train": np.asarray(train),
        "validation": np.asarray(validation),
        "test": np.asarray(test),
    }


def realistic_split(
    frame: pd.DataFrame,
    y: pd.Series,
    *,
    group_column: str | None,
    time_column: str | None,
    config: TrainingConfig,
) -> tuple[dict[str, np.ndarray] | None, dict[str, Any]]:
    if group_column:
        groups = frame[group_column].astype(str)
        if groups.nunique() < 3:
            return None, {
                "available": False,
                "reason": f"group column {group_column!r} has fewer than three groups",
            }
        outer = GroupShuffleSplit(
            n_splits=1, test_size=config.test_fraction, random_state=config.random_seed
        )
        train_val, test = next(outer.split(frame, y, groups))
        inner = GroupShuffleSplit(
            n_splits=1,
            test_size=config.validation_fraction / (1.0 - config.test_fraction),
            random_state=config.random_seed,
        )
        inner_train, inner_validation = next(
            inner.split(frame.iloc[train_val], y.iloc[train_val], groups.iloc[train_val])
        )
        split = {
            "train": train_val[inner_train],
            "validation": train_val[inner_validation],
            "test": test,
        }
        return split, {
            "available": True,
            "strategy": "group-aware",
            "group_column": group_column,
            "shuffle": True,
        }

    if time_column:
        parsed = pd.to_datetime(frame[time_column], errors="coerce", utc=True)
        if parsed.isna().any() or parsed.nunique() < 3:
            return None, {
                "available": False,
                "reason": f"time column {time_column!r} is missing/unparseable or not variable",
            }
        ordered = np.argsort(parsed.to_numpy(), kind="stable")
        train_end = int((1.0 - config.validation_fraction - config.test_fraction) * len(frame))
        validation_end = int((1.0 - config.test_fraction) * len(frame))
        split = {
            "train": ordered[:train_end],
            "validation": ordered[train_end:validation_end],
            "test": ordered[validation_end:],
        }
        return split, {
            "available": True,
            "strategy": "temporal",
            "time_column": time_column,
            "shuffle": False,
        }

    return None, {
        "available": False,
        "reason": (
            "No reliable grouping or timestamp exists in canonical RT-IoT2022; "
            "chronology was not invented."
        ),
    }


def _assert_no_feature_overlap(x: pd.DataFrame, split: dict[str, np.ndarray]) -> None:
    signatures = pd.util.hash_pandas_object(x, index=False)
    partitions = {
        name: set(signatures.iloc[indices].tolist()) for name, indices in split.items()
    }
    overlaps = {
        f"{left}/{right}": len(partitions[left] & partitions[right])
        for left, right in (("train", "validation"), ("train", "test"), ("validation", "test"))
    }
    if any(overlaps.values()):
        raise ValueError(f"Duplicate flows cross split boundaries: {overlaps}")


def _attack_only_partitions(
    split: dict[str, np.ndarray], source_labels: pd.Series
) -> dict[str, np.ndarray]:
    """Filter shared full-population indices without creating a second split."""

    is_attack = ~source_labels.astype(str).isin(NORMAL_LABELS).to_numpy()
    return {
        name: np.asarray(indices)[is_attack[np.asarray(indices)]]
        for name, indices in split.items()
    }


def _partition_fingerprint(indices: np.ndarray) -> str:
    canonical = ",".join(str(int(index)) for index in sorted(indices.tolist()))
    return hashlib.sha256(canonical.encode()).hexdigest()


def _fit_one(
    estimator: Pipeline,
    x: pd.DataFrame,
    y: pd.Series,
    split: dict[str, np.ndarray],
) -> tuple[Any, dict[str, Any]]:
    train = split["train"]
    validation = split["validation"]
    test = split["test"]
    wall_started = time.perf_counter()
    cpu_started = time.process_time()
    tracemalloc.start()
    estimator.fit(x.iloc[train], y.iloc[train])

    fitted_model: Any = estimator
    calibrated = False
    if len(np.unique(y.iloc[validation])) > 1:
        try:
            calibrated_estimator = CalibratedClassifierCV(
                estimator=FrozenEstimator(estimator), method="sigmoid"
            )
            calibrated_estimator.fit(x.iloc[validation], y.iloc[validation])
            fitted_model = calibrated_estimator
            calibrated = True
        except Exception:
            fitted_model = estimator

    _, peak_memory = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    wall_seconds = max(time.perf_counter() - wall_started, np.finfo(float).eps)
    cpu_seconds = time.process_time() - cpu_started
    result = {
        "training": {
            "wall_seconds": float(wall_seconds),
            "process_cpu_seconds": float(cpu_seconds),
            "approximate_cpu_utilization_percent": float(100 * cpu_seconds / wall_seconds),
            "peak_traced_python_memory_bytes": int(peak_memory),
            "process_peak_rss_kib": int(
                resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            ),
            "process_peak_rss_note": (
                "Unix ru_maxrss is process-wide and cumulative, not model-isolated."
            ),
        },
        "validation": classification_metrics(fitted_model, x.iloc[validation], y.iloc[validation]),
        "test": classification_metrics(fitted_model, x.iloc[test], y.iloc[test]),
        "operational": operational_metrics(fitted_model, x.iloc[test]),
        "probability_calibrated": calibrated,
    }
    return fitted_model, result


def _git_commit(repository: Path) -> str | None:
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=repository,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def _git_is_dirty(repository: Path) -> bool | None:
    try:
        output = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=repository,
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        return bool(output.strip())
    except (OSError, subprocess.CalledProcessError):
        return None


def _library_versions() -> dict[str, str]:
    return {
        "python": platform.python_version(),
        "numpy": np.__version__,
        "pandas": pd.__version__,
        "scikit-learn": sklearn.__version__,
        "joblib": joblib.__version__,
    }


def _choose_metadata_column(
    requested: str | None, candidates: tuple[str, ...], columns: list[str]
) -> str | None:
    if requested:
        return requested
    return next((candidate for candidate in candidates if candidate in columns), None)


def train_baselines(
    csv_path: str | Path,
    output_dir: str | Path,
    *,
    seed: int | None = None,
    seeds: tuple[int, ...] | list[int] | None = None,
    group_column: str | None = None,
    time_column: str | None = None,
) -> dict[str, Any]:
    """Train both targets and select champions from repeated validation splits.

    ``seed`` is retained for callers that intentionally need one small fixture run.
    Production callers should omit it (or pass ``seeds``) to use the three declared
    deterministic evaluations.
    """

    if seed is not None and seeds is not None:
        raise ValueError("Pass either seed or seeds, not both")
    requested_seeds = (
        seeds
        if seeds is not None
        else ((seed,) if seed is not None else DEFAULT_EVALUATION_SEEDS)
    )
    evaluation_seeds = tuple(int(value) for value in requested_seeds)
    if not evaluation_seeds or len(set(evaluation_seeds)) != len(evaluation_seeds):
        raise ValueError("Evaluation seeds must be a non-empty list of unique integers")

    csv_path = Path(csv_path).expanduser().resolve()
    header = pd.read_csv(csv_path, nrows=0)
    columns = [str(column) for column in header.columns]
    if group_column:
        selected_group = group_column
        selected_time = None
    elif time_column:
        selected_group = None
        selected_time = time_column
    else:
        selected_group = _choose_metadata_column(None, GROUP_COLUMN_CANDIDATES, columns)
        selected_time = (
            None
            if selected_group
            else _choose_metadata_column(None, TIME_COLUMN_CANDIDATES, columns)
        )
    metadata = [column for column in (selected_group, selected_time) if column]
    validated: ValidatedDataset = validate_dataset(csv_path, metadata_columns=metadata)
    frame = validated.frame

    duplicate_count = int(frame[list(FEATURE_COLUMNS)].duplicated().sum())
    if duplicate_count:
        frame = frame.drop_duplicates(subset=list(FEATURE_COLUMNS), keep="first").reset_index(
            drop=True
        )
    source_labels = frame[TARGET_COLUMN].astype(str)
    attack_mask = ~source_labels.isin(NORMAL_LABELS)
    x_all = frame[list(FEATURE_COLUMNS)]
    shared_partitions_by_seed: dict[int, dict[str, np.ndarray]] = {}
    for evaluation_seed in evaluation_seeds:
        shared = stratified_split(
            source_labels, TrainingConfig(random_seed=evaluation_seed)
        )
        _assert_no_feature_overlap(x_all, shared)
        shared_partitions_by_seed[evaluation_seed] = shared
    final_output = Path(output_dir).expanduser().resolve()
    final_output.parent.mkdir(parents=True, exist_ok=True)
    output = Path(
        tempfile.mkdtemp(prefix=f".{final_output.name}-training-", dir=final_output.parent)
    )
    repository = Path(__file__).resolve().parents[3]
    try:
        dataset_path = csv_path.relative_to(repository).as_posix()
    except ValueError:
        dataset_path = str(csv_path)
    common_metadata = {
        "schema_version": SCHEMA_VERSION,
        "dataset_path": dataset_path,
        "dataset_sha256": validated.profile["dataset_sha256"],
        "code_commit": _git_commit(repository),
        "code_worktree_dirty": _git_is_dirty(repository),
        "evaluation_seeds": list(evaluation_seeds),
        "feature_order": list(FEATURE_COLUMNS),
        "library_versions": _library_versions(),
        "training_configuration": {
            **asdict(TrainingConfig(random_seed=evaluation_seeds[0])),
            "evaluation_seeds": list(evaluation_seeds),
            "split_stratification_target": "original 12-label Attack_type",
            "cascade_partition_policy": (
                "one shared partition per seed; multiclass uses attack rows within it"
            ),
        },
        "removed_rows": {
            "duplicate_feature_rows": duplicate_count,
            "reason": "prevent identical flows from crossing split boundaries",
        },
    }
    report: dict[str, Any] = {
        **common_metadata,
        "profile": {**validated.profile, "dataset_path": dataset_path},
        "experiments": {},
        "dataset_role": (
            "fixture"
            if "data/sample" in csv_path.as_posix() or validated.profile["row_count"] <= 1000
            else "production_training"
        ),
        "shared_split_audit": {
            str(run_seed): {
                name: {
                    "rows": int(len(indices)),
                    "index_sha256": _partition_fingerprint(indices),
                }
                for name, indices in shared_partitions_by_seed[run_seed].items()
            }
            for run_seed in evaluation_seeds
        },
        "limitations": [
            "Small fixture runs only test the software contract and cannot be promoted.",
            "Random-split performance is not evidence of deployment readiness.",
            "Extractor value compatibility requires controlled PCAP experiments.",
            "Raw classifier probabilities are uncalibrated.",
            "CPU and traced-memory results depend on this process and host.",
            "False alerts per time window are unavailable without reliable timestamps.",
        ],
    }
    saved_models: list[dict[str, Any]] = []
    selected_estimators: dict[str, Pipeline] = {}
    selected_estimators_by_seed: dict[str, dict[int, Pipeline]] = {}

    for target_name in ("binary", "multiclass"):
        x = x_all
        y = (
            source_labels.map(
                lambda value: "normal" if str(value) in NORMAL_LABELS else "attack"
            )
            if target_name == "binary"
            else source_labels
        )
        population_mask = (
            np.ones(len(frame), dtype=bool)
            if target_name == "binary"
            else attack_mask.to_numpy()
        )
        primary_config = TrainingConfig(random_seed=evaluation_seeds[0])
        realistic_partitions, realistic_definition = realistic_split(
            frame,
            source_labels,
            group_column=selected_group,
            time_column=selected_time,
            config=primary_config,
        )
        target_report: dict[str, Any] = {
            "target_definition": (
                {
                    "normal": sorted(NORMAL_LABELS),
                    "attack": "all remaining Attack_type labels",
                }
                if target_name == "binary"
                else {
                    "classes": sorted(source_labels.loc[attack_mask].unique().tolist()),
                    "population": "attack rows only; normal flows are gated by binary detection",
                }
            ),
            "training_row_count": int(np.sum(population_mask)),
            "realistic_split": realistic_definition,
            "splits": {
                "stratified_random": {
                    "definition": {
                        "strategy": "shared repeated stratified random",
                        "shuffle": True,
                        "seeds": list(evaluation_seeds),
                        "stratified_by": "original 12-label Attack_type",
                        "population": (
                            "all rows"
                            if target_name == "binary"
                            else "attack rows selected from the same full-data partitions"
                        ),
                    },
                    "models": {},
                }
            },
        }
        seed_evaluations: dict[str, dict[int, tuple[Pipeline, dict[str, Any]]]] = {
            name: {} for name in model_candidates(evaluation_seeds[0])
        }
        primary_partitions: dict[str, np.ndarray] | None = None
        for evaluation_seed in evaluation_seeds:
            shared_partitions = shared_partitions_by_seed[evaluation_seed]
            partitions = (
                shared_partitions
                if target_name == "binary"
                else _attack_only_partitions(shared_partitions, source_labels)
            )
            _assert_no_feature_overlap(x, partitions)
            if primary_partitions is None:
                primary_partitions = partitions
                target_report["splits"]["stratified_random"]["partitions"] = {
                    name: _partition_summary(y, indices)
                    for name, indices in partitions.items()
                }
            for model_name, candidate in model_candidates(evaluation_seed).items():
                seed_evaluations[model_name][evaluation_seed] = _fit_one(
                    candidate, x, y, partitions
                )

        ranking: list[tuple[tuple[float, float, float, float, str], str]] = []
        for model_name, runs in seed_evaluations.items():
            evaluations = [result for _, result in runs.values()]
            mean_f1 = float(np.mean([item["validation"]["f1_macro"] for item in evaluations]))
            mean_fpr = float(
                np.mean(
                    [
                        item["validation"].get(
                            "false_positive_rate",
                            item["validation"]["macro_one_vs_rest_false_positive_rate"],
                        )
                        for item in evaluations
                    ]
                )
            )
            mean_p95 = float(
                np.mean([item["operational"]["p95_inference_latency_ms"] for item in evaluations])
            )
            mean_size = float(
                np.mean(
                    [
                        item["operational"]["serialized_model_size_bytes"]
                        for item in evaluations
                    ]
                )
            )
            representative = runs[evaluation_seeds[0]][1]
            target_report["splits"]["stratified_random"]["models"][model_name] = {
                **representative,
                "seed_evaluations": {
                    str(run_seed): result for run_seed, (_, result) in runs.items()
                },
                "selection_aggregate": {
                    "mean_validation_macro_f1": mean_f1,
                    "mean_validation_false_positive_rate": mean_fpr,
                    "mean_p95_inference_latency_ms": mean_p95,
                    "mean_serialized_model_size_bytes": mean_size,
                },
            }
            ranking.append(((-mean_f1, mean_fpr, mean_p95, mean_size, model_name), model_name))

        ranking.sort(key=lambda item: item[0])
        best_name = ranking[0][1]
        best_score = -ranking[0][0][0]
        best_estimator = seed_evaluations[best_name][evaluation_seeds[0]][0]
        best_aggregate = target_report["splits"]["stratified_random"]["models"][best_name][
            "selection_aggregate"
        ]
        if realistic_partitions is not None:
            if target_name == "multiclass":
                realistic_partitions = _attack_only_partitions(
                    realistic_partitions, source_labels
                )
            _assert_no_feature_overlap(x, realistic_partitions)
            _, realistic_evaluation = _fit_one(
                model_candidates(evaluation_seeds[0])[best_name],
                x,
                y,
                realistic_partitions,
            )
            target_report["splits"]["realistic"] = {
                "definition": realistic_definition,
                "partitions": {
                    name: _partition_summary(y, indices)
                    for name, indices in realistic_partitions.items()
                },
                "models": {best_name: realistic_evaluation},
                "note": "Realistic split evaluates the already-selected architecture only.",
            }

        code_commit = common_metadata["code_commit"]
        version_material = json.dumps(
            {
                "schema": SCHEMA_VERSION,
                "dataset": validated.profile["dataset_sha256"],
                "target": target_name,
                "model": best_name,
                "seeds": list(evaluation_seeds),
                "split_policy": "shared-original-label-stratified-v1",
                "configuration": common_metadata["training_configuration"],
                "code_commit": code_commit,
            },
            sort_keys=True,
        ).encode()
        version = f"{target_name}-{best_name}-{hashlib.sha256(version_material).hexdigest()[:12]}"
        artifact_path = output / f"{version}.joblib"
        joblib.dump(best_estimator, artifact_path, compress=3)
        artifact_sha = sha256_file(artifact_path)
        model_metadata = {
            **common_metadata,
            "model_version": version,
            "target": target_name,
            "model_name": best_name,
            "selection_metric": "validation_macro_f1",
            "selection_score": best_score,
            "selection_policy": [
                "highest mean validation macro-F1",
                "lowest mean validation false-positive rate",
                "lowest mean p95 inference latency",
                "smallest mean serialized size",
                "lexicographically smallest model name",
            ],
            "selection_aggregate": best_aggregate,
            "dataset_role": report["dataset_role"],
            "training_row_count": int(np.sum(population_mask)),
            "training_population": (
                "all deduplicated flows"
                if target_name == "binary"
                else "attack-only deduplicated flows"
            ),
            "artifact": artifact_path.name,
            "artifact_sha256": artifact_sha,
            "probability_calibrated": bool(
                isinstance(best_estimator, CalibratedClassifierCV)
            ),
        }
        metadata_path = output / f"{version}.metadata.json"
        metadata_path.write_text(
            json.dumps(model_metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        metadata_sha = sha256_file(metadata_path)
        saved_models.append(
            {
                "model_version": version,
                "target": target_name,
                "artifact": artifact_path.name,
                "artifact_sha256": artifact_sha,
                "metadata": metadata_path.name,
                "metadata_sha256": metadata_sha,
            }
        )
        target_report["selected_model"] = model_metadata
        report["experiments"][target_name] = target_report
        selected_estimators[target_name] = best_estimator
        selected_estimators_by_seed[target_name] = {
            run_seed: seed_evaluations[best_name][run_seed][0]
            for run_seed in evaluation_seeds
        }

    cascade_seed_evaluations: dict[str, Any] = {}
    for run_seed in evaluation_seeds:
        cascade_test = shared_partitions_by_seed[run_seed]["test"]
        true_families = source_labels.iloc[cascade_test].map(
            lambda value: "normal" if str(value) in NORMAL_LABELS else str(value)
        ).to_numpy()
        detector_predictions = selected_estimators_by_seed["binary"][run_seed].predict(
            x_all.iloc[cascade_test]
        )
        cascade_predictions = np.full(len(cascade_test), "normal", dtype=object)
        routed_positions = np.flatnonzero(detector_predictions == "attack")
        if len(routed_positions):
            cascade_predictions[routed_positions] = selected_estimators_by_seed[
                "multiclass"
            ][run_seed].predict(x_all.iloc[cascade_test[routed_positions]])
        attack_truth = true_families != "normal"
        cascade_seed_evaluations[str(run_seed)] = {
            "test_rows": int(len(cascade_test)),
            "detector_false_negatives": int(
                np.sum(attack_truth & (detector_predictions == "normal"))
            ),
            "detector_routed_rows": int(len(routed_positions)),
            "metrics": metrics_from_predictions(true_families, cascade_predictions),
        }
    primary_cascade = cascade_seed_evaluations[str(evaluation_seeds[0])]
    report["cascade_evaluation"] = {
        "protocol": (
            "Binary detector followed by attack-family classifier on the untouched shared "
            "test partition; detector misses remain final normal predictions."
        ),
        "split_seed": evaluation_seeds[0],
        **primary_cascade,
        "seed_evaluations": cascade_seed_evaluations,
        "aggregate": {
            "mean_macro_f1": float(
                np.mean(
                    [item["metrics"]["f1_macro"] for item in cascade_seed_evaluations.values()]
                )
            ),
            "mean_detector_false_negatives": float(
                np.mean(
                    [
                        item["detector_false_negatives"]
                        for item in cascade_seed_evaluations.values()
                    ]
                )
            ),
        },
    }
    primary_shared = shared_partitions_by_seed[evaluation_seeds[0]]
    binary_validation = primary_shared["validation"]
    report["experiments"]["binary"]["threshold_analysis"] = detector_threshold_curve(
        selected_estimators["binary"],
        x_all.iloc[binary_validation],
        source_labels.iloc[binary_validation].map(
            lambda value: "normal" if str(value) in NORMAL_LABELS else "attack"
        ),
    )

    model_versions = {
        item["target"]: item["model_version"] for item in saved_models
    }
    drift_reference = build_drift_reference(
        frame,
        train_indices=primary_shared["train"],
        test_indices=primary_shared["test"],
        detector=selected_estimators["binary"],
        classifier=selected_estimators["multiclass"],
        detector_model_version=model_versions["binary"],
        classifier_model_version=model_versions["multiclass"],
        dataset_sha256=validated.profile["dataset_sha256"],
        schema_version=SCHEMA_VERSION,
        random_seed=evaluation_seeds[0],
    )
    drift_reference_path = output / "drift-reference.json"
    drift_reference_path.write_text(
        json.dumps(drift_reference, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    report_path = output / "evaluation-report.json"
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "evaluation_report": report_path.name,
        "evaluation_report_sha256": sha256_file(report_path),
        "drift_reference": drift_reference_path.name,
        "drift_reference_sha256": sha256_file(drift_reference_path),
        "models": saved_models,
    }
    manifest_path = output / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    try:
        _publish_run(output, final_output)
    except Exception:
        shutil.rmtree(output, ignore_errors=True)
        raise
    report_path = final_output / report_path.name
    manifest_path = final_output / manifest_path.name
    return {
        "output_dir": str(final_output),
        "evaluation_report": str(report_path),
        "manifest": str(manifest_path),
        "models": saved_models,
        "realistic_split": report["experiments"]["binary"]["realistic_split"],
    }
