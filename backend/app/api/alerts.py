from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy import func, select

from app.api.schemas import (
    AlertDetail,
    AlertPage,
    AlertPageFilters,
    AlertResponse,
    FeedbackRequest,
    FeedbackResponse,
)
from app.database.models import Alert, AnalystFeedback, Observation, Prediction

router = APIRouter(tags=["alerts"])


def _alert_response(
    alert: Alert, prediction: Prediction, observation: Observation
) -> AlertResponse:
    return AlertResponse(
        alert_id=alert.alert_id,
        event_id=alert.event_id,
        severity=alert.severity,
        reasons=alert.reasons,
        top_features=alert.top_features,
        status=alert.status,
        created_at=alert.created_at,
        model_version=prediction.model_version,
        detector_model_version=prediction.detector_model_version,
        classifier_model_version=prediction.classifier_model_version,
        binary_prediction=prediction.binary_prediction,
        attack_class=prediction.attack_class,
        confidence=prediction.confidence,
        detection_score=prediction.detection_score,
        attack_class_score=prediction.attack_class_score,
        detector_latency_ms=prediction.detector_latency_ms,
        classifier_latency_ms=prediction.classifier_latency_ms,
        total_latency_ms=prediction.end_to_end_latency_ms,
        raw_features=observation.raw_features,
        network_context=observation.network_context,
    )


