from __future__ import annotations

import json

import pandas as pd

from iot_ids_ml.inference import VersionedPredictor
from iot_ids_ml.schema import FEATURE_COLUMNS, TARGET_COLUMN
from iot_ids_ml.training import TrainingConfig, realistic_split, train_baselines


def test_realistic_group_split_has_disjoint_groups(fixture_csv):
    frame = pd.read_csv(fixture_csv)
    frame["capture_session"] = [f"session-{index // 4}" for index in range(len(frame))]
    y = frame[TARGET_COLUMN]

    split, definition = realistic_split(
        frame,
        y,
        group_column="capture_session",
        time_column=None,
        config=TrainingConfig(),
    )

    assert split is not None
    assert definition["strategy"] == "group-aware"
    group_sets = {
        name: set(frame.iloc[indices]["capture_session"]) for name, indices in split.items()
    }
    assert group_sets["train"].isdisjoint(group_sets["validation"])
    assert group_sets["train"].isdisjoint(group_sets["test"])
    assert group_sets["validation"].isdisjoint(group_sets["test"])


def test_training_creates_reproducible_reports_and_loadable_models(fixture_csv, tmp_path):
    result = train_baselines(fixture_csv, tmp_path, seed=7)
    report = json.loads((tmp_path / "evaluation-report.json").read_text())
    manifest = json.loads((tmp_path / "manifest.json").read_text())

    assert report["schema_version"] == "rt-iot2022-v1"
    assert set(report["experiments"]) == {"binary", "multiclass"}
    assert report["cascade_evaluation"]["test_rows"] > 0
    assert report["cascade_evaluation"]["metrics"]["confusion_matrix"]
    assert report["experiments"]["binary"]["threshold_analysis"]["curve"]
    assert report["experiments"]["binary"]["realistic_split"]["available"] is False
    for target in ("binary", "multiclass"):
        models = report["experiments"][target]["splits"]["stratified_random"]["models"]
        assert set(models) == {
            "logistic_regression",
            "decision_tree",
            "random_forest",
            "hist_gradient_boosting",
        }
        for evaluation in models.values():
            assert "f1_macro" in evaluation["test"]
            assert "per_class" in evaluation["test"]
            assert evaluation["test"]["precision_recall_curves"]
            assert all(
                len(curve["precision"]) <= 256
                for curve in evaluation["test"]["precision_recall_curves"].values()
            )
            assert "p95_inference_latency_ms" in evaluation["operational"]
            assert evaluation["operational"]["serialized_model_size_bytes"] > 0

    assert len(result["models"]) == 2
    assert len(manifest["evaluation_report_sha256"]) == 64
    binary = next(model for model in result["models"] if model["target"] == "binary")
    predictor = VersionedPredictor(
        tmp_path / binary["artifact"],
        tmp_path / binary["metadata"],
    )
    observation = pd.read_csv(fixture_csv).iloc[:1][list(FEATURE_COLUMNS)]
    prediction = predictor.predict(observation)[0]
    assert prediction["target"] == "binary"
    assert prediction["prediction"] in {"normal", "attack"}
    assert prediction["confidence_is_calibrated_probability"] == predictor.metadata.get(
        "probability_calibrated", False
    )


def test_default_training_aggregates_three_validation_seeds(fixture_csv, tmp_path):
    train_baselines(fixture_csv, tmp_path)
    report = json.loads((tmp_path / "evaluation-report.json").read_text())

    assert report["evaluation_seeds"] == [42, 1337, 2026]
    assert set(report["shared_split_audit"]) == {"42", "1337", "2026"}
    assert set(report["cascade_evaluation"]["seed_evaluations"]) == {
        "42",
        "1337",
        "2026",
    }
    for target in ("binary", "multiclass"):
        experiment = report["experiments"][target]
        models = experiment["splits"]["stratified_random"]["models"]
        for evaluation in models.values():
            assert set(evaluation["seed_evaluations"]) == {"42", "1337", "2026"}
            assert "mean_validation_macro_f1" in evaluation["selection_aggregate"]
        assert experiment["selected_model"]["selection_policy"][0].startswith("highest mean")

    multiclass = report["experiments"]["multiclass"]
    assert multiclass["training_row_count"] < report["profile"]["row_count"]
    assert set(multiclass["target_definition"]["classes"]).isdisjoint(
        {"MQTT", "Thing_speak", "Wipro_bulb", "Amazon-Alexa"}
    )
    assert multiclass["selected_model"]["training_population"].startswith("attack-only")


def test_probability_calibration_on_sufficient_dataset(fixture_csv, tmp_path):
    base_frame = pd.read_csv(fixture_csv)
    frames = []
    for index in range(8):
        copy_frame = base_frame.copy()
        copy_frame["flow_duration"] = copy_frame["flow_duration"] + index * 0.1
        frames.append(copy_frame)
    frame = pd.concat(frames, ignore_index=True)
    dataset_path = tmp_path / "expanded_dataset.csv"
    frame.to_csv(dataset_path, index=False)

    result = train_baselines(dataset_path, tmp_path / "model_out", seed=42)
    binary = next(model for model in result["models"] if model["target"] == "binary")
    predictor = VersionedPredictor(
        tmp_path / "model_out" / binary["artifact"],
        tmp_path / "model_out" / binary["metadata"],
    )
    observation = frame.iloc[:1][list(FEATURE_COLUMNS)]
    prediction = predictor.predict(observation)[0]
    assert prediction["confidence_is_calibrated_probability"] is True
