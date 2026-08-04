#!/usr/bin/env python3
"""Measure server-managed dataset replay through the public API and live socket."""

from __future__ import annotations

import argparse
import asyncio
import json
import sqlite3
import statistics
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from websockets.asyncio.client import connect


def api_json(base_url: str, path: str, payload: dict | None = None) -> dict | list:
    data = json.dumps(payload).encode() if payload is not None else None
    request = Request(
        f"{base_url}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST" if payload is not None else "GET",
    )
    try:
        with urlopen(request, timeout=30) as response:  # noqa: S310 - explicit local URL
            return json.load(response)
    except HTTPError as exc:
        raise RuntimeError(f"{path} returned HTTP {exc.code}: {exc.read().decode()}") from exc


def database_snapshot(path: Path) -> dict[str, int]:
    with sqlite3.connect(path) as connection:
        return {
            table: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in ("observations", "predictions", "alerts")
        }


def new_latencies(path: Path, previous_predictions: int) -> list[float]:
    with sqlite3.connect(path) as connection:
        rows = connection.execute(
            "SELECT end_to_end_latency_ms FROM predictions ORDER BY rowid "
            "LIMIT -1 OFFSET ?",
            (previous_predictions,),
        ).fetchall()
    return [float(row[0]) for row in rows]


def percentile(values: list[float], quantile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    position = (len(ordered) - 1) * quantile
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


async def measure_scenario(
    *, base_url: str, ws_url: str, database: Path, scenario: str, limit: int
) -> dict:
    before = database_snapshot(database)
    event_counts = {"prediction.created": 0, "alert.created": 0}
    stop = asyncio.Event()

    async def collect(socket) -> None:
        while not stop.is_set():
            try:
                message = await asyncio.wait_for(socket.recv(), timeout=0.2)
            except TimeoutError:
                continue
            payload = json.loads(message)
            event_type = payload.get("type")
            if event_type in event_counts:
                event_counts[event_type] += 1

    async with connect(ws_url) as socket:
        collector = asyncio.create_task(collect(socket))
        started = time.perf_counter()
        response = await asyncio.to_thread(
            api_json,
            base_url,
            "/api/v1/replay/start",
            {
                "mode": "dataset",
                "scenario": scenario,
                "limit": limit,
                "interval_ms": 0,
                "speed": 100,
            },
        )
        if response["status"] != "running":
            raise RuntimeError(f"replay did not start: {response}")
        while True:
            state = await asyncio.to_thread(api_json, base_url, "/api/v1/replay/status")
            if state["status"] in {"completed", "failed", "stopped"}:
                break
            await asyncio.sleep(0.02)
        duration = time.perf_counter() - started
        await asyncio.sleep(0.25)
        stop.set()
        await collector

    after = database_snapshot(database)
    persisted = {key: after[key] - before[key] for key in before}
    latencies = new_latencies(database, before["predictions"])
    failures = max(0, int(state["total"]) - persisted["observations"])
    if state["status"] != "completed":
        failures = max(failures, 1)
    return {
        "scenario": scenario,
        "requested_limit": limit,
        "interval_ms": 0,
        "replay_status": state["status"],
        "replay_error": state.get("error"),
        "processed": state["processed"],
        "persisted_observations": persisted["observations"],
        "persisted_predictions": persisted["predictions"],
        "persisted_alerts": persisted["alerts"],
        "prediction_event_count": event_counts["prediction.created"],
        "alert_event_count": event_counts["alert.created"],
        "failures": failures,
        "wall_time_seconds": round(duration, 6),
        "throughput_observations_per_second": round(
            persisted["observations"] / duration if duration else 0.0, 3
        ),
        "end_to_end_latency_ms": {
            "count": len(latencies),
            "mean": round(statistics.fmean(latencies), 6) if latencies else 0.0,
            "p50": round(percentile(latencies, 0.50), 6),
            "p95": round(percentile(latencies, 0.95), 6),
        },
    }


def markdown(report: dict) -> str:
    rows = []
    for result in report["scenarios"]:
        rows.append(
            "| {scenario} | {processed} | {persisted_alerts} | "
            "{prediction_event_count} / {alert_event_count} | {failures} | "
            "{throughput_observations_per_second:.3f} | {p50:.3f} / {p95:.3f} |".format(
                **result, **result["end_to_end_latency_ms"]
            )
        )
    return "\n".join(
        [
            "# Dataset replay benchmark",
            "",
            f"Measured: `{report['recorded_at']}` against the promoted cascade.",
            "Both scenarios use server-managed RT-IoT2022 replay, interval 0, and a clean SQLite database.",
            "",
            "| Scenario | Processed | Alerts | WS prediction / alert events | Failures | Throughput obs/s | E2E p50 / p95 ms |",
            "|---|---:|---:|---:|---:|---:|---:|",
            *rows,
            "",
            "Latency is measured inside the application from observation processing start through database commit and response construction. Wall-clock throughput additionally includes HTTP polling and scheduler overhead. This is a local demonstration benchmark, not a capacity or production load test.",
            "",
        ]
    )


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8010")
    parser.add_argument("--ws-url", default="ws://127.0.0.1:8010/api/v1/live")
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=200)
    parser.add_argument("--output-json", type=Path, required=True)
    parser.add_argument("--output-markdown", type=Path, required=True)
    args = parser.parse_args()

    health = await asyncio.to_thread(api_json, args.base_url, "/health")
    scenarios = []
    for scenario in ("normal", "attack"):
        scenarios.append(
            await measure_scenario(
                base_url=args.base_url,
                ws_url=args.ws_url,
                database=args.database,
                scenario=scenario,
                limit=args.limit,
            )
        )
    report = {
        "schema_version": "replay-benchmark-v1",
        "recorded_at": datetime.now(UTC).isoformat(),
        "environment": "local single-process FastAPI, promoted models, disposable SQLite",
        "dataset_checksum": health.get("dataset_checksum"),
        "detector_model_version": health.get("detector_model_version"),
        "classifier_model_version": health.get("classifier_model_version"),
        "fallback_active": health.get("fallback_active", health.get("fallback")),
        "measurement_notes": [
            "WebSocket counts are observed from one client connected before replay starts.",
            "Scores are uncalibrated and this benchmark does not establish production capacity.",
        ],
        "scenarios": scenarios,
    }
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_markdown.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    args.output_markdown.write_text(markdown(report), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
