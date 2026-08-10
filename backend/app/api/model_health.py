from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request

from app.monitoring.schemas import (
    ModelHealthCohortsResponse,
    ModelHealthHistoryResponse,
    ModelHealthSnapshotResponse,
)

router = APIRouter(prefix="/model-health", tags=["model-health"])


@router.get("/cohorts", response_model=ModelHealthCohortsResponse)
def model_health_cohorts(request: Request) -> ModelHealthCohortsResponse:
    return ModelHealthCohortsResponse(items=request.app.state.model_health.cohorts())


@router.get("", response_model=ModelHealthSnapshotResponse)
def model_health(
    request: Request,
    window: Literal["fast", "slow"] = "fast",
    source: str | None = Query(default=None, max_length=32),
    extractor_fingerprint: str | None = Query(default=None, min_length=64, max_length=64),
    schema_version: str | None = Query(default=None, max_length=64),
    model_version: str | None = Query(default=None, max_length=128),
) -> ModelHealthSnapshotResponse:
    result = request.app.state.model_health.latest(
        window=window,
        source=source,
        extractor_fingerprint=extractor_fingerprint,
        schema_version=schema_version,
        model_version=model_version,
    )
    if result is None:
        if any((source, extractor_fingerprint, schema_version, model_version)):
            raise HTTPException(status_code=404, detail="model-health cohort not found")
        result = request.app.state.model_health.evaluate(window)
    return result


@router.get("/history", response_model=ModelHealthHistoryResponse)
def model_health_history(
    request: Request,
    window: Literal["fast", "slow"] = "fast",
    limit: int = Query(default=100, ge=1, le=500),
    source: str | None = Query(default=None, max_length=32),
    extractor_fingerprint: str | None = Query(default=None, min_length=64, max_length=64),
    schema_version: str | None = Query(default=None, max_length=64),
    model_version: str | None = Query(default=None, max_length=128),
) -> ModelHealthHistoryResponse:
    return request.app.state.model_health.history(
        window=window,
        limit=limit,
        source=source,
        extractor_fingerprint=extractor_fingerprint,
        schema_version=schema_version,
        model_version=model_version,
    )
