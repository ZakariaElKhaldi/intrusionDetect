from __future__ import annotations

import asyncio
import csv
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from app.features.canonical_schema import FEATURE_ORDER, FlowObservation
from app.service import process_observation

NORMAL_LABELS = frozenset(
    {
        "MQTT",
        "MQTT_Publish",
        "Thing_speak",
        "Thing_Speak",
        "Wipro_bulb_Dataset",
        "Wipro_bulb",
        "Amazon-Alexa",
    }
)


@dataclass(slots=True)
class ReplayState:
    status: str = "idle"
    processed: int = 0
    total: int = 0
    error: str | None = None
    speed: float = 1.0
    scenario: str = "custom"
    mode: str = "custom"
    offset: int = 0
    limit: int | None = None


def _scenario_matches(label: str, scenario: str) -> bool:
    if scenario == "all":
        return True
    is_normal = label in NORMAL_LABELS
    if scenario == "normal":
        return is_normal
    if scenario == "attack":
        return not is_normal
    if scenario.startswith("class:"):
        return label == scenario.removeprefix("class:")
    raise ValueError("scenario must be all, normal, attack, or class:<exact label>")


class DatasetReplay:
    def __init__(self, dataset_path: str | None = None) -> None:
        self.dataset_path = Path(dataset_path).expanduser().resolve() if dataset_path else None
        self.state = ReplayState()
        self.task: asyncio.Task | None = None
        self._resume = asyncio.Event()
        self._resume.set()
        self._base_interval_ms = 1_000

    def _ensure_idle(self) -> None:
        if self.task and not self.task.done():
            raise RuntimeError("replay is already running")

    def start(
        self,
        app,
        observations: list[FlowObservation],
        interval_ms: int,
        *,
        speed: float = 1.0,
        scenario: str = "custom",
    ) -> None:
        """Backward-compatible custom observation replay entrypoint."""
        self.start_custom(app, observations, interval_ms, speed=speed, scenario=scenario)

    def start_custom(
        self,
        app,
        observations: list[FlowObservation],
        interval_ms: int,
        *,
        speed: float = 1.0,
        scenario: str = "custom",
    ) -> None:
        self._ensure_idle()
        self._start(
            app,
            observations,
            total=len(observations),
            interval_ms=interval_ms,
            speed=speed,
            scenario=scenario,
            mode="custom",
            offset=0,
            limit=len(observations),
        )

    def start_dataset(
        self,
        app,
        interval_ms: int,
        *,
        speed: float,
        scenario: str,
        offset: int,
        limit: int | None,
    ) -> None:
        self._ensure_idle()
        if not self.dataset_path or not self.dataset_path.is_file():
            raise FileNotFoundError(
                "replay dataset is unavailable; set IOT_IDS_DATASET_PATH"
            )
        # Validate the scenario before the background task is accepted.
        _scenario_matches("__validation__", scenario)
        total = self._dataset_total(scenario, offset, limit)
        self._start(
            app,
            self._dataset_observations(scenario, offset, limit),
            total=total,
            interval_ms=interval_ms,
            speed=speed,
            scenario=scenario,
            mode="dataset",
            offset=offset,
            limit=limit,
        )

    def _start(
        self,
        app,
        observations: Iterable[FlowObservation],
        *,
        total: int,
        interval_ms: int,
        speed: float,
        scenario: str,
        mode: str,
        offset: int,
        limit: int | None,
    ) -> None:
        self._base_interval_ms = interval_ms
        self._resume.set()
        self.state = ReplayState(
            status="running",
            total=total,
            speed=speed,
            scenario=scenario,
            mode=mode,
            offset=offset,
            limit=limit,
        )
        self.task = asyncio.create_task(self._run(app, observations))

    def _rows(self) -> Iterator[tuple[int, dict[str, str]]]:
        assert self.dataset_path is not None
        with self.dataset_path.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            fields = set(reader.fieldnames or ())
            missing = [name for name in (*FEATURE_ORDER, "Attack_type") if name not in fields]
            if missing:
                raise ValueError(f"replay dataset schema mismatch; missing={missing}")
            yield from enumerate(reader)

    def _matching_rows(
        self, scenario: str, offset: int, limit: int | None
    ) -> Iterator[dict[str, str]]:
        emitted = 0
        for row_index, row in self._rows():
            if row_index < offset:
                continue
            if not _scenario_matches(row["Attack_type"], scenario):
                continue
            if limit is not None and emitted >= limit:
                break
            emitted += 1
            yield row

    def _dataset_total(self, scenario: str, offset: int, limit: int | None) -> int:
        return sum(1 for _ in self._matching_rows(scenario, offset, limit))

    def _dataset_observations(
        self, scenario: str, offset: int, limit: int | None
    ) -> Iterator[FlowObservation]:
        for row in self._matching_rows(scenario, offset, limit):
            observed_at = datetime.now(UTC)
            yield FlowObservation(
                event_id=uuid4(),
                flow_started_at=observed_at,
                flow_ended_at=observed_at,
                source="dataset-replay",
                features={name: row[name] for name in FEATURE_ORDER},
                ground_truth=row["Attack_type"],
            )

    async def _run(self, app, observations: Iterable[FlowObservation]) -> None:
        try:
            for observation in observations:
                await self._resume.wait()
                with app.state.SessionLocal() as session:
                    await process_observation(
                        observation,
                        session,
                        app.state.registry,
                        app.state.live,
                        ingestion_channel="dataset_replay",
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
