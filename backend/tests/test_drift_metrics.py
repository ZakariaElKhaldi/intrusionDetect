from __future__ import annotations

import pytest

from app.detection.drift import (
    benjamini_hochberg,
    categorical_drift,
    evaluate_feature_window,
    numeric_drift,
)


def numeric_reference(*, threshold: float = 0.2) -> dict:
    return {
        "min": 0.0,
        "max": 9.0,
        "quantiles": {"0.5": 4.5, "0.95": 8.55},
        "histogram_edges": [0.0, 3.0, 6.0, 9.0],
        "histogram_counts": [3, 3, 4],
        "comparison_sample": list(range(10)),
        "js_threshold": threshold,
    }


def test_benjamini_hochberg_preserves_order_and_monotonic_ranks() -> None:
    adjusted = benjamini_hochberg([0.04, 0.001, 0.03])
    assert adjusted == pytest.approx([0.04, 0.003, 0.04])
    with pytest.raises(ValueError):
        benjamini_hochberg([1.1])


def test_numeric_drift_reports_effect_significance_and_range() -> None:
    same = numeric_drift(numeric_reference(), list(range(10)))
    shifted = numeric_drift(numeric_reference(), [100.0 + index for index in range(10)])
    assert same["js_distance"] < shifted["js_distance"]
    assert same["range_exceedance_rate"] == 0
    assert shifted["range_exceedance_rate"] == 1
    assert shifted["ks_p_value"] < 0.01


def test_categorical_drift_keeps_unseen_values_explicit() -> None:
    result = categorical_drift(
        {
            "vocabulary": ["tcp", "udp"],
            "counts": {"tcp": 80, "udp": 20, "__OTHER__": 0},
            "js_threshold": 0.1,
        },
        ["tcp", "icmp", "icmp"],
    )
    assert result["unseen_count"] == 2
    assert result["unseen_rate"] == pytest.approx(2 / 3)
    assert result["unseen_values"] == [{"value": "icmp", "count": 2}]


def test_window_requires_effect_and_corrected_significance() -> None:
    reference = {
        "numeric_features": {"value": numeric_reference(threshold=0.1)},
        "categorical_features": {
            "kind": {
                "vocabulary": ["known"],
                "counts": {"known": 10, "__OTHER__": 0},
                "js_threshold": 0.1,
            }
        },
    }
    healthy = evaluate_feature_window(
        reference, [{"value": float(index), "kind": "known"} for index in range(10)]
    )
    shifted = evaluate_feature_window(
        reference, [{"value": 100.0 + index, "kind": "unseen"} for index in range(10)]
    )
    assert healthy["status"] == "healthy"
    assert shifted["status"] == "warning"
    assert {item["feature"] for item in shifted["features"] if item["drifted"]} == {
        "value",
        "kind",
    }


def test_empty_window_is_collecting() -> None:
    assert evaluate_feature_window({}, []) == {
        "status": "collecting",
        "observation_count": 0,
        "features": [],
    }
