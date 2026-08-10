from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from app.features.nfstream_extractor import extract_pcap, file_sha256, validation_report


def _write_json(value: Any, output: str | None) -> None:
    rendered = json.dumps(value, indent=2, sort_keys=True) + "\n"
    if output:
        Path(output).expanduser().write_text(rendered, encoding="utf-8")
    else:
        sys.stdout.write(rendered)


def _post_batch(
    api_url: str, observations: list[dict[str, Any]], token: str | None = None
) -> dict[str, Any]:
    endpoint = f"{api_url.rstrip('/')}/api/v1/ingestion/offline-pcap/events"
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        endpoint,
        data=json.dumps({"observations": observations}).encode(),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
            return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"ingestion API returned HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"ingestion API is unavailable: {exc.reason}") from exc


def validate_command(args: argparse.Namespace) -> int:
    _write_json(validation_report(args.capture), args.output)
    return 0


def ingest_command(args: argparse.Namespace) -> int:
    checksum = file_sha256(Path(args.capture).expanduser().resolve())
    accepted = duplicates = rejected = 0
    batch: list[dict[str, Any]] = []
    responses: list[dict[str, Any]] = []
    def submit(observations: list[dict[str, Any]]) -> dict[str, Any]:
        return (
            _post_batch(args.api_url, observations, args.token)
            if args.token
            else _post_batch(args.api_url, observations)
        )
    for observation, _context in extract_pcap(args.capture):
        payload = observation.model_dump(mode="json")
        batch.append(payload)
        if len(batch) >= args.batch_size:
            response = submit(batch)
            responses.append(response)
            events = response.get("events", [])
            accepted += sum(item.get("disposition") == "accepted" for item in events)
            duplicates += sum(item.get("disposition") == "duplicate" for item in events)
            rejected += sum(
                item.get("disposition") not in {"accepted", "duplicate"} for item in events
            )
            batch = []
    if batch:
        response = submit(batch)
        responses.append(response)
        events = response.get("events", [])
        accepted += sum(item.get("disposition") == "accepted" for item in events)
        duplicates += sum(item.get("disposition") == "duplicate" for item in events)
        rejected += sum(item.get("disposition") not in {"accepted", "duplicate"} for item in events)
    _write_json(
        {
            "pcap_checksum": checksum,
            "accepted": accepted,
            "duplicates": duplicates,
            "rejected": rejected,
            "batches": responses,
        },
        args.output,
    )
    return 0 if rejected == 0 else 1


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(
        prog="python -m app.ingestion.pcap_cli",
        description=(
            "Validate offline PCAP features or enqueue native flows. The server, not a "
            "caller-supplied file, decides whether a compatible route is installed."
        ),
    )
    actions = command.add_subparsers(dest="command", required=True)
    validate = actions.add_parser("validate", help="extract flows without inference")
    validate.add_argument("capture")
    validate.add_argument("--output")
    validate.set_defaults(handler=validate_command)
    ingest = actions.add_parser("ingest", help="enqueue a PCAP for server-side routing")
    ingest.add_argument("capture")
    ingest.add_argument("--api-url", default="http://127.0.0.1:8000")
    ingest.add_argument("--batch-size", type=int, choices=range(1, 1001), default=100)
    ingest.add_argument(
        "--token", default=os.getenv("IOT_IDS_API_TOKEN"), help="API bearer token"
    )
    ingest.add_argument("--output")
    ingest.set_defaults(handler=ingest_command)
    return command


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        return int(args.handler(args))
    except Exception as exc:
        sys.stderr.write(f"pcap command failed: {exc}\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
