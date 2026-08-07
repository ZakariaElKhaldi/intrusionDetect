from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from sqlalchemy import select

from app.config import Settings
from app.database.models import IngestionJob
from app.database.session import create_engine_and_session
from app.features.canonical_schema import FlowObservation
from app.inference.model_registry import ModelRegistry
from app.ingestion.service import (
    RedriveRefusedError,
    get_event,
    list_jobs,
    list_outbox_events,
    redrive_events,
)


def _render(value: Any) -> None:
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")
    sys.stdout.write(json.dumps(value, indent=2, sort_keys=True) + "\n")


def _registry(settings: Settings) -> ModelRegistry:
    return ModelRegistry(
        settings.model_artifact_path,
        settings.model_dir,
        nfstream_model_dir=settings.nfstream_model_dir,
        allow_fallback=settings.allow_fallback,
    )


def _compatibility_check(registry: ModelRegistry):
    def check(payload: dict) -> None:
        observation = FlowObservation.model_validate(payload)
        context = observation.network_context
        fingerprint = context.extractor_fingerprint if context else None
        registry.resolve_route(observation.schema_version, fingerprint)

    return check


def _run(args: argparse.Namespace) -> int:
    settings = Settings.from_env()
    database_url = args.database_url or settings.database_url
    engine, sessions = create_engine_and_session(database_url)
    try:
        with sessions() as session:
            if args.command == "list":
                _render(
                    list_jobs(
                        session,
                        state=args.state,
                        error_code=args.error_code,
                        source=args.source,
                        cursor=args.cursor,
                        limit=args.limit,
                    )
                )
            elif args.command == "inspect":
                result = get_event(session, args.event_id)
                if result is None:
                    raise ValueError("ingestion event not found")
                _render(result)
            elif args.command == "outbox":
                _render(
                    list_outbox_events(
                        session,
                        status=args.status,
                        event_type=args.event_type,
                        cursor=args.cursor,
                        limit=args.limit,
                    )
                )
            elif args.command == "redrive":
                registry = _registry(settings)
                _render(
                    {
                        "dry_run": args.dry_run,
                        "results": redrive_events(
                            session,
                            args.event_id,
                            operator=args.operator,
                            reason=args.reason,
                            compatibility_check=_compatibility_check(registry),
                            dry_run=args.dry_run,
                        ),
                    }
                )
            elif args.command == "export-dead-letter":
                rows = list(
                    session.scalars(
                        select(IngestionJob)
                        .where(IngestionJob.state == "dead_letter")
                        .order_by(IngestionJob.created_at, IngestionJob.job_id)
                    )
                )
                evidence = [
                    {
                        "event_id": row.event_id,
                        "payload_hash": row.payload_hash,
                        "state": row.state,
                        "attempts": row.attempts,
                        "error_code": row.error_code,
                        "retryable": row.retryable,
                        "last_error": row.last_error,
                        "redrive_count": row.redrive_count,
                        "created_at": row.created_at.isoformat(),
                        "completed_at": (
                            row.completed_at.isoformat() if row.completed_at else None
                        ),
                    }
                    for row in rows
                ]
                destination = Path(args.output).expanduser().resolve()
                destination.write_text(
                    json.dumps(evidence, indent=2, sort_keys=True) + "\n",
                    encoding="utf-8",
                )
                _render({"exported": len(evidence), "output": str(destination)})
        return 0
    finally:
        engine.dispose()


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(
        prog="python -m app.ingestion.operator_cli",
        description="Inspect durable ingestion state and perform audited local redrives.",
    )
    command.add_argument("--database-url", help="defaults to IOT_IDS_DATABASE_URL")
    actions = command.add_subparsers(dest="command", required=True)

    listing = actions.add_parser("list", help="list ingestion jobs")
    listing.add_argument("--state")
    listing.add_argument("--error-code")
    listing.add_argument("--source")
    listing.add_argument("--cursor")
    listing.add_argument("--limit", type=int, default=100, choices=range(1, 501))

    inspect = actions.add_parser("inspect", help="show one job and its transition history")
    inspect.add_argument("event_id")

    outbox = actions.add_parser("outbox", help="inspect outbox publication state")
    outbox.add_argument("--status", choices=("pending", "failed", "published"))
    outbox.add_argument("--event-type")
    outbox.add_argument("--cursor")
    outbox.add_argument("--limit", type=int, default=100, choices=range(1, 501))

    redrive = actions.add_parser("redrive", help="redrive explicit dead-letter events")
    redrive.add_argument("event_id", nargs="+")
    redrive.add_argument("--operator", required=True)
    redrive.add_argument("--reason", required=True)
    redrive.add_argument("--dry-run", action="store_true")

    export = actions.add_parser("export-dead-letter", help="export dead-letter evidence")
    export.add_argument("--output", required=True)
    return command


def main(argv: Sequence[str] | None = None) -> int:
    try:
        return _run(parser().parse_args(argv))
    except (ValueError, RedriveRefusedError, RuntimeError) as exc:
        sys.stderr.write(f"operator command failed: {exc}\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
