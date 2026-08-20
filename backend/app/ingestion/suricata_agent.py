from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def normalize(record: dict[str, Any]) -> dict[str, Any] | None:
    event_type = record.get("event_type")
    if event_type not in {"alert", "stats"} or not isinstance(record.get("timestamp"), str):
        return None
    alert = record.get("alert")
    normalized_alert = None
    if event_type == "alert" and isinstance(alert, dict):
        normalized_alert = {
            key: alert.get(key)
            for key in ("signature_id", "rev", "signature", "category", "severity", "action")
        }
    normalized = {
        "timestamp": record["timestamp"],
        "event_type": event_type,
        "flow_id": str(record["flow_id"]) if record.get("flow_id") is not None else None,
        "tx_id": record.get("tx_id"),
        "pcap_cnt": record.get("pcap_cnt"),
        "src_ip": record.get("src_ip"),
        "src_port": record.get("src_port"),
        "dest_ip": record.get("dest_ip"),
        "dest_port": record.get("dest_port"),
        "proto": record.get("proto"),
        "app_proto": record.get("app_proto"),
        "alert": normalized_alert,
        "stats": record.get("stats") if event_type == "stats" else None,
    }
    return normalized


class EveFollower:
    def __init__(self, eve_path: Path, checkpoint_path: Path) -> None:
        self.eve_path = eve_path
        self.checkpoint_path = checkpoint_path
        self.offset = self._load_offset()

    def _load_offset(self) -> int:
        try:
            return max(0, int(json.loads(self.checkpoint_path.read_text())["offset"]))
        except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
            return 0

    def read(self, limit: int) -> tuple[list[dict[str, Any]], int]:
        if not self.eve_path.exists():
            return [], self.offset
        size = self.eve_path.stat().st_size
        if size < self.offset:
            self.offset = 0
        records: list[dict[str, Any]] = []
        with self.eve_path.open("r", encoding="utf-8") as handle:
            handle.seek(self.offset)
            while len(records) < limit:
                line_start = handle.tell()
                line = handle.readline()
                if not line or not line.endswith("\n"):
                    handle.seek(line_start)
                    break
                try:
                    raw = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(raw, dict) and (item := normalize(raw)) is not None:
                    records.append(item)
            return records, handle.tell()

    def commit(self, offset: int) -> None:
        self.checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.checkpoint_path.with_suffix(".tmp")
        temporary.write_text(json.dumps({"offset": offset}), encoding="utf-8")
        temporary.replace(self.checkpoint_path)
        self.offset = offset


def main() -> int:
    parser = argparse.ArgumentParser(description="Reliably forward Suricata EVE records")
    parser.add_argument(
        "--eve", default=os.getenv("IOT_IDS_EVE_PATH", "/var/log/suricata/eve.json")
    )
    parser.add_argument(
        "--checkpoint",
        default=os.getenv("IOT_IDS_EVE_CHECKPOINT", "/state/eve-checkpoint.json"),
    )
    parser.add_argument(
        "--url",
        default=os.getenv(
            "IOT_IDS_SENSOR_API_URL",
            "http://backend:8000/api/v1/sensors/suricata/events",
        ),
    )
    parser.add_argument("--sensor-id", default=os.getenv("IOT_IDS_SENSOR_ID", "presentation-lab"))
    parser.add_argument("--interface", default=os.getenv("IOT_IDS_SENSOR_INTERFACE", "iotlab0"))
    parser.add_argument("--engine-version", default=os.getenv("IOT_IDS_SURICATA_VERSION"))
    parser.add_argument(
        "--rule-count",
        type=int,
        default=int(os.getenv("IOT_IDS_SURICATA_RULE_COUNT", "0")),
    )
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--poll-seconds", type=float, default=1.0)
    args = parser.parse_args()
    token = os.getenv("IOT_IDS_SENSOR_TOKEN", "")
    if len(token) < 32:
        raise SystemExit("IOT_IDS_SENSOR_TOKEN must contain at least 32 characters")
    follower = EveFollower(Path(args.eve), Path(args.checkpoint))
    next_heartbeat = 0.0
    delay = 1.0
    while True:
        events, next_offset = follower.read(args.batch_size)
        now = time.monotonic()
        if not events and now < next_heartbeat:
            time.sleep(args.poll_seconds)
            continue
        payload = {
            "sensor_id": args.sensor_id,
            "interface": args.interface,
            "engine_version": args.engine_version,
            "rule_count": args.rule_count or None,
            "events": events,
        }
        request = Request(
            args.url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "X-Sensor-Token": token},
            method="POST",
        )
        try:
            with urlopen(request, timeout=10) as response:
                if not 200 <= response.status < 300:
                    raise RuntimeError(f"sensor API returned HTTP {response.status}")
        except (HTTPError, URLError, OSError, RuntimeError) as error:
            print(f"sensor delivery failed: {error}", flush=True)
            time.sleep(delay)
            delay = min(30.0, delay * 2)
            continue
        follower.commit(next_offset)
        delay = 1.0
        next_heartbeat = now + 5.0
        if not events:
            time.sleep(args.poll_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
