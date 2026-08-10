from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from starlette.concurrency import run_in_threadpool

from app.api.auth import get_current_admin
from app.features.canonical_schema import (
    BatchPredictionRequest,
    BatchPredictionResponse,
    FlowObservation,
    PredictionResponse,
)
from app.service import broadcast_staged, persist_observations, process_observation

router = APIRouter(tags=["predictions"])


@router.post(
    "/predict",
    response_model=PredictionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(get_current_admin)],
)
async def predict(observation: FlowObservation, request: Request) -> PredictionResponse:
    try:
        return await process_observation(
            observation,
            request.app.state.SessionLocal,
            request.app.state.registry,
            request.app.state.live,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post(
    "/predict/batch",
    response_model=BatchPredictionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(get_current_admin)],
)
async def predict_batch(
    batch: BatchPredictionRequest, request: Request
) -> BatchPredictionResponse:
    try:
        staged_observations = await run_in_threadpool(
            persist_observations,
            tuple(batch.observations),
            request.app.state.SessionLocal,
            request.app.state.registry,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    for staged in staged_observations:
        await broadcast_staged(staged, request.app.state.live)
    return BatchPredictionResponse(
        predictions=[staged.response for staged in staged_observations]
    )
