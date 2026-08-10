from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.auth import get_current_admin
from app.features.canonical_schema import (
    BatchPredictionRequest,
    BatchPredictionResponse,
    FlowObservation,
    PredictionResponse,
)
from app.service import broadcast_staged, process_observation, stage_observation

router = APIRouter(tags=["predictions"])


@router.post(
    "/predict",
    response_model=PredictionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(get_current_admin)],
)
async def predict(observation: FlowObservation, request: Request) -> PredictionResponse:
    with request.app.state.SessionLocal() as session:
        try:
            return await process_observation(
                observation, session, request.app.state.registry, request.app.state.live
            )
        except ValueError as exc:
            session.rollback()
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
    predictions = []
    staged_observations = []
    with request.app.state.SessionLocal() as session:
        try:
            for observation in batch.observations:
                staged = stage_observation(
                    observation, session, request.app.state.registry
                )
                staged_observations.append(staged)
                predictions.append(staged.response)
            session.commit()
        except ValueError as exc:
            session.rollback()
            raise HTTPException(status_code=409, detail=str(exc)) from exc
    for staged in staged_observations:
        await broadcast_staged(staged, request.app.state.live)
    return BatchPredictionResponse(predictions=predictions)
