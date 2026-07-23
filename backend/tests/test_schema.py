from __future__ import annotations

from copy import deepcopy

import httpx
import pytest
from conftest import observation


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda features: features.__setitem__("unexpected", 1), "extra"),
        (
            lambda features: features.__setitem__("flow_duration", "not-a-number"),
            "float-compatible",
        ),
        (lambda features: features.__setitem__("flow_duration", "inf"), "finite"),
        (lambda features: features.__setitem__("proto", ""), "non-blank string"),
        (lambda features: features.__setitem__("flow_duration", True), "not boolean"),
    ],
)
async def test_feature_contract_rejects_invalid_values(
    fallback_client: httpx.AsyncClient, mutate, message: str
) -> None:
    payload = observation()
    mutate(payload["features"])
    response = await fallback_client.post("/predict", json=payload)
    assert response.status_code == 422
    assert message in response.text


@pytest.mark.anyio
async def test_feature_contract_rejects_noncanonical_order(
    fallback_client: httpx.AsyncClient,
) -> None:
    payload = observation()
    reversed_features = dict(reversed(tuple(payload["features"].items())))
    payload["features"] = reversed_features
    response = await fallback_client.post("/predict", json=payload)
    assert response.status_code == 422
    assert "canonical order" in response.text


@pytest.mark.anyio
async def test_envelope_is_strict_and_times_are_ordered(
    fallback_client: httpx.AsyncClient,
) -> None:
    payload = observation()
    payload["unknown"] = "rejected"
    extra = await fallback_client.post("/predict", json=payload)
    assert extra.status_code == 422

    payload = deepcopy(observation())
    payload["flow_started_at"] = "2026-01-02T00:00:00Z"
    payload["flow_ended_at"] = "2026-01-01T00:00:00Z"
    invalid_time = await fallback_client.post("/predict", json=payload)
    assert invalid_time.status_code == 422
    assert "flow_ended_at" in invalid_time.text
