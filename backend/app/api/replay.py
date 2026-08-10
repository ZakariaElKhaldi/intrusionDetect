from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, model_validator

from app.api.auth import get_current_admin
from app.features.canonical_schema import FlowObservation

router = APIRouter(prefix="/replay", tags=["replay"])


class ReplayRequest(BaseModel):
    mode: Literal["custom", "dataset"] = "custom"
    observations: list[FlowObservation] | None = Field(default=None, max_length=100_000)
    interval_ms: int = Field(default=1_000, ge=0, le=60_000)
    speed: float = Field(default=1.0, gt=0, le=100)
    scenario: str = Field(default="custom", min_length=1, max_length=128)
    offset: int = Field(default=0, ge=0)
    limit: int | None = Field(default=None, ge=1, le=1_000_000)

    @model_validator(mode="after")
    def validate_mode(self) -> ReplayRequest:
        if self.mode == "custom" and not self.observations:
            raise ValueError("custom replay requires at least one observation")
        if self.mode == "dataset" and self.observations is not None:
            raise ValueError("dataset replay does not accept client observations")
        if self.mode == "dataset" and self.scenario == "custom":
            self.scenario = "all"
        return self


class ReplayControl(BaseModel):
    speed: float | None = Field(default=None, gt=0, le=100)


class ReplayStatus(BaseModel):
    status: str
    processed: int
    total: int
    error: str | None
    speed: float
    scenario: str
    mode: str
    offset: int
    limit: int | None




def _status(request: Request) -> ReplayStatus:
    return ReplayStatus.model_validate(request.app.state.replay.state, from_attributes=True)


@router.post(
    "/start",
    response_model=ReplayStatus,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(get_current_admin)],
)
def start_replay(payload: ReplayRequest, request: Request) -> ReplayStatus:
    try:
        if payload.mode == "dataset":
            request.app.state.replay.start_dataset(
                request.app,
                payload.interval_ms,
                speed=payload.speed,
                scenario=payload.scenario,
                offset=payload.offset,
                limit=payload.limit,
            )
        else:
            request.app.state.replay.start_custom(
                request.app,
                payload.observations or [],
                payload.interval_ms,
                speed=payload.speed,
                scenario=payload.scenario,
            )
    except (RuntimeError, FileNotFoundError, ValueError) as exc:
        code = 409 if isinstance(exc, RuntimeError) else 422
        raise HTTPException(status_code=code, detail=str(exc)) from exc
    return _status(request)


@router.get("/status", response_model=ReplayStatus)
def replay_status(request: Request) -> ReplayStatus:
    return _status(request)


@router.post(
    "/pause", response_model=ReplayStatus, dependencies=[Depends(get_current_admin)]
)
def pause_replay(request: Request) -> ReplayStatus:
    try:
        request.app.state.replay.pause()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _status(request)


@router.post(
    "/resume", response_model=ReplayStatus, dependencies=[Depends(get_current_admin)]
)
def resume_replay(payload: ReplayControl, request: Request) -> ReplayStatus:
    try:
        request.app.state.replay.resume(payload.speed)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _status(request)


@router.post(
    "/stop", response_model=ReplayStatus, dependencies=[Depends(get_current_admin)]
)
def stop_replay(request: Request) -> ReplayStatus:
    request.app.state.replay.stop()
    return _status(request)
