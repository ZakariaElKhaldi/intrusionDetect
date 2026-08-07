from __future__ import annotations

import argparse
import json
import sys
import time
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any, TextIO
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def iter_lines(handle: TextIO, *, follow: bool, poll_seconds: float) -> Iterator[str]:
    while True:
        position = handle.tell() if follow else None
        line = handle.readline()
        if line:
            # A writer can flush a partial JSON value before its terminating
            # newline. Rewind and wait so follow mode never submits a torn event.
            if follow and not line.endswith("\n"):
                time.sleep(poll_seconds)
                handle.seek(position)
                continue
            if line.strip():
                yield line
            continue
        if not follow:
            return
        time.sleep(poll_seconds)


def batches(items: Iterable[dict[str, Any]], size: int) -> Iterator[list[dict[str, Any]]]:
    batch: list[dict[str, Any]] = []
    for item in items:
        batch.append(item)
        if len(batch) == size:
            yield batch
            batch = []
    if batch:
        yield batch


def submit_batch(
    url: str,
    batch: list[dict[str, Any]],
    *,
    max_retries: int,
) -> dict[str, Any]:
    body = json.dumps({"observations": batch}, separators=(",", ":")).encode()
    for attempt in range(max_retries + 1):
        request = Request(
            url,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        try:
            with urlopen(request, timeout=30) as response:  # noqa: S310
                return json.load(response)
        except HTTPError as exc:
            retryable = exc.code == 429 or exc.code >= 500
            if not retryable or attempt == max_retries:
                detail = exc.read().decode("utf-8", errors="replace")
                raise RuntimeError(f"ingestion returned HTTP {exc.code}: {detail}") from exc
            retry_after = exc.headers.get("Retry-After")
            delay = float(retry_after) if retry_after else min(2**attempt, 30)
        except URLError as exc:
            if attempt == max_retries:
                raise RuntimeError(f"ingestion request failed: {exc.reason}") from exc
            delay = min(2**attempt, 30)
        time.sleep(delay)
    raise AssertionError("retry loop exhausted")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Stream canonical NDJSON to ingestion")
    parser.add_argument("path", nargs="?", default="-", help="NDJSON path or - for stdin")
    parser.add_argument(
        "--url", default="http://127.0.0.1:8000/api/v1/ingestion/events"
    )
    parser.add_argument("--batch-size", type=int, default=100, choices=range(1, 1001))
    parser.add_argument("--follow", action="store_true", help="follow a growing file")
    parser.add_argument("--poll-seconds", type=float, default=0.5)
    parser.add_argument("--max-retries", type=int, default=5)
    args = parser.parse_args(argv)
    if args.follow and args.path == "-":
        parser.error("--follow requires a file path")

    handle = sys.stdin if args.path == "-" else Path(args.path).open(encoding="utf-8")
    accepted = duplicates = rejected = 0
    try:
        records = (json.loads(line) for line in iter_lines(
            handle, follow=args.follow, poll_seconds=args.poll_seconds
        ))
        for batch in batches(records, args.batch_size):
            try:
                result = submit_batch(args.url, batch, max_retries=args.max_retries)
            except (RuntimeError, json.JSONDecodeError) as exc:
                rejected += len(batch)
                print(str(exc), file=sys.stderr)
                return 1
            for item in result["events"]:
                if item["disposition"] == "accepted":
                    accepted += 1
                else:
                    duplicates += 1
            print(
                f"accepted={accepted} duplicate={duplicates} rejected={rejected}",
                file=sys.stderr,
            )
    except (json.JSONDecodeError, OSError) as exc:
        rejected += 1
        print(f"invalid input: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        pass
    finally:
        if handle is not sys.stdin:
            handle.close()
    print(json.dumps({"accepted": accepted, "duplicate": duplicates, "rejected": rejected}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
