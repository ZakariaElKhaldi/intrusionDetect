from __future__ import annotations

from dataclasses import dataclass
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


@dataclass(frozen=True, slots=True)
class StagedObservation:
    response: PredictionResponse
    events: tuple[dict, ...]


def stage_observation(
    observation: FlowObservation,
    session: Session,
    registry: ModelRegistry,
) -> StagedObservation:
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
        detector_model_version=inference.detector_model_version,
        classifier_model_version=inference.classifier_model_version,
        binary_prediction=inference.binary_prediction,
        attack_class=inference.attack_class,
        confidence=inference.confidence,
        detection_score=inference.detection_score,
        attack_class_score=inference.attack_class_score,
        latency_ms=inference.latency_ms,
        detector_latency_ms=inference.detector_latency_ms,
        classifier_latency_ms=inference.classifier_latency_ms,
        end_to_end_latency_ms=0,
        top_features=inference.top_features,
    )
    session.add(prediction_row)
    session.flush()

    alert_row = None
    behavior_reasons = evaluate_device_profile(observation.features)
    if inference.binary_prediction == "attack":
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

    end_to_end = (perf_counter() - started) * 1000
    prediction_row.end_to_end_latency_ms = end_to_end
    response = PredictionResponse(
        prediction_id=UUID(prediction_row.prediction_id),
        event_id=observation.event_id,
        model_version=inference.model_version,
        detector_model_version=inference.detector_model_version,
        classifier_model_version=inference.classifier_model_version,
        binary_prediction=inference.binary_prediction,
        attack_class=inference.attack_class,
        confidence=inference.confidence,
        detection_score=inference.detection_score,
        attack_class_score=inference.attack_class_score,
        latency_ms=inference.latency_ms,
        detector_latency_ms=inference.detector_latency_ms,
        classifier_latency_ms=inference.classifier_latency_ms,
        raw_features=observation.features,
        top_features=inference.top_features,
        end_to_end_latency_ms=end_to_end,
        total_latency_ms=end_to_end,
        alert_id=UUID(alert_row.alert_id) if alert_row else None,
    )
    events: list[dict] = [
        {"type": "prediction.created", "data": response.model_dump(mode="json")}
    ]
    if alert_row:
        events.append(
            {
                "type": "alert.created",
                "data": {
                    "alert_id": alert_row.alert_id,
                    "event_id": event_id,
                    "severity": alert_row.severity,
                    "reasons": alert_row.reasons,
                    "top_features": alert_row.top_features,
                    "status": alert_row.status,
                    "created_at": alert_row.created_at.isoformat(),
                    "model_version": inference.model_version,
                    "detector_model_version": inference.detector_model_version,
                    "classifier_model_version": inference.classifier_model_version,
                    "binary_prediction": inference.binary_prediction,
                    "attack_class": inference.attack_class,
                    "confidence": inference.confidence,
                    "detection_score": inference.detection_score,
                    "attack_class_score": inference.attack_class_score,
                    "detector_latency_ms": inference.detector_latency_ms,
                    "classifier_latency_ms": inference.classifier_latency_ms,
                    "total_latency_ms": end_to_end,
                    "raw_features": observation.features,
                },
            }
        )
    return StagedObservation(response=response, events=tuple(events))


async def broadcast_staged(
    staged: StagedObservation, live: LiveConnectionManager
) -> None:
    for event in staged.events:
        await live.broadcast(event)


async def process_observation(
    observation: FlowObservation,
    session: Session,
    registry: ModelRegistry,
    live: LiveConnectionManager,
) -> PredictionResponse:
    staged = stage_observation(observation, session, registry)
    session.commit()
    await broadcast_staged(staged, live)
    return staged.response
