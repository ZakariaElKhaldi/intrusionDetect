from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status

from app.features.canonical_schema import (
    BatchPredictionRequest,
    BatchPredictionResponse,
    FlowObservation,
    PredictionResponse,
)
from app.service import process_observation

router = APIRouter(tags=["predictions"])


@router.post("/predict", response_model=PredictionResponse, status_code=status.HTTP_201_CREATED)
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
    "/predict/batch", response_model=BatchPredictionResponse, status_code=status.HTTP_201_CREATED
)
async def predict_batch(
    batch: BatchPredictionRequest, request: Request
) -> BatchPredictionResponse:
    predictions = []
    with request.app.state.SessionLocal() as session:
        for observation in batch.observations:
            try:
                predictions.append(
                    await process_observation(
                        observation, session, request.app.state.registry, request.app.state.live
                    )
                )
            except ValueError as exc:
                session.rollback()
                raise HTTPException(status_code=409, detail=str(exc)) from exc
    return BatchPredictionResponse(predictions=predictions)