@router.get("/alerts", response_model=list[AlertResponse])
async def list_alerts(
    request: Request,
    severity: str | None = None,
    alert_status: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[AlertResponse]:
    with request.app.state.SessionLocal() as session:
        statement = select(Alert)
        if severity:
            statement = statement.where(Alert.severity == severity)
        if alert_status:
            statement = statement.where(Alert.status == alert_status)
        statement = statement.order_by(Alert.created_at.desc()).offset(offset).limit(limit)
        alerts = list(session.scalars(statement).all())
        responses = []
        for alert in alerts:
            prediction = session.get(Prediction, alert.prediction_id)
            observation = session.get(Observation, alert.event_id)
            responses.append(_alert_response(alert, prediction, observation))
        return responses


@router.get("/alerts/page", response_model=AlertPage)
async def page_alerts(
    request: Request,
    severity: str | None = None,
    alert_status: str | None = Query(default=None, alias="status"),
    family: str | None = None,
    query: str | None = Query(default=None, alias="q", max_length=256),
    from_time: Annotated[datetime | None, Query(alias="from")] = None,
    to_time: Annotated[datetime | None, Query(alias="to")] = None,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> AlertPage:
    if from_time and to_time and from_time >= to_time:
        raise HTTPException(status_code=422, detail="from must be earlier than to")
    with request.app.state.SessionLocal() as session:
        statement = (
            select(Alert, Prediction, Observation)
            .join(Prediction, Prediction.prediction_id == Alert.prediction_id)
            .join(Observation, Observation.event_id == Alert.event_id)
        )
        if severity:
            statement = statement.where(Alert.severity == severity)
        if alert_status:
            statement = statement.where(Alert.status == alert_status)
        if family:
            statement = statement.where(Prediction.attack_class == family)
        if from_time:
            statement = statement.where(Alert.created_at >= from_time)
        if to_time:
            statement = statement.where(Alert.created_at < to_time)
        if query and query.strip():
            rows = list(session.execute(statement.order_by(Alert.created_at.desc())).all())
            needle = query.casefold().strip()

            def matches(row) -> bool:
                alert, prediction, observation = row
                features = observation.raw_features
                context = observation.network_context or {}
                values = (
                    alert.alert_id,
                    prediction.attack_class or "",
                    str(context.get("source_ip", features.get("source_ip", ""))),
                    str(
                        context.get(
                            "destination_ip", features.get("destination_ip", "")
                        )
                    ),
                    str(context.get("source_port", features.get("id.orig_p", ""))),
                    str(
                        context.get(
                            "destination_port", features.get("id.resp_p", "")
                        )
                    ),
                    str(features.get("proto", "")),
                    str(features.get("service", "")),
                )
                return any(needle in value.casefold() for value in values)

            rows = [row for row in rows if matches(row)]
            total = len(rows)
            page_rows = rows[offset : offset + limit]
        else:
            total = int(
                session.scalar(
                    select(func.count()).select_from(statement.order_by(None).subquery())
                )
                or 0
            )
            page_rows = list(
                session.execute(
                    statement.order_by(Alert.created_at.desc()).offset(offset).limit(limit)
                ).all()
            )
        items = [
            _alert_response(alert, prediction, observation)
            for alert, prediction, observation in page_rows
        ]
        return AlertPage(
            items=items,
            total=total,
            limit=limit,
            offset=offset,
            has_more=offset + len(items) < total,
            filters=AlertPageFilters(
                severity=severity or None,
                status=alert_status or None,
                family=family or None,
                q=query.strip() if query and query.strip() else None,
                from_time=from_time,
                to_time=to_time,
            ),
        )


@router.get("/alerts/{alert_id}", response_model=AlertDetail)
async def get_alert(alert_id: UUID, request: Request) -> AlertDetail:
    with request.app.state.SessionLocal() as session:
        alert = session.get(Alert, str(alert_id))
        if not alert:
            raise HTTPException(status_code=404, detail="alert not found")
        prediction = session.get(Prediction, alert.prediction_id)
        observation = session.get(Observation, alert.event_id)
        feedback = list(
            session.scalars(
                select(AnalystFeedback)
                .where(AnalystFeedback.alert_id == alert.alert_id)
                .order_by(AnalystFeedback.created_at)
            ).all()
        )
        return AlertDetail(
            alert_id=alert.alert_id,
            event_id=alert.event_id,
            severity=alert.severity,
            reasons=alert.reasons,
            top_features=alert.top_features,
            status=alert.status,
            created_at=alert.created_at,
            model_version=prediction.model_version,
            detector_model_version=prediction.detector_model_version,
            classifier_model_version=prediction.classifier_model_version,
            binary_prediction=prediction.binary_prediction,
            attack_class=prediction.attack_class,
            confidence=prediction.confidence,
            detection_score=prediction.detection_score,
            attack_class_score=prediction.attack_class_score,
            detector_latency_ms=prediction.detector_latency_ms,
            classifier_latency_ms=prediction.classifier_latency_ms,
            total_latency_ms=prediction.end_to_end_latency_ms,
            raw_features=observation.raw_features,
            network_context=observation.network_context,
            feedback=feedback,
        )


@router.get("/alerts/{alert_id}/explanation")
async def get_alert_explanation(alert_id: UUID, request: Request) -> dict:
    with request.app.state.SessionLocal() as session:
        alert = session.get(Alert, str(alert_id))
        if not alert:
            raise HTTPException(status_code=404, detail="alert not found")
        prediction = session.get(Prediction, alert.prediction_id)
        observation = session.get(Observation, alert.event_id)
        if not prediction.attack_class:
            raise HTTPException(
                status_code=409, detail="classifier explanation is unavailable for this alert"
            )
        registry = request.app.state.registry
        if (
            prediction.detector_model_version != registry.detector.version
            or prediction.classifier_model_version != registry.classifier.version
        ):
            raise HTTPException(
                status_code=409,
                detail="the model artifacts used for this alert are no longer active",
            )
        try:
            return request.app.state.explanations.explain_alert(
                alert.alert_id, observation.raw_features, prediction.attack_class
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post(
    "/alerts/{alert_id}/feedback",
    response_model=FeedbackResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_feedback(
    alert_id: UUID, payload: FeedbackRequest, request: Request
) -> AnalystFeedback:
    with request.app.state.SessionLocal() as session:
        alert = session.get(Alert, str(alert_id))
        if not alert:
            raise HTTPException(status_code=404, detail="alert not found")
        feedback = AnalystFeedback(
            alert_id=alert.alert_id,
            analyst=payload.analyst,
            status=payload.status,
            notes=payload.notes,
        )
        alert.status = payload.status
        session.add(feedback)
        session.commit()
        session.refresh(feedback)
        return feedback
