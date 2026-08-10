from __future__ import annotations

import asyncio

from app.config import Settings
from app.database.schema import verify_schema_current
from app.database.session import create_engine_and_session
from app.inference.model_registry import ModelRegistry
from app.live import LiveConnectionManager
from app.monitoring.service import ModelHealthService


async def evaluate_once(service: ModelHealthService, live: LiveConnectionManager) -> None:
    cohorts = service.observed_cohorts()
    deployment = service.deployment_cohort()
    if not any(cohort == deployment for cohort in cohorts):
        cohorts.append(deployment)
    for cohort in cohorts:
        for window in ("fast", "slow"):
            snapshot = service.evaluate(window, cohort=cohort)
            if snapshot.__dict__.pop("_status_changed", False):
                await live.broadcast(
                    {
                        "type": "model_health.updated",
                        "data": {
                            "status": snapshot.status,
                            "reason": snapshot.reason,
                            "window": snapshot.window,
                            "cohort": snapshot.cohort,
                            "observation_count": snapshot.observation_count,
                            "aggregate": snapshot.aggregate,
                            "checked_at": snapshot.checked_at.isoformat(),
                            "shadow_mode": snapshot.shadow_mode,
                        },
                    },
                )


async def monitoring_loop(
    service: ModelHealthService,
    live: LiveConnectionManager,
    *,
    interval_seconds: float,
) -> None:
    while True:
        await asyncio.sleep(interval_seconds)
        await evaluate_once(service, live)


def run_worker() -> None:
    settings = Settings.from_env()
    settings.validate()
    engine, session_factory = create_engine_and_session(settings.database_url)
    verify_schema_current(engine)
    registry = ModelRegistry(
        settings.model_artifact_path,
        settings.model_dir,
        allow_fallback=settings.allow_fallback,
        nfstream_model_dir=settings.nfstream_model_dir,
    )
    service = ModelHealthService(
        session_factory,
        registry,
        shadow_mode=settings.model_health_shadow_mode,
        fast_minimum=settings.model_health_fast_minimum,
        slow_minimum=settings.model_health_slow_minimum,
        retention_days=settings.model_health_retention_days,
    )
    asyncio.run(
        monitoring_loop(
            service,
            LiveConnectionManager(),
            interval_seconds=settings.model_health_interval_seconds,
        )
    )


if __name__ == "__main__":
    run_worker()
