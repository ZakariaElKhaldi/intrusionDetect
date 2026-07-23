from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import alerts, live, models, predictions, replay
from app.config import Settings
from app.database.models import Base, ModelVersion
from app.database.session import create_engine_and_session
from app.inference.model_registry import ModelRegistry
from app.ingestion.dataset_replay import DatasetReplay
from app.live import LiveConnectionManager


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    engine, session_factory = create_engine_and_session(settings.database_url)
    registry = ModelRegistry(settings.model_artifact_path, settings.model_dir)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        Base.metadata.create_all(engine)
        with session_factory() as session:
            for descriptor in registry.descriptors:
                row = session.get(ModelVersion, descriptor.model_version)
                if not row:
                    row = ModelVersion(
                        model_version=descriptor.model_version,
                        model_type=descriptor.model_type,
                        artifact_path=descriptor.artifact_path,
                        schema_version=descriptor.schema_version,
                        active=descriptor.active,
                        metadata_json=descriptor.metadata_json or {},
                    )
                    session.add(row)
            session.commit()
        yield
        app.state.replay.stop()
        engine.dispose()

    app = FastAPI(
        title="IoT Intrusion Detection API",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.state.SessionLocal = session_factory
    app.state.registry = registry
    app.state.live = LiveConnectionManager()
    app.state.replay = DatasetReplay()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", tags=["health"])
    @app.get("/api/v1/health", tags=["health"], include_in_schema=False)
    async def health() -> dict:
        return {
            "status": "ok",
            "schema_version": "rt-iot2022-v1",
            "model_version": registry.predictor.version,
            "live_connections": len(app.state.live.connections),
        }

    router = APIRouter()
    router.include_router(predictions.router)
    router.include_router(alerts.router)
    router.include_router(models.router)
    router.include_router(replay.router)
    router.include_router(live.router)
    app.include_router(router)
    app.include_router(router, prefix="/api/v1", include_in_schema=False)
    return app


app = create_app()
