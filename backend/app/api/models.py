from __future__ import annotations

from fastapi import APIRouter, Request
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
