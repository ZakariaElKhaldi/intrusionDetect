#!/usr/bin/env python3
"""Exercise the real HTTP queue and report durable PostgreSQL pipeline timings."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from statistics import median
from typing import Any

from sqlalchemy import func, select

from app.database.models import IngestionJob, IngestionJobTransition, OutboxEvent
from app.database.session import create_engine_and_session


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int((len(ordered) - 1) * fraction))]


def post_batch(
    api_url: str, payload: list[dict[str, Any]], token: str | None
) -> tuple[int, dict[str, Any]]:
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        f"{api_url.rstrip('/')}/api/v1/ingestion/events",
        data=json.dumps(payload).encode(),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as exc:
        return exc.code, {"detail": exc.read().decode(errors="replace")}


def milliseconds(start, end) -> float:
    if start.tzinfo is None and end.tzinfo is not None:
        start = start.replace(tzinfo=end.tzinfo)
    if end.tzinfo is None and start.tzinfo is not None:
        end = end.replace(tzinfo=start.tzinfo)
    return (end - start).total_seconds() * 1000


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="canonical NDJSON with unique event IDs")
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--api-url", default="http://127.0.0.1:8000")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--producers", type=int, default=4)
    parser.add_argument("--timeout-seconds", type=float, default=300)
    parser.add_argument("--output")
    parser.add_argument("--token", default=os.getenv("IOT_IDS_API_TOKEN"))
    args = parser.parse_args()
    if not args.database_url.startswith(("postgresql://", "postgresql+psycopg://")):
        parser.error("--database-url must select PostgreSQL")
    observations = [
        json.loads(line)
        for line in Path(args.input).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not observations:
        parser.error("input contains no observations")
    batches = [
        observations[index : index + args.batch_size]
        for index in range(0, len(observations), args.batch_size)
    ]
    event_ids = [str(item["event_id"]) for item in observations]

    started = time.perf_counter()
    intake_latencies: list[float] = []

    def submit(batch):
        batch_started = time.perf_counter()
        result = post_batch(args.api_url, batch, args.token)
        return result, (time.perf_counter() - batch_started) * 1000

    with ThreadPoolExecutor(max_workers=args.producers) as pool:
        responses = list(pool.map(submit, batches))
    intake_latencies.extend(latency for _response, latency in responses)
    deadline = time.monotonic() + args.timeout_seconds
    engine, sessions = create_engine_and_session(args.database_url)
    try:
        while time.monotonic() < deadline:
            with sessions() as session:
                terminal = session.scalar(
                    select(func.count()).select_from(IngestionJob).where(
                        IngestionJob.event_id.in_(event_ids),
                        IngestionJob.state.in_(("succeeded", "dead_letter")),
                    )
                ) or 0
            if terminal == len(set(event_ids)):
                break
            time.sleep(0.25)
        elapsed = time.perf_counter() - started
        with sessions() as session:
            jobs = list(
                session.scalars(
                    select(IngestionJob).where(IngestionJob.event_id.in_(event_ids))
                )
            )
            transitions = list(
                session.scalars(
                    select(IngestionJobTransition).where(
                        IngestionJobTransition.event_id.in_(event_ids)
                    )
                )
            )
            outbox = list(
                session.scalars(
                    select(OutboxEvent).where(OutboxEvent.event_id.in_(event_ids))
                )
            )
        by_job: dict[str, list[IngestionJobTransition]] = {}
        for transition in transitions:
            by_job.setdefault(transition.job_id, []).append(transition)
        queue_wait: list[float] = []
        processing: list[float] = []
        end_to_end: list[float] = []
        for job in jobs:
            history = sorted(by_job.get(job.job_id, []), key=lambda item: item.occurred_at)
            claim = next((item for item in history if item.reason_code == "claimed"), None)
            terminal_transition = next(
                (
                    item
                    for item in reversed(history)
                    if item.to_state in {"succeeded", "dead_letter"}
                ),
                None,
            )
            if claim:
                queue_wait.append(milliseconds(job.created_at, claim.occurred_at))
            if claim and terminal_transition:
                processing.append(milliseconds(claim.occurred_at, terminal_transition.occurred_at))
            if terminal_transition:
                end_to_end.append(milliseconds(job.created_at, terminal_transition.occurred_at))
        statuses = [status for (status, _body), _latency in responses]
        dispositions = [
            event.get("disposition")
            for (_status, body), _latency in responses
            for event in body.get("events", [])
        ]
        outbox_lag = [
            milliseconds(row.created_at, row.published_at)
            for row in outbox
            if row.published_at is not None
        ]
        report = {
            "requested": len(observations),
            "persisted_jobs": len(jobs),
            "throughput_per_second": len(jobs) / elapsed if elapsed else None,
            "intake_latency_ms": {
                "median": median(intake_latencies),
                "p95": percentile(intake_latencies, 0.95),
            },
            "queue_wait_ms": {
                "p50": percentile(queue_wait, 0.5),
                "p95": percentile(queue_wait, 0.95),
            },
            "processing_ms": {
                "p50": percentile(processing, 0.5),
                "p95": percentile(processing, 0.95),
            },
            "end_to_end_ms": {
                "p50": percentile(end_to_end, 0.5),
                "p95": percentile(end_to_end, 0.95),
            },
            "outbox_lag_ms": {
                "p50": percentile(outbox_lag, 0.5),
                "p95": percentile(outbox_lag, 0.95),
            },
            "duplicates": dispositions.count("duplicate"),
            "conflicts": statuses.count(409),
            "backpressure_responses": statuses.count(429),
            "retries": sum(max(job.attempts - 1, 0) for job in jobs),
            "failures": sum(job.state == "dead_letter" for job in jobs),
            "pending_outbox": sum(row.published_at is None for row in outbox),
            "completed": sum(job.state == "succeeded" for job in jobs),
            "timed_out": sum(job.state not in {"succeeded", "dead_letter"} for job in jobs),
        }
    finally:
        engine.dispose()
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        Path(args.output).write_text(rendered, encoding="utf-8")
    else:
        sys.stdout.write(rendered)
    return int(bool(report["timed_out"] or report["conflicts"] or report["failures"]))


if __name__ == "__main__":
    raise SystemExit(main())
