from __future__ import annotations

from time import perf_counter
from uuid import UUID

from sqlalchemy.orm import Session

from app.database.models import Alert, Observation, Prediction
from app.detection.device_profiles import evaluate_device_profile
from app.detection.severity import assess_severity
from app.features.canonical_schema import FlowObservation, PredictionResponse
from app.inference.model_registry import ModelRegistry
from app.inference.predictor import run_inference
from app.live import LiveConnectionManager


async def process_observation(
    observation: FlowObservation,
    session: Session,
    registry: ModelRegistry,
    live: LiveConnectionManager,
) -> PredictionResponse:
    started = perf_counter()
    event_id = str(observation.event_id)
    if session.get(Observation, event_id):
        raise ValueError(f"event_id already exists: {event_id}")

    observation_row = Observation(
        event_id=event_id,
        schema_version=observation.schema_version,
        flow_started_at=observation.flow_started_at,
        flow_ended_at=observation.flow_ended_at,
        source=observation.source,
        raw_features=observation.features,
        ground_truth=observation.ground_truth,
    )
    session.add(observation_row)
    inference = run_inference(registry, observation.features)
    prediction_row = Prediction(
        event_id=event_id,
        model_version=inference.model_version,
        binary_prediction=inference.binary_prediction,
        attack_class=inference.attack_class,
        confidence=inference.confidence,
        latency_ms=inference.latency_ms,
        end_to_end_latency_ms=0,
        top_features=inference.top_features,
    )
    session.add(prediction_row)
    session.flush()

    alert_row = None
    behavior_reasons = evaluate_device_profile(observation.features)
    if inference.binary_prediction == "attack" or behavior_reasons:
        severity, reasons = assess_severity(
            inference.binary_prediction, inference.confidence, behavior_reasons
        )
        alert_row = Alert(
            event_id=event_id,
            prediction_id=prediction_row.prediction_id,
            severity=severity,
            reasons=reasons,
            top_features=inference.top_features,
            status="new",
        )
        session.add(alert_row)
        session.flush()

    prediction_row.end_to_end_latency_ms = (perf_counter() - started) * 1000
    session.commit()
    end_to_end = (perf_counter() - started) * 1000
    prediction_row.end_to_end_latency_ms = end_to_end
    session.commit()
    response = PredictionResponse(
        prediction_id=UUID(prediction_row.prediction_id),
        event_id=observation.event_id,
        model_version=inference.model_version,
        binary_prediction=inference.binary_prediction,
        attack_class=inference.attack_class,
        confidence=inference.confidence,
        latency_ms=inference.latency_ms,
        raw_features=observation.features,
        top_features=inference.top_features,
        end_to_end_latency_ms=end_to_end,
        alert_id=UUID(alert_row.alert_id) if alert_row else None,
    )
    await live.broadcast({"type": "prediction", "data": response.model_dump(mode="json")})
    return response
