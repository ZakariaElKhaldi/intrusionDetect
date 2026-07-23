from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy import select

from app.api.schemas import AlertDetail, AlertResponse, FeedbackRequest, FeedbackResponse
from app.database.models import Alert, AnalystFeedback, Observation, Prediction

router = APIRouter(tags=["alerts"])


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
            responses.append(
                AlertResponse(
                    alert_id=alert.alert_id,
                    event_id=alert.event_id,
                    severity=alert.severity,
                    reasons=alert.reasons,
                    top_features=alert.top_features,
                    status=alert.status,
                    created_at=alert.created_at,
                    model_version=prediction.model_version,
                    binary_prediction=prediction.binary_prediction,
                    attack_class=prediction.attack_class,
                    confidence=prediction.confidence,
                    raw_features=observation.raw_features,
                )
            )
        return responses


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
            binary_prediction=prediction.binary_prediction,
            attack_class=prediction.attack_class,
            confidence=prediction.confidence,
            raw_features=observation.raw_features,
            feedback=feedback,
        )


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
