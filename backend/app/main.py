from __future__ import annotations

import csv
import hashlib
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import alerts, live, models, predictions, replay
from app.config import Settings
from app.database.models import Base, ModelVersion
from app.database.session import create_engine_and_session
from app.features.canonical_schema import FEATURE_ORDER
from app.inference.model_registry import ModelRegistry
from app.inference.shap_explanations import ExplanationService
from app.ingestion.dataset_replay import DatasetReplay
from app.live import LiveConnectionManager


def _dataset_status(
    dataset_path: str | None, registry: ModelRegistry
) -> dict[str, bool | str | None]:
    path = Path(dataset_path).expanduser().resolve() if dataset_path else None
    if path is None or not path.is_file():
        return {
            "ready": False,
            "checksum": None,
            "matches_training": None,
            "error": "dataset file is unavailable",
        }
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    checksum = digest.hexdigest()
    expected = registry.detector.metadata.get("dataset_sha256")
    try:
        with path.open(newline="", encoding="utf-8") as handle:
            fields = set(csv.DictReader(handle).fieldnames or ())
        missing = [name for name in (*FEATURE_ORDER, "Attack_type") if name not in fields]
        error = f"dataset schema mismatch; missing={missing}" if missing else None
    except (OSError, UnicodeError, csv.Error) as exc:
        error = f"dataset cannot be read: {exc}"
    return {
        "ready": error is None,
        "checksum": checksum,
        "matches_training": checksum == expected if expected else None,
        "error": error,
    }


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    engine, session_factory = create_engine_and_session(settings.database_url)
    registry = ModelRegistry(
        settings.model_artifact_path,
        settings.model_dir,
        allow_fallback=settings.allow_fallback,
    )
    dataset_status = _dataset_status(settings.replay_dataset_path, registry)

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
    app.state.replay = DatasetReplay(settings.replay_dataset_path)
    app.state.explanations = ExplanationService(registry)
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
            "detector_model_version": registry.detector.version,
            "classifier_model_version": registry.classifier.version,
            "fallback": bool(registry.detector.metadata.get("fallback")),
            "fallback_status": {
                "active": bool(registry.detector.metadata.get("fallback")),
                "detector": bool(registry.detector.metadata.get("fallback")),
                "classifier": bool(registry.classifier.metadata.get("fallback")),
            },
            "dataset_ready": dataset_status["ready"],
            "dataset_checksum": dataset_status["checksum"],
            "dataset_checksum_matches_training": dataset_status["matches_training"],
            "dataset_error": dataset_status["error"],
            "production_bundle_valid": registry.production_bundle_valid,
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
