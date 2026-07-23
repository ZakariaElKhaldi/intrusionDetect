from __future__ import annotations


def assess_severity(
    binary_prediction: str, confidence: float, behavior_reasons: list[str] | None = None
) -> tuple[str, list[str]]:
    reasons = list(behavior_reasons or [])
    if binary_prediction == "normal" and not reasons:
        return "informational", []
    reasons.insert(0, f"attack probability or class confidence is {confidence:.1%}")
    if confidence >= 0.9 or behavior_reasons:
        return "critical", reasons
    if confidence >= 0.75:
        return "high", reasons
    return "medium", reasons

