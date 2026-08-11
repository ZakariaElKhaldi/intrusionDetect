#!/usr/bin/env python3
"""Populate a local presentation instance through its versioned API."""

from __future__ import annotations

import argparse
import json
import os
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener


LOCAL_OPENER = build_opener(ProxyHandler({}))


def request_json(
    base_url: str,
    path: str,
    *,
    payload: dict[str, Any] | None = None,
    token: str | None = None,
) -> Any:
    headers = {"Accept": "application/json"}
    body = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload).encode("utf-8")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(
        f"{base_url.rstrip('/')}/api/v1{path}",
        data=body,
        headers=headers,
        method="POST" if payload is not None else "GET",
    )
    try:
        with LOCAL_OPENER.open(request, timeout=15) as response:
            return json.load(response)
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{path} returned HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(
            f"{path} could not reach the demo API: {exc.reason}"
        ) from exc


def wait_for_replay(
    base_url: str, token: str, *, timeout: float = 30
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status = request_json(base_url, "/replay/status", token=token)
        if status["status"] == "completed":
            return status
        if status["status"] in {"failed", "stopped"}:
            raise RuntimeError(f"replay ended unexpectedly: {status}")
        time.sleep(0.1)
    raise RuntimeError("replay did not complete within 30 seconds")


def seed_demo(base_url: str, username: str, password: str, records: int) -> int:
    if records < 1 or records > 100:
        raise ValueError("records must be between 1 and 100")
    login = request_json(
        base_url,
        "/auth/login",
        payload={"username": username, "password": password},
    )
    token = login["access_token"]
    for scenario in ("normal", "attack"):
        request_json(
            base_url,
            "/replay/start",
            token=token,
            payload={
                "mode": "dataset",
                "scenario": scenario,
                "offset": 0,
                "limit": records,
                "interval_ms": 250,
                "speed": 100,
            },
        )
        result = wait_for_replay(base_url, token)
        if result["processed"] != records:
            raise RuntimeError(
                f"{scenario} replay processed {result['processed']} of {records} records"
            )
    alerts = request_json(base_url, "/alerts", token=token)
    if not alerts:
        raise RuntimeError("attack replay completed without producing a visible alert")
    return len(alerts)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--username", default="admin")
    parser.add_argument("--records", type=int, default=8)
    args = parser.parse_args()
    password = os.environ.get("IOT_IDS_DEMO_PASSWORD")
    if not password:
        parser.error("IOT_IDS_DEMO_PASSWORD is required")
    alerts = seed_demo(args.base_url, args.username, password, args.records)
    print(
        f"Seeded {args.records} normal and {args.records} attack observations; "
        f"{alerts} alerts are ready for investigation."
    )


if __name__ == "__main__":
    main()
