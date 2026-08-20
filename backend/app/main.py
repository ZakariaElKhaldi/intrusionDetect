from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import APIRouter, FastAPI, Request, Response, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api import (
    alerts,
    auth,
    dashboard,
    ingestion,
    live,
    model_health,
    models,
    predictions,
    replay,
    suricata,
)
from app.api.auth import LoginRateLimiter
from app.api.errors import safe_validation_details
from app.api.suricata import sensor_status
from app.config import Settings
from app.database.models import Base, ModelVersion
from app.database.schema import verify_schema_current
from app.database.session import create_engine_and_session
from app.health import DatasetHealthCache
from app.http_limits import RequestBodyLimitMiddleware
from app.inference.model_registry import ModelRegistry
from app.inference.shap_explanations import ExplanationService
from app.ingestion.dataset_replay import DatasetReplay
from app.ingestion.outbox import OutboxDispatcher
from app.ingestion.service import ingestion_status
from app.live import LiveConnectionManager
from app.metrics import ApplicationMetrics
from app.monitoring.service import ModelHealthService
from app.monitoring.worker import monitoring_loop
from app.operational_logging import configure_operational_logging
from app.operational_middleware import OperationalMiddleware

LOGGER = configure_operational_logging("WARNING", "json").getChild("api")


def create_app(
    settings: Settings | None = None, *, initialize_schema_for_tests: bool = False
) -> FastAPI:
    settings = settings or Settings.from_env()
    global LOGGER
    LOGGER = configure_operational_logging(
        settings.log_level, settings.log_format
    ).getChild("api")
    engine, session_factory = create_engine_and_session(settings.database_url)
    registry = ModelRegistry(
        settings.model_artifact_path,
        settings.model_dir,
        allow_fallback=settings.allow_fallback,
        nfstream_model_dir=settings.nfstream_model_dir,
    )
    dataset_health = DatasetHealthCache(
        settings.replay_dataset_path, registry.detector.metadata.get("dataset_sha256")
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        settings.validate()
        if initialize_schema_for_tests:
            Base.metadata.create_all(engine)
        else:
            verify_schema_current(engine)
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
        dispatcher = OutboxDispatcher(
            session_factory,
            app.state.live,
            poll_seconds=settings.outbox_poll_seconds,
            lease_seconds=settings.outbox_lease_seconds,
        )
        dispatcher.start()
        monitor = asyncio.create_task(
            monitoring_loop(
                app.state.model_health,
                app.state.live,
                interval_seconds=settings.model_health_interval_seconds,
            )
        )
        yield
        app.state.replay.stop()
        await dispatcher.stop()
        monitor.cancel()
        try:
            await monitor
        except asyncio.CancelledError:
            pass
        engine.dispose()

    app = FastAPI(
        title="IoT Intrusion Detection API",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.state.SessionLocal = session_factory
    app.state.settings = settings
    app.state.login_rate_limiter = LoginRateLimiter()
    app.state.registry = registry
    app.state.live = LiveConnectionManager(
        max_connections=settings.max_live_connections,
        send_timeout_seconds=settings.live_send_timeout_seconds,
    )
    app.state.replay = DatasetReplay(settings.replay_dataset_path)
    app.state.explanations = ExplanationService(registry)
    app.state.model_health = ModelHealthService(
        session_factory,
        registry,
        shadow_mode=settings.model_health_shadow_mode,
        fast_minimum=settings.model_health_fast_minimum,
        slow_minimum=settings.model_health_slow_minimum,
        retention_days=settings.model_health_retention_days,
    )
    app.state.metrics = ApplicationMetrics()

    @app.exception_handler(RequestValidationError)
    async def safe_request_validation_error(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            {"detail": safe_validation_details(exc.errors())},
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=list(settings.allowed_hosts),
        www_redirect=False,
    )
    app.add_middleware(
        RequestBodyLimitMiddleware,
        max_bytes=settings.max_request_body_bytes,
    )
    app.add_middleware(OperationalMiddleware, settings=settings, logger=LOGGER)

    @app.get("/livez", tags=["health"], include_in_schema=False)
    @app.get("/api/v1/livez", tags=["health"], include_in_schema=False)
    async def livez() -> dict[str, str]:
        """Cheap process liveness probe; external dependencies are intentionally excluded."""
        return {"status": "alive"}

    @app.get("/metrics", tags=["health"], include_in_schema=False)
    def metrics() -> Response:
        application_metrics: ApplicationMetrics = app.state.metrics
        application_metrics.live_connections.set(len(app.state.live.connections))
        try:
            with session_factory() as session:
                session.execute(text("SELECT 1"))
                current = ingestion_status(
                    session, lease_seconds=settings.worker_lease_seconds
                )
            application_metrics.database_up.set(1)
            application_metrics.ingestion_queue_depth.set(current.queue_depth)
            application_metrics.ingestion_dead_letter.set(current.dead_letter)
            application_metrics.outbox_pending.set(current.outbox.pending)
        except Exception:  # pragma: no cover - depends on external database failure
            application_metrics.database_up.set(0)
            application_metrics.ingestion_queue_depth.set(float("nan"))
            application_metrics.ingestion_dead_letter.set(float("nan"))
            application_metrics.outbox_pending.set(float("nan"))
            LOGGER.error(
                "Database metrics collection failed",
                extra={
                    "event": "database.metrics.failed",
                    "instance_id": settings.instance_id,
                    "error_type": "database_unavailable",
                },
            )
        return Response(
            application_metrics.render(),
            headers={"Content-Type": application_metrics.content_type},
        )

    @app.get("/health", tags=["health"])
    @app.get("/api/v1/health", tags=["health"], include_in_schema=False)
    def health() -> dict:
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
                sensor_health = sensor_status(
                    session, offline_seconds=settings.sensor_offline_seconds
                )
            database_status = "ready"
        except Exception:  # pragma: no cover - depends on external database failure
            database_status = "blocked"
            database_error = "database connectivity check failed"
            LOGGER.error(
                "Database health check failed",
                extra={
                    "event": "database.health.failed",
                    "instance_id": settings.instance_id,
                    "error_type": "database_unavailable",
                },
            )
            ingestion_health = None
            sensor_health = None
        model_health_component = app.state.model_health.component()
        model_health_degrades_readiness = bool(
            model_health_component.get("degrades_readiness")
        )
        component_states = [dataset["status"], model_status, database_status]
        if model_health_degrades_readiness:
            component_states.append("degraded")
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
            "detector_probability_calibrated": (
                registry.detector.metadata.get("probability_calibrated") is True
            ),
            "classifier_probability_calibrated": (
                registry.classifier.metadata.get("probability_calibrated") is True
            ),
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
                    "probability_calibrated": (
                        registry.detector.metadata.get("probability_calibrated") is True
                    ),
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
                    "probability_calibrated": (
                        registry.classifier.metadata.get("probability_calibrated") is True
                    ),
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
                "model_health": model_health_component,
                "sensor": (
                    {
                        **sensor_health,
                        "reason": (
                            "a passive Suricata sensor is reporting live traffic"
                            if sensor_health["status"] == "online"
                            else "no passive Suricata sensor is currently reporting"
                        ),
                    }
                    if sensor_health
                    else {"status": "blocked", "reason": "database is unavailable"}
                ),
            },
        }

    @app.get("/readyz", tags=["health"], include_in_schema=False)
    @app.get("/api/v1/readyz", tags=["health"], include_in_schema=False)
    def readyz() -> Response:
        evidence = health()
        status_code = (
            status.HTTP_503_SERVICE_UNAVAILABLE
            if evidence["readiness"] == "blocked"
            else status.HTTP_200_OK
        )
        return JSONResponse(jsonable_encoder(evidence), status_code=status_code)

    # Authentication bootstrap and operational probes are deliberately public.
    # All business data is deny-by-default when authentication is enabled.
    router = APIRouter()
    router.include_router(auth.router)
    router.include_router(live.router)
    router.include_router(predictions.router)
    router.include_router(alerts.router)
    router.include_router(dashboard.router)
    router.include_router(models.router)
    router.include_router(replay.router)
    router.include_router(ingestion.router)
    router.include_router(model_health.router)
    router.include_router(suricata.router)
    app.include_router(router)
    app.include_router(router, prefix="/api/v1", include_in_schema=False)
    return app


app = create_app()
