from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.features.canonical_schema import FlowObservation

router = APIRouter(prefix="/replay", tags=["replay"])


class ReplayRequest(BaseModel):
    observations: list[FlowObservation] = Field(min_length=1, max_length=100_000)
    interval_ms: int = Field(default=1_000, ge=0, le=60_000)
    speed: float = Field(default=1.0, gt=0, le=100)
    scenario: str = Field(default="custom", min_length=1, max_length=64)


class ReplayControl(BaseModel):
    speed: float | None = Field(default=None, gt=0, le=100)


class ReplayStatus(BaseModel):
    status: str
    processed: int
    total: int
    error: str | None
    speed: float
    scenario: str


def _status(request: Request) -> ReplayStatus:
    return ReplayStatus.model_validate(request.app.state.replay.state, from_attributes=True)


@router.post("/start", response_model=ReplayStatus, status_code=status.HTTP_202_ACCEPTED)
async def start_replay(payload: ReplayRequest, request: Request) -> ReplayStatus:
    try:
        request.app.state.replay.start(
            request.app,
            payload.observations,
            payload.interval_ms,
            speed=payload.speed,
            scenario=payload.scenario,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _status(request)


@router.get("/status", response_model=ReplayStatus)
async def replay_status(request: Request) -> ReplayStatus:
    return _status(request)


@router.post("/pause", response_model=ReplayStatus)
async def pause_replay(request: Request) -> ReplayStatus:
    try:
        request.app.state.replay.pause()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _status(request)


@router.post("/resume", response_model=ReplayStatus)
async def resume_replay(payload: ReplayControl, request: Request) -> ReplayStatus:
    try:
        request.app.state.replay.resume(payload.speed)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _status(request)


@router.post("/stop", response_model=ReplayStatus)
async def stop_replay(request: Request) -> ReplayStatus:
    request.app.state.replay.stop()
    return _status(request)
