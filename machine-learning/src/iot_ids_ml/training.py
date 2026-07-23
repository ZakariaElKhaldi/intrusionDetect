"""Leakage-safe baseline training and versioned artifact creation."""

from __future__ import annotations

import hashlib
import json
import platform
import resource
import subprocess
import time
import tracemalloc
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupShuffleSplit, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.tree import DecisionTreeClassifier

from .evaluation import classification_metrics, operational_metrics
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


def _fit_one(
    estimator: Pipeline,
    x: pd.DataFrame,
    y: pd.Series,
    split: dict[str, np.ndarray],
) -> tuple[Pipeline, dict[str, Any]]:
    train = split["train"]
    validation = split["validation"]
    test = split["test"]
    wall_started = time.perf_counter()
    cpu_started = time.process_time()
    tracemalloc.start()
    estimator.fit(x.iloc[train], y.iloc[train])
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
        "validation": classification_metrics(estimator, x.iloc[validation], y.iloc[validation]),
        "test": classification_metrics(estimator, x.iloc[test], y.iloc[test]),
        "operational": operational_metrics(estimator, x.iloc[test]),
    }
    return estimator, result


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
    seed: int = 42,
    group_column: str | None = None,
    time_column: str | None = None,
) -> dict[str, Any]:
    """Train both targets, report all models, and save the best random-split pipelines."""

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
    config = TrainingConfig(random_seed=seed)
    x = frame[list(FEATURE_COLUMNS)]
    targets = {
        "binary": frame[TARGET_COLUMN].map(
            lambda value: "normal" if str(value) in NORMAL_LABELS else "attack"
        ),
        "multiclass": frame[TARGET_COLUMN].astype(str),
    }
    output = Path(output_dir).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    repository = Path(__file__).resolve().parents[3]
    common_metadata = {
        "schema_version": SCHEMA_VERSION,
        "dataset_path": str(csv_path),
        "dataset_sha256": validated.profile["dataset_sha256"],
        "code_commit": _git_commit(repository),
        "code_worktree_dirty": _git_is_dirty(repository),
        "random_seed": seed,
        "feature_order": list(FEATURE_COLUMNS),
        "library_versions": _library_versions(),
        "training_configuration": asdict(config),
        "removed_rows": {
            "duplicate_feature_rows": duplicate_count,
            "reason": "prevent identical flows from crossing split boundaries",
        },
    }
    report: dict[str, Any] = {
        **common_metadata,
        "profile": validated.profile,
        "experiments": {},
        "limitations": [
            "The checked-in fixture is synthetic and only tests the software contract.",
            "Random-split performance is not evidence of deployment readiness.",
            "Extractor value compatibility requires controlled PCAP experiments.",
            "Raw classifier probabilities are uncalibrated.",
            "CPU and traced-memory results depend on this process and host.",
            "False alerts per time window are unavailable without reliable timestamps.",
        ],
    }
    saved_models: list[dict[str, Any]] = []

    for target_name, y in targets.items():
        random_partitions = stratified_split(y, config)
        _assert_no_feature_overlap(x, random_partitions)
        realistic_partitions, realistic_definition = realistic_split(
            frame,
            y,
            group_column=selected_group,
            time_column=selected_time,
            config=config,
        )
        strategies: list[tuple[str, dict[str, np.ndarray], dict[str, Any]]] = [
            (
                "stratified_random",
                random_partitions,
                {"strategy": "stratified random", "shuffle": True},
            )
        ]
        if realistic_partitions is not None:
            _assert_no_feature_overlap(x, realistic_partitions)
            strategies.append(("realistic", realistic_partitions, realistic_definition))

        target_report: dict[str, Any] = {
            "target_definition": (
                {
                    "normal": sorted(NORMAL_LABELS),
                    "attack": "all remaining Attack_type labels",
                }
                if target_name == "binary"
                else {"classes": sorted(y.unique().tolist())}
            ),
            "realistic_split": realistic_definition,
            "splits": {},
        }
        best_name: str | None = None
        best_score = -1.0
        best_estimator: Pipeline | None = None
        for strategy_name, partitions, definition in strategies:
            split_report: dict[str, Any] = {
                "definition": definition,
                "partitions": {
                    name: _partition_summary(y, indices)
                    for name, indices in partitions.items()
                },
                "models": {},
            }
            for model_name, candidate in model_candidates(seed).items():
                fitted, evaluation = _fit_one(candidate, x, y, partitions)
                split_report["models"][model_name] = evaluation
                if strategy_name == "stratified_random":
                    score = evaluation["validation"]["f1_macro"]
                    if score > best_score:
                        best_score = score
                        best_name = model_name
                        best_estimator = fitted
            target_report["splits"][strategy_name] = split_report

        assert best_name is not None and best_estimator is not None
        version_material = json.dumps(
            {
                "schema": SCHEMA_VERSION,
                "dataset": validated.profile["dataset_sha256"],
                "target": target_name,
                "model": best_name,
                "seed": seed,
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
            "artifact": artifact_path.name,
            "artifact_sha256": artifact_sha,
            "probability_calibrated": False,
        }
        metadata_path = output / f"{version}.metadata.json"
        metadata_path.write_text(
            json.dumps(model_metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        saved_models.append(
            {
                "model_version": version,
                "target": target_name,
                "artifact": artifact_path.name,
                "artifact_sha256": artifact_sha,
                "metadata": metadata_path.name,
            }
        )
        target_report["selected_model"] = model_metadata
        report["experiments"][target_name] = target_report

    report_path = output / "evaluation-report.json"
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "evaluation_report": report_path.name,
        "evaluation_report_sha256": sha256_file(report_path),
        "models": saved_models,
    }
    manifest_path = output / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return {
        "output_dir": str(output),
        "evaluation_report": str(report_path),
        "manifest": str(manifest_path),
        "models": saved_models,
        "realistic_split": report["experiments"]["binary"]["realistic_split"],
    }
