from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api import alerts, dashboard, ingestion, live, models, predictions, replay
from app.config import Settings
from app.database.models import Base, ModelVersion
from app.database.session import create_engine_and_session
from app.health import DatasetHealthCache
from app.inference.model_registry import ModelRegistry
from app.inference.shap_explanations import ExplanationService
from app.ingestion.dataset_replay import DatasetReplay
from app.ingestion.outbox import dispatch_loop, stop_dispatcher
from app.ingestion.service import ingestion_status
from app.live import LiveConnectionManager


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    engine, session_factory = create_engine_and_session(settings.database_url)
    registry = ModelRegistry(
        settings.model_artifact_path,
        settings.model_dir,
        allow_fallback=settings.allow_fallback,
    )
    dataset_health = DatasetHealthCache(
        settings.replay_dataset_path, registry.detector.metadata.get("dataset_sha256")
    )

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
        dispatcher = asyncio.create_task(
            dispatch_loop(
                session_factory,
                app.state.live,
                poll_seconds=settings.outbox_poll_seconds,
            )
        )
        yield
        app.state.replay.stop()
        await stop_dispatcher(dispatcher)
        engine.dispose()

    app = FastAPI(
        title="IoT Intrusion Detection API",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.state.SessionLocal = session_factory
    app.state.settings = settings
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
        dataset = dataset_health.status()
        fallback_active = bool(
            registry.detector.metadata.get("fallback")
            or registry.classifier.metadata.get("fallback")
        )
        model_status = (
            "ready"
            if registry.production_bundle_valid and not fallback_active
            else "degraded"
            if fallback_active
            else "blocked"
        )
        detector_fallback = bool(registry.detector.metadata.get("fallback"))
        classifier_fallback = bool(registry.classifier.metadata.get("fallback"))
        model_reason = (
            "validated promoted artifacts are active"
            if model_status == "ready"
            else "development fallback models are active"
            if model_status == "degraded"
            else "validated model artifacts are unavailable"
        )
        database_error = None
        try:
            with session_factory() as session:
                session.execute(text("SELECT 1"))
                ingestion_health = ingestion_status(
                    session, lease_seconds=settings.worker_lease_seconds
                )
            database_status = "ready"
        except Exception as exc:  # pragma: no cover - depends on external database failure
            database_status = "blocked"
            database_error = str(exc)
            ingestion_health = None
        component_states = [dataset["status"], model_status, database_status]
        readiness = (
            "blocked"
            if "blocked" in component_states
            else "degraded"
            if "degraded" in component_states
            else "ready"
        )
        checked_at = datetime.now(UTC).isoformat()
        return {
            "status": "ok",
            "readiness": readiness,
            "checked_at": checked_at,
            "instance_id": settings.instance_id,
            "schema_version": "rt-iot2022-v1",
            "model_version": registry.predictor.version,
            "detector_model_version": registry.detector.version,
            "classifier_model_version": registry.classifier.version,
            "fallback": fallback_active,
            "fallback_status": {
                "active": fallback_active,
                "detector": bool(registry.detector.metadata.get("fallback")),
                "classifier": bool(registry.classifier.metadata.get("fallback")),
            },
            "dataset_ready": dataset["ready"],
            "dataset_checksum": dataset["checksum"],
            "dataset_checksum_matches_training": dataset[
                "checksum_matches_training"
            ],
            "dataset_error": dataset["error"],
            "production_bundle_valid": registry.production_bundle_valid,
            "live_connections": len(app.state.live.connections),
            "components": {
                "api": {"status": "ready", "reason": "HTTP API is serving requests"},
                "database": {
                    "status": database_status,
                    "reason": database_error or "database connectivity check passed",
                    "error": database_error,
                },
                "dataset": dataset,
                "models": {
                    "status": model_status,
                    "reason": model_reason,
                    "production_bundle_valid": registry.production_bundle_valid,
                    "detector_model_version": registry.detector.version,
                    "classifier_model_version": registry.classifier.version,
                },
                "detector": {
                    "status": "degraded" if detector_fallback else "ready",
                    "reason": (
                        "development fallback detector is active"
                        if detector_fallback
                        else "promoted detector artifact is active"
                    ),
                    "model_version": registry.detector.version,
                    "fallback": detector_fallback,
                },
                "classifier": {
                    "status": "degraded" if classifier_fallback else "ready",
                    "reason": (
                        "development fallback classifier is active"
                        if classifier_fallback
                        else "promoted classifier artifact is active"
                    ),
                    "model_version": registry.classifier.version,
                    "fallback": classifier_fallback,
                },
                "bundle": {
                    "status": model_status,
                    "reason": model_reason,
                    "valid": registry.production_bundle_valid,
                },
                "fallback": {
                    "status": "degraded" if fallback_active else "ready",
                    "active": fallback_active,
                    "reason": (
                        "fallback inference is active"
                        if fallback_active
                        else "fallback inference is inactive"
                    ),
                },
                "stream": {
                    "status": "ready",
                    "reason": "WebSocket event stream is accepting connections",
                    "connections": len(app.state.live.connections),
                },
                "replay": {
                    "status": "blocked" if not dataset["ready"] else "ready",
                    "reason": (
                        dataset["error"] or "validated replay dataset is available"
                    ),
                    "lifecycle": app.state.replay.state.status,
                },
                "ingestion": (
                    {
                        "status": (
                            "degraded"
                            if ingestion_health.dead_letter
                            else "ready"
                        ),
                        "reason": (
                            f"{ingestion_health.dead_letter} events are dead-lettered"
                            if ingestion_health.dead_letter
                            else "durable ingestion queue is available"
                        ),
                        "queue_depth": ingestion_health.queue_depth,
                        "oldest_pending_age_seconds": ingestion_health.oldest_pending_age_seconds,
                        "dead_letter": ingestion_health.dead_letter,
                    }
                    if ingestion_health
                    else {"status": "blocked", "reason": "database is unavailable"}
                ),
                "worker": (
                    ingestion_health.worker.model_dump(mode="json")
                    if ingestion_health
                    else {
                        "status": "blocked",
                        "reason": "database is unavailable",
                        "last_heartbeat_at": None,
                    }
                ),
                "outbox": (
                    ingestion_health.outbox.model_dump(mode="json")
                    if ingestion_health
                    else {
                        "status": "blocked",
                        "reason": "database is unavailable",
                        "pending": 0,
                        "published": 0,
                        "oldest_pending_age_seconds": None,
                    }
                ),
            },
        }

    router = APIRouter()
    router.include_router(predictions.router)
    router.include_router(alerts.router)
    router.include_router(dashboard.router)
    router.include_router(models.router)
    router.include_router(replay.router)
    router.include_router(live.router)
    router.include_router(ingestion.router)
    app.include_router(router)
    app.include_router(router, prefix="/api/v1", include_in_schema=False)
    return app


app = create_app()
