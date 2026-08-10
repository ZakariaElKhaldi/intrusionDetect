from __future__ import annotations

from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Query, Request
from sqlalchemy import BigInteger, cast, extract, func, select

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
    aggregate_rows: list[tuple[int, str, int]],
    start: datetime | None,
    end: datetime,
    bucket_minutes: int,
) -> list[dict]:
    counts: dict[datetime, Counter] = defaultdict(Counter)
    for bucket_epoch, severity, count in aggregate_rows:
        bucket = datetime.fromtimestamp(int(bucket_epoch), tz=UTC)
        counts[bucket][severity] += int(count)
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
        prediction_total_statement = select(func.count()).select_from(Prediction)
        binary_statement = select(
            Prediction.binary_prediction, func.count()
        ).group_by(Prediction.binary_prediction)
        alert_total_statement = select(func.count()).select_from(Alert)
        status_statement = select(Alert.status, func.count()).group_by(Alert.status)
        severity_statement = select(Alert.severity, func.count()).group_by(Alert.severity)
        family_statement = (
            select(Prediction.attack_class, func.count())
            .select_from(Alert)
            .join(Prediction, Prediction.prediction_id == Alert.prediction_id)
            .group_by(Prediction.attack_class)
        )
        protocol = Observation.raw_features["proto"].as_string()
        protocol_statement = (
            select(protocol, func.count())
            .select_from(Alert)
            .join(Observation, Observation.event_id == Alert.event_id)
            .group_by(protocol)
        )
        earliest_statement = select(func.min(Alert.created_at))
        if start:
            prediction_total_statement = prediction_total_statement.where(
                Prediction.created_at >= start
            )
            binary_statement = binary_statement.where(Prediction.created_at >= start)
            alert_total_statement = alert_total_statement.where(Alert.created_at >= start)
            status_statement = status_statement.where(Alert.created_at >= start)
            severity_statement = severity_statement.where(Alert.created_at >= start)
            family_statement = family_statement.where(Alert.created_at >= start)
            protocol_statement = protocol_statement.where(Alert.created_at >= start)
            earliest_statement = earliest_statement.where(Alert.created_at >= start)

        prediction_total = int(session.scalar(prediction_total_statement) or 0)
        alert_total = int(session.scalar(alert_total_statement) or 0)
        binary_counts = Counter(
            {str(label): int(count) for label, count in session.execute(binary_statement)}
        )
        status_counts = Counter(
            {str(label): int(count) for label, count in session.execute(status_statement)}
        )
        severity_counts = Counter(
            {str(label): int(count) for label, count in session.execute(severity_statement)}
        )
        family_counts = Counter(
            {
                str(label or "unclassified"): int(count)
                for label, count in session.execute(family_statement)
            }
        )
        protocol_counts = Counter(
            {
                str(label or "unknown"): int(count)
                for label, count in session.execute(protocol_statement)
            }
        )
        earliest = session.scalar(earliest_statement)

        median_detection_score = None
        if prediction_total:
            middle = (prediction_total - 1) // 2
            score_statement = select(Prediction.detection_score)
            if start:
                score_statement = score_statement.where(Prediction.created_at >= start)
            score_statement = (
                score_statement.order_by(Prediction.detection_score)
                .offset(middle)
                .limit(2 if prediction_total % 2 == 0 else 1)
            )
            middle_scores = [float(value) for value in session.scalars(score_statement)]
            median_detection_score = sum(middle_scores) / len(middle_scores)

        if time_range == "all":
            bucket_minutes = (
                24 * 60
                if earliest and checked_at - _as_utc(earliest) > timedelta(days=7)
                else 60
            )
        else:
            bucket_minutes = RANGE_BUCKET_MINUTES[time_range]
        bucket_seconds = bucket_minutes * 60
        bucket_epoch = cast(
            func.floor(extract("epoch", Alert.created_at) / bucket_seconds)
            * bucket_seconds,
            BigInteger,
        ).label("bucket_epoch")
        timeline_statement = (
            select(bucket_epoch, Alert.severity, func.count())
            .group_by(bucket_epoch, Alert.severity)
            .order_by(bucket_epoch)
        )
        if start:
            timeline_statement = timeline_statement.where(Alert.created_at >= start)
        timeline_rows = [
            (int(epoch), str(severity), int(count))
            for epoch, severity, count in session.execute(timeline_statement)
        ]

        terminal_statuses = ("resolved", "false_positive")
        critical_open_statement = select(func.count()).select_from(Alert).where(
            Alert.severity == "critical",
            Alert.status.not_in(terminal_statuses),
        )
        if start:
            critical_open_statement = critical_open_statement.where(
                Alert.created_at >= start
            )
        critical_open = int(session.scalar(critical_open_statement) or 0)

    terminal_statuses = set(terminal_statuses)
    unresolved_alerts = sum(
        count for status, count in status_counts.items() if status not in terminal_statuses
    )
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
            "aggregation": "database_grouped",
        },
        "persisted_totals": {
            "predictions": prediction_total,
            "alerts": alert_total,
            "unresolved_alerts": unresolved_alerts,
        },
        "predictions": {
            "total": prediction_total,
            "attack": binary_counts["attack"],
            "normal": binary_counts["normal"],
        },
        "alerts": {
            "total": alert_total,
            "open": unresolved_alerts,
            "unresolved": unresolved_alerts,
            "critical_open": critical_open,
            "resolved": status_counts["resolved"],
            "false_positive": status_counts["false_positive"],
        },
        "median_detection_score": median_detection_score,
        "status_counts": dict(sorted(status_counts.items())),
        "severity_counts": dict(sorted(severity_counts.items())),
        "family_counts": dict(
            sorted(family_counts.items(), key=lambda item: (-item[1], item[0]))
        ),
        "protocol_counts": dict(
            sorted(protocol_counts.items(), key=lambda item: (-item[1], item[0]))
        ),
        "severity_timeline": _severity_timeline(
            timeline_rows, start, checked_at, bucket_minutes
        ),
    }
