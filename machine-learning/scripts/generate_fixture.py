"""Regenerate the deterministic, schema-complete offline contract fixture."""

from __future__ import annotations

import csv
import sys
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT / "src"))

from iot_ids_ml.schema import (  # noqa: E402
    FEATURE_COLUMNS,
    TARGET_COLUMN,
)


def main() -> None:
    destination = PACKAGE_ROOT.parent / "data" / "sample" / "rt_iot2022_sample.csv"
    destination.parent.mkdir(parents=True, exist_ok=True)
    labels = ("MQTT", "Thing_speak", "DOS_SYN_Hping", "NMAP_TCP_scan")
    protocols = ("tcp", "udp", "tcp", "tcp")
    services = ("mqtt", "dns", "-", "ssh")
    rows: list[dict[str, object]] = []
    for row_number in range(32):
        class_index = row_number % len(labels)
        repetition = row_number // len(labels)
        row: dict[str, object] = {}
        for feature_index, feature in enumerate(FEATURE_COLUMNS):
            if feature == "proto":
                row[feature] = protocols[class_index]
            elif feature == "service":
                row[feature] = services[class_index]
            elif feature in {"id.orig_p", "id.resp_p"}:
                row[feature] = 1000 + row_number * 17 + feature_index
            elif "flag_count" in feature or "window_size" in feature:
                row[feature] = (row_number + feature_index) % 7
            else:
                row[feature] = round(
                    (feature_index + 1) * 0.125
                    + repetition * 0.031
                    + class_index * 0.5,
                    6,
                )
        row[TARGET_COLUMN] = labels[class_index]
        rows.append(row)

    with destination.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=[*FEATURE_COLUMNS, TARGET_COLUMN])
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    main()
