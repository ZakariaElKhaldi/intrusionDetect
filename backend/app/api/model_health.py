from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request

from app.monitoring.schemas import ModelHealthHistoryResponse, ModelHealthSnapshotResponse

router = APIRouter(prefix="/model-health", tags=["model-health"])


@router.get("", response_model=ModelHealthSnapshotResponse)
async def model_health(
    request: Request,
    window: Literal["fast", "slow"] = "fast",
    source: str | None = Query(default=None, max_length=32),
    extractor_fingerprint: str | None = Query(default=None, min_length=64, max_length=64),
) -> ModelHealthSnapshotResponse:
    result = request.app.state.model_health.latest(
        window=window, source=source, extractor_fingerprint=extractor_fingerprint
    )
    if result is None:
        if source is not None or extractor_fingerprint is not None:
            raise HTTPException(status_code=404, detail="model-health cohort not found")
        result = request.app.state.model_health.evaluate(window)
    return result


@router.get("/history", response_model=ModelHealthHistoryResponse)
async def model_health_history(
    request: Request,
    window: Literal["fast", "slow"] = "fast",
    limit: int = Query(default=100, ge=1, le=500),
    source: str | None = Query(default=None, max_length=32),
    extractor_fingerprint: str | None = Query(default=None, min_length=64, max_length=64),
) -> ModelHealthHistoryResponse:
    return request.app.state.model_health.history(
        window=window,
        limit=limit,
        source=source,
        extractor_fingerprint=extractor_fingerprint,
    )
