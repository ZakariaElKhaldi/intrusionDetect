from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal
from uuid import NAMESPACE_URL, uuid4, uuid5

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import get_current_admin
from app.database.models import Alert, OutboxEvent, SensorState

router = APIRouter(prefix="/sensors", tags=["sensors"])


class SuricataAlert(BaseModel):
    model_config = ConfigDict(extra="forbid")

    signature_id: int = Field(ge=1)
    rev: int | None = Field(default=None, ge=0)
    signature: str = Field(min_length=1, max_length=2_000)
    category: str = Field(min_length=1, max_length=256)
    severity: int = Field(ge=1, le=255)
    action: str = Field(default="allowed", min_length=1, max_length=64)


class SuricataEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timestamp: datetime
    event_type: Literal["alert", "stats"]
    flow_id: str | None = Field(default=None, max_length=64)
    tx_id: int | None = Field(default=None, ge=0)
    pcap_cnt: int | None = Field(default=None, ge=0)
    src_ip: str | None = Field(default=None, max_length=64)
    src_port: int | None = Field(default=None, ge=0, le=65_535)
    dest_ip: str | None = Field(default=None, max_length=64)
    dest_port: int | None = Field(default=None, ge=0, le=65_535)
    proto: str | None = Field(default=None, max_length=32)
    app_proto: str | None = Field(default=None, max_length=64)
    alert: SuricataAlert | None = None
    stats: dict[str, Any] | None = None

    @field_validator("timestamp")
    @classmethod
    def timestamp_must_be_aware(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("timestamp must include a timezone")
        return value.astimezone(UTC)


class SuricataBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sensor_id: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_.-]*$")
    interface: str = Field(min_length=1, max_length=128)
    engine_version: str | None = Field(default=None, max_length=64)
    rule_count: int | None = Field(default=None, ge=0)
    events: list[SuricataEvent] = Field(max_length=1_000)


class SuricataReceipt(BaseModel):
    accepted_alerts: int
    duplicate_alerts: int
    observed_events: int


def _sensor_token(
    request: Request,
    token: Annotated[str | None, Header(alias="X-Sensor-Token")] = None,
) -> str:
    expected = request.app.state.settings.sensor_token_hash
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="sensor ingestion is not configured",
        )
    supplied = hashlib.sha256((token or "").encode("utf-8")).hexdigest()
    if not token or not secrets.compare_digest(supplied, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid sensor credential",
        )
    return "sensor"


def _severity(priority: int) -> str:
    if priority == 1:
        return "critical"
    if priority == 2:
        return "high"
    if priority == 3:
        return "medium"
    return "low"


def _event_identity(sensor_id: str, event: SuricataEvent) -> str:
    assert event.alert is not None
    material = ":".join(
        [
            sensor_id,
            event.timestamp.isoformat(),
            event.flow_id or "",
            str(event.alert.signature_id),
            str(event.tx_id if event.tx_id is not None else ""),
            str(event.pcap_cnt if event.pcap_cnt is not None else ""),
        ]
    )
    return str(uuid5(NAMESPACE_URL, f"iot-ids:suricata:{material}"))


def _nested_int(value: dict[str, Any] | None, *path: str) -> int | None:
    current: Any = value
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    if isinstance(current, bool) or not isinstance(current, (int, float)):
        return None
    return max(0, int(current))


def _alert_wire(alert: Alert) -> dict[str, Any]:
    return {
        "alert_id": alert.alert_id,
        "event_id": None,
        "detection_source": "suricata",
        "severity": alert.severity,
        "reasons": alert.reasons,
        "top_features": [],
        "status": alert.status,
        "created_at": (alert.occurred_at or alert.created_at).isoformat(),
        "model_version": None,
        "detector_model_version": None,
        "classifier_model_version": None,
        "binary_prediction": None,
        "attack_class": alert.signature,
        "confidence": None,
        "detection_score": None,
        "attack_class_score": None,
        "detector_latency_ms": None,
        "classifier_latency_ms": None,
        "total_latency_ms": None,
        "raw_features": {},
        "network_context": alert.network_context,
        "sensor_evidence": alert.sensor_evidence,
    }


