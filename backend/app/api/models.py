from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict

router = APIRouter(tags=["models"])


class ModelResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    model_version: str
    model_type: str
    artifact_path: str | None
    schema_version: str
    active: bool
    metadata_json: dict


@router.get("/models", response_model=list[ModelResponse])
async def list_models(request: Request) -> list[ModelResponse]:
    from app.database.models import ModelVersion

    with request.app.state.SessionLocal() as session:
        return list(
            session.query(ModelVersion)
            .order_by(ModelVersion.active.desc(), ModelVersion.created_at.desc())
            .all()
        )


@router.get("/evaluation")
async def get_evaluation(
    request: Request,
    stage: Literal["binary", "multiclass"] = Query(...),
) -> dict:
    try:
        return request.app.state.registry.evaluation(stage)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
