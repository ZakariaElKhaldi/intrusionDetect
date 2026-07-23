from __future__ import annotations

import asyncio
from dataclasses import dataclass

from app.features.canonical_schema import FlowObservation
from app.service import process_observation


@dataclass(slots=True)
class ReplayState:
    status: str = "idle"
    processed: int = 0
    total: int = 0
    error: str | None = None
    speed: float = 1.0
    scenario: str = "custom"


class DatasetReplay:
    def __init__(self) -> None:
        self.state = ReplayState()
        self.task: asyncio.Task | None = None
        self._resume = asyncio.Event()
        self._resume.set()
        self._base_interval_ms = 1_000

    def start(
        self,
        app,
        observations: list[FlowObservation],
        interval_ms: int,
        *,
        speed: float = 1.0,
        scenario: str = "custom",
    ) -> None:
        if self.task and not self.task.done():
            raise RuntimeError("replay is already running")
        self._base_interval_ms = interval_ms
        self._resume.set()
        self.state = ReplayState(
            status="running",
            total=len(observations),
            speed=speed,
            scenario=scenario,
        )
        self.task = asyncio.create_task(self._run(app, observations))

    async def _run(self, app, observations: list[FlowObservation]) -> None:
        try:
            for observation in observations:
                await self._resume.wait()
                with app.state.SessionLocal() as session:
                    await process_observation(
                        observation, session, app.state.registry, app.state.live
                    )
                self.state.processed += 1
                if self._base_interval_ms:
                    await asyncio.sleep(
                        self._base_interval_ms / 1000 / max(self.state.speed, 0.01)
                    )
            self.state.status = "completed"
        except asyncio.CancelledError:
            self.state.status = "stopped"
            raise
        except Exception as exc:
            self.state.status = "failed"
            self.state.error = str(exc)

    def pause(self) -> None:
        if self.state.status != "running":
            raise RuntimeError("only a running replay can be paused")
        self._resume.clear()
        self.state.status = "paused"

    def resume(self, speed: float | None = None) -> None:
        if speed is not None:
            self.state.speed = speed
        if self.state.status not in {"paused", "running"}:
            raise RuntimeError("only a paused or running replay can be resumed")
        self.state.status = "running"
        self._resume.set()

    def stop(self) -> None:
        self._resume.set()
        if self.task and not self.task.done():
            self.task.cancel()
        self.state.status = "stopped"