def sensor_status(session: Session, *, offline_seconds: int) -> dict[str, Any]:
    now = datetime.now(UTC)
    rows = list(session.scalars(select(SensorState).order_by(SensorState.sensor_id)).all())
    sensors: list[dict[str, Any]] = []
    for row in rows:
        heartbeat = row.last_heartbeat_at
        if heartbeat.tzinfo is None:
            heartbeat = heartbeat.replace(tzinfo=UTC)
        online = heartbeat >= now - timedelta(seconds=offline_seconds)
        sensors.append(
            {
                "sensor_id": row.sensor_id,
                "status": "online" if online else "offline",
                "interface": row.interface,
                "engine_version": row.engine_version,
                "rule_count": row.rule_count,
                "packets": row.packets,
                "capture_drops": row.capture_drops,
                "events_seen": row.events_seen,
                "alerts_accepted": row.alerts_accepted,
                "last_event_at": row.last_event_at,
                "last_heartbeat_at": row.last_heartbeat_at,
            }
        )
    return {
        "status": "online" if any(item["status"] == "online" for item in sensors) else "offline",
        "sensors": sensors,
        "aggregate": {
            "packets": sum(item["packets"] for item in sensors),
            "capture_drops": sum(item["capture_drops"] for item in sensors),
            "events_seen": sum(item["events_seen"] for item in sensors),
            "alerts_accepted": sum(item["alerts_accepted"] for item in sensors),
        },
        "checked_at": now,
    }


@router.post(
    "/suricata/events",
    response_model=SuricataReceipt,
    dependencies=[Depends(_sensor_token)],
)
def ingest_suricata(batch: SuricataBatch, request: Request) -> SuricataReceipt:
    accepted = 0
    duplicates = 0
    latest_event: datetime | None = None
    latest_stats: dict[str, Any] | None = None
    with request.app.state.SessionLocal() as session:
        state = session.get(SensorState, batch.sensor_id)
        if state is None:
            state = SensorState(
                sensor_id=batch.sensor_id,
                interface=batch.interface,
                packets=0,
                capture_drops=0,
                events_seen=0,
                alerts_accepted=0,
            )
            session.add(state)
        state.interface = batch.interface
        state.engine_version = batch.engine_version or state.engine_version
        state.rule_count = batch.rule_count if batch.rule_count is not None else state.rule_count
        state.last_heartbeat_at = datetime.now(UTC)
        state.events_seen += len(batch.events)

        for event in batch.events:
            latest_event = max(latest_event, event.timestamp) if latest_event else event.timestamp
            if event.event_type == "stats":
                latest_stats = event.stats or {}
                continue
            if event.alert is None:
                continue
            external_id = _event_identity(batch.sensor_id, event)
            if session.scalar(select(Alert.alert_id).where(Alert.external_event_id == external_id)):
                duplicates += 1
                continue
            network_context = {
                "source_ip": event.src_ip,
                "destination_ip": event.dest_ip,
                "source_port": event.src_port,
                "destination_port": event.dest_port,
                "protocol": event.proto,
                "interface": batch.interface,
                "capture_id": event.flow_id,
                "extractor_fingerprint": None,
            }
            evidence = {
                "sensor_id": batch.sensor_id,
                "engine": "suricata",
                "engine_version": batch.engine_version,
                "signature_id": event.alert.signature_id,
                "signature_revision": event.alert.rev,
                "signature": event.alert.signature,
                "category": event.alert.category,
                "priority": event.alert.severity,
                "action": event.alert.action,
                "application_protocol": event.app_proto,
                "flow_id": event.flow_id,
                "tx_id": event.tx_id,
                "pcap_count": event.pcap_cnt,
            }
            alert = Alert(
                alert_id=str(uuid4()),
                event_id=None,
                prediction_id=None,
                detection_source="suricata",
                external_event_id=external_id,
                occurred_at=event.timestamp,
                sensor_id=batch.sensor_id,
                signature_id=event.alert.signature_id,
                signature=event.alert.signature,
                category=event.alert.category,
                action=event.alert.action,
                network_context=network_context,
                sensor_evidence=evidence,
                severity=_severity(event.alert.severity),
                reasons=[event.alert.signature, event.alert.category],
                top_features=[],
            )
            session.add(alert)
            session.flush()
            session.add(
                OutboxEvent(
                    event_id=alert.alert_id,
                    event_type="alert.created",
                    payload={"type": "alert.created", "data": _alert_wire(alert)},
                )
            )
            accepted += 1

        if latest_event:
            state.last_event_at = latest_event
        if latest_stats is not None:
            packets = _nested_int(latest_stats, "capture", "kernel_packets")
            if packets is not None:
                state.packets = packets
            state.capture_drops = _nested_int(latest_stats, "capture", "kernel_drops") or 0
        state.alerts_accepted += accepted
        session.commit()
    return SuricataReceipt(
        accepted_alerts=accepted,
        duplicate_alerts=duplicates,
        observed_events=len(batch.events),
    )


@router.get("/status", dependencies=[Depends(get_current_admin)])
def get_sensor_status(request: Request) -> dict[str, Any]:
    with request.app.state.SessionLocal() as session:
        return sensor_status(
            session,
            offline_seconds=request.app.state.settings.sensor_offline_seconds,
        )
