from __future__ import annotations

from copy import deepcopy

from iot_ids_ml.native_compatibility import promotion_gates, wilson_interval


def _report() -> dict:
    family = {"recall": 0.8, "support": 250}
    return {
        "experiments": {
            "binary": {
                "selected_test": {
                    "false_positive_rate": 0.01,
                    "per_class": {
                        "attack": {"recall": 0.96, "support": 2500},
                        "normal": {"recall": 0.99, "support": 1200},
                    },
                }
            }
        },
        "cascade_evaluation": {
            "metrics": {
                "f1_macro": 0.86,
                "per_class": {
                    "normal": {"recall": 0.99, "support": 1200},
                    **{f"attack-{index}": deepcopy(family) for index in range(9)},
                },
            }
        },
    }


def test_promotion_gates_report_support_intervals_and_pass_state() -> None:
    gates = promotion_gates(_report())
    assert all(item["passed"] for item in gates.values())
    assert gates["detector_recall"]["support"] == 2500
    assert len(gates["detector_recall"]["wilson_95"]) == 2
    assert gates["test_support"]["minimum_per_attack_family"] == 200


def test_any_family_below_recall_blocks_promotion() -> None:
    report = deepcopy(_report())
    report["cascade_evaluation"]["metrics"]["per_class"]["attack-3"]["recall"] = 0.69
    gates = promotion_gates(report)
    assert gates["per_attack_family_recall"]["passed"] is False


def test_wilson_interval_is_bounded() -> None:
    assert wilson_interval(0, 10)[0] == 0.0
    assert wilson_interval(10, 10)[1] == 1.0
