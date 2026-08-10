from __future__ import annotations

from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta
from statistics import median
from typing import Literal

from fastapi import APIRouter, Query, Request
from sqlalchemy import select

from app.database.models import Alert, Observation, Prediction

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

RANGE_DURATION = {
    "15m": timedelta(minutes=15),
    "1h": timedelta(hours=1),
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
}
RANGE_BUCKET_MINUTES = {"15m": 1, "1h": 5, "24h": 60, "7d": 24 * 60}


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _bucket_start(value: datetime, bucket_minutes: int) -> datetime:
    value = _as_utc(value)
    seconds = bucket_minutes * 60
    epoch = int(value.timestamp())
    return datetime.fromtimestamp(epoch - epoch % seconds, tz=UTC)


def _severity_timeline(
    alert_rows: list,
    start: datetime | None,
    end: datetime,
    bucket_minutes: int,
) -> list[dict]:
    counts: dict[datetime, Counter] = defaultdict(Counter)
    for alert, _, _ in alert_rows:
        counts[_bucket_start(alert.created_at, bucket_minutes)][alert.severity] += 1
    if start is None:
        bucket_starts = sorted(counts)
    else:
        first = _bucket_start(start, bucket_minutes)
        last = _bucket_start(end, bucket_minutes)
        step = timedelta(minutes=bucket_minutes)
        bucket_starts = []
        current = first
        while current <= last:
            bucket_starts.append(current)
            current += step
    return [
        {
            "bucket_start": bucket.isoformat(),
            "total": sum(counts[bucket].values()),
            "critical": counts[bucket]["critical"],
            "high": counts[bucket]["high"],
            "medium": counts[bucket]["medium"],
            "low": counts[bucket]["low"],
        }
        for bucket in bucket_starts
    ]


@router.get("/summary")
def dashboard_summary(
    request: Request,
    time_range: Literal["15m", "1h", "24h", "7d", "all"] = Query(
        default="24h", alias="range"
    ),
) -> dict:
    checked_at = datetime.now(UTC)
    start = checked_at - RANGE_DURATION[time_range] if time_range != "all" else None
    with request.app.state.SessionLocal() as session:
        prediction_statement = select(Prediction)
        alert_statement = (
            select(Alert, Prediction, Observation)
            .join(Prediction, Prediction.prediction_id == Alert.prediction_id)
            .join(Observation, Observation.event_id == Alert.event_id)
        )
        if start:
            prediction_statement = prediction_statement.where(Prediction.created_at >= start)
            alert_statement = alert_statement.where(Alert.created_at >= start)
        predictions = list(session.scalars(prediction_statement).all())
        alert_rows = list(session.execute(alert_statement).all())

    binary_counts = Counter(item.binary_prediction for item in predictions)
    status_counts = Counter(alert.status for alert, _, _ in alert_rows)
    severity_counts = Counter(alert.severity for alert, _, _ in alert_rows)
    family_counts = Counter(
        prediction.attack_class or "unclassified" for _, prediction, _ in alert_rows
    )
    protocol_counts = Counter(
        str(observation.raw_features.get("proto", "unknown"))
        for _, _, observation in alert_rows
    )
    terminal_statuses = {"resolved", "false_positive"}
    unresolved_alerts = sum(
        count for status, count in status_counts.items() if status not in terminal_statuses
    )
    critical_open = sum(
        1
        for alert, _, _ in alert_rows
        if alert.severity == "critical" and alert.status not in terminal_statuses
    )
    scores = [prediction.detection_score for prediction in predictions]
    if time_range == "all":
        earliest = min((_as_utc(alert.created_at) for alert, _, _ in alert_rows), default=None)
        bucket_minutes = (
            24 * 60
            if earliest and checked_at - earliest > timedelta(days=7)
            else 60
        )
    else:
        bucket_minutes = RANGE_BUCKET_MINUTES[time_range]
    return {
        "range": time_range,
        "checked_at": checked_at.isoformat(),
        "generated_at": checked_at.isoformat(),
        "window": {
            "from": start.isoformat() if start else None,
            "to": checked_at.isoformat(),
        },
        "scope": {
            "source": "persisted_database_records",
            "time_field": "created_at",
            "range": time_range,
            "from": start.isoformat() if start else None,
            "to": checked_at.isoformat(),
            "bucket_minutes": bucket_minutes,
            "includes": ["predictions", "alerts"],
        },
        "persisted_totals": {
            "predictions": len(predictions),
            "alerts": len(alert_rows),
            "unresolved_alerts": unresolved_alerts,
        },
        "predictions": {
            "total": len(predictions),
            "attack": binary_counts["attack"],
            "normal": binary_counts["normal"],
        },
        "alerts": {
            "total": len(alert_rows),
            "open": unresolved_alerts,
            "unresolved": unresolved_alerts,
            "critical_open": critical_open,
            "resolved": status_counts["resolved"],
            "false_positive": status_counts["false_positive"],
        },
        "median_detection_score": float(median(scores)) if scores else None,
        "status_counts": dict(sorted(status_counts.items())),
        "severity_counts": dict(sorted(severity_counts.items())),
        "family_counts": dict(
            sorted(family_counts.items(), key=lambda item: (-item[1], item[0]))
        ),
        "protocol_counts": dict(
            sorted(protocol_counts.items(), key=lambda item: (-item[1], item[0]))
        ),
        "severity_timeline": _severity_timeline(
            alert_rows, start, checked_at, bucket_minutes
        ),
    }
