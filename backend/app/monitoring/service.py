from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from threading import Lock
from typing import Any, Literal

import numpy as np
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, sessionmaker

from app.database.models import (
    Alert,
    AnalystFeedback,
    DriftSnapshot,
    Observation,
    Prediction,
    ValidationFailure,
)
from app.detection.drift import evaluate_feature_window, evaluate_output_window
from app.inference.model_registry import ModelRegistry, ModelRoute
from app.monitoring.reference import DriftReferenceError, load_drift_reference
from app.monitoring.schemas import (
    ModelHealthHistoryPoint,
    ModelHealthHistoryResponse,
    ModelHealthSnapshotResponse,
)

WindowName = Literal["fast", "slow"]


@dataclass(frozen=True, slots=True)
class WindowPolicy:
    duration: timedelta
    maximum: int
    minimum: int


WINDOWS: dict[WindowName, WindowPolicy] = {
    "fast": WindowPolicy(timedelta(hours=24), 5_000, 1_000),
    "slow": WindowPolicy(timedelta(days=7), 20_000, 5_000),
}
DEPLOYMENT_CHANNEL = "live_capture"
NORMAL_LABELS = {"normal", "normal_traffic", "benign"}


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _cohort_key(cohort: dict[str, Any]) -> str:
    return json.dumps(cohort, sort_keys=True, separators=(",", ":"))


def _snapshot_response(row: DriftSnapshot) -> ModelHealthSnapshotResponse:
    evidence = row.evidence or {}
    aggregate = {
        "score": row.aggregate_score,
        "threshold": row.aggregate_threshold,
        **evidence.get("aggregate", {}),
    }
    return ModelHealthSnapshotResponse(
        status=row.status,
        reason=row.reason,
        window=row.window,
        cohort=row.cohort,
        reference=row.reference,
        observation_count=row.observation_count,
        aggregate=aggregate,
        features=evidence.get("features", []),
        unseen_categories=evidence.get("unseen_categories", []),
        outputs=evidence.get("outputs", {}),
        quality=evidence.get("quality", {}),
        performance=evidence.get("performance", {}),
        checked_at=row.checked_at,
        shadow_mode=row.shadow_mode,
    )


class ModelHealthService:
    """Persist bounded, cohort-isolated drift evidence without changing inference."""

    def __init__(
        self,
        session_factory: sessionmaker[Session],
        registry: ModelRegistry,
        *,
        shadow_mode: bool = True,
        fast_minimum: int = 1_000,
        slow_minimum: int = 5_000,
        retention_days: int = 90,
    ) -> None:
        self.session_factory = session_factory
        self.registry = registry
        self.shadow_mode = shadow_mode
        self.retention_days = retention_days
        self._evaluation_lock = Lock()
        self.windows = {
            "fast": WindowPolicy(timedelta(hours=24), 5_000, fast_minimum),
            "slow": WindowPolicy(timedelta(days=7), 20_000, slow_minimum),
        }

    def deployment_cohort(self) -> dict[str, Any]:
        return {
            "model_version": self.registry.predictor.version,
            "detector_model_version": self.registry.detector.version,
            "classifier_model_version": self.registry.classifier.version,
            "schema_version": self.registry.descriptor.schema_version,
            "ingestion_channel": DEPLOYMENT_CHANNEL,
            "extractor_fingerprint": None,
            "deployment_eligible": True,
        }

    def _reference(
        self, route: ModelRoute
    ) -> tuple[dict[str, Any] | None, str | None]:
        try:
            detector = getattr(route, "detector", None)
            classifier = getattr(route, "classifier", None)
            return (
                load_drift_reference(
                    getattr(route, "bundle_dir", None),
                    getattr(route, "manifest", None),
                    detector_model_version=getattr(detector, "version", None),
                    classifier_model_version=getattr(classifier, "version", None),
                ),
                None,
            )
        except DriftReferenceError as exc:
            return None, str(exc)

    def _rows(
        self, session: Session, cohort: dict[str, Any], policy: WindowPolicy, checked_at: datetime
    ) -> list[tuple[Observation, Prediction]]:
        query = (
            select(Observation, Prediction)
            .join(Prediction, Prediction.event_id == Observation.event_id)
            .where(
                Observation.created_at >= checked_at - policy.duration,
                Observation.schema_version == cohort["schema_version"],
                Observation.ingestion_channel == cohort["ingestion_channel"],
                Prediction.detector_model_version == cohort["detector_model_version"],
                Prediction.classifier_model_version == cohort["classifier_model_version"],
            )
            .order_by(Observation.created_at.desc(), Observation.event_id.desc())
            .limit(policy.maximum)
        )
        fingerprint = cohort.get("extractor_fingerprint")
        query = query.where(
            Observation.extractor_fingerprint == fingerprint
            if fingerprint is not None
            else Observation.extractor_fingerprint.is_(None)
        )
        return list(session.execute(query).tuples())

    def evaluate(
        self,
        window: WindowName,
        *,
        cohort: dict[str, Any] | None = None,
        checked_at: datetime | None = None,
    ) -> ModelHealthSnapshotResponse:
        # Evaluation persists chronology-sensitive state. Serialize it even
        # though callers execute in Starlette's shared worker pool.
        with self._evaluation_lock:
            return self._evaluate_unlocked(
                window,
                cohort=cohort,
                checked_at=checked_at,
            )

    def _evaluate_unlocked(
        self,
        window: WindowName,
        *,
        cohort: dict[str, Any] | None = None,
        checked_at: datetime | None = None,
    ) -> ModelHealthSnapshotResponse:
        policy = self.windows[window]
        checked_at = checked_at or datetime.now(UTC)
        cohort = dict(cohort or self.deployment_cohort())
        cohort.setdefault(
            "deployment_eligible",
            cohort.get("ingestion_channel") == DEPLOYMENT_CHANNEL,
        )
        route: ModelRoute | None = None
        try:
            route = self.registry.resolve_route(
                str(cohort["schema_version"]), cohort.get("extractor_fingerprint")
            )
            extractor_approved = route.compatibility_evidence is not None
        except ValueError:
            extractor_approved = False
        deployment_eligible = bool(
            cohort["deployment_eligible"]
            and cohort.get("ingestion_channel") == DEPLOYMENT_CHANNEL
            and extractor_approved
        )
        cohort["deployment_eligible"] = deployment_eligible
        if route is None:
            reference, reference_error = (
                None,
                "cohort has no checksum-verified model route",
            )
        else:
            reference, reference_error = self._reference(route)
        detector_obj = getattr(route, "detector", None) if route else None
        classifier_obj = getattr(route, "classifier", None) if route else None
        reference_identity = {
            "schema_version": "drift-reference-v1",
            "checksum": reference.get("artifact_sha256") if reference else None,
            "detector_model_version": (
                getattr(detector_obj, "version", None)
                if detector_obj
                else cohort.get("detector_model_version")
            ),
            "classifier_model_version": (
                getattr(classifier_obj, "version", None)
                if classifier_obj
                else cohort.get("classifier_model_version")
            ),
        }
        with self.session_factory() as session:
            previous = session.scalar(
                select(DriftSnapshot)
                .where(
                    DriftSnapshot.cohort_key == _cohort_key(cohort),
                    DriftSnapshot.window == window,
                )
                .order_by(DriftSnapshot.checked_at.desc())
                .limit(1)
            )
            observations = self._rows(session, cohort, policy, checked_at)
            evidence: dict[str, Any] = {
                "features": [],
                "unseen_categories": [],
                "outputs": {},
                "quality": {},
                "performance": {},
            }
            failure_query = select(ValidationFailure).where(
                ValidationFailure.occurred_at >= checked_at - policy.duration,
                ValidationFailure.ingestion_channel == cohort["ingestion_channel"],
            )
            if cohort.get("schema_version"):
                failure_query = failure_query.where(
                    or_(
                        ValidationFailure.schema_version.is_(None),
                        ValidationFailure.schema_version == str(cohort["schema_version"]),
                    )
                )
            failures = list(session.scalars(failure_query))
            error_counts: dict[str, int] = {}
            for failure in failures:
                error_counts[failure.error_code] = (
                    error_counts.get(failure.error_code, 0) + 1
                )
            evidence["quality"] = {
                "schema_rejections": len(failures),
                "validation_error_codes": error_counts,
            }
            latencies = [prediction.end_to_end_latency_ms for _, prediction in observations]
            labelled = [
                (observation, prediction)
                for observation, prediction in observations
                if observation.ground_truth is not None
            ]
            ground_truth_performance: dict[str, Any] = {}
            if labelled:
                binary_truth = [
                    "normal"
                    if str(observation.ground_truth).casefold() in NORMAL_LABELS
                    else "attack"
                    for observation, _prediction in labelled
                ]
                binary_predictions = [
                    prediction.binary_prediction for _observation, prediction in labelled
                ]
                attacks = sum(value == "attack" for value in binary_truth)
                normals = len(binary_truth) - attacks
                true_attacks = sum(
                    truth == "attack" and predicted == "attack"
                    for truth, predicted in zip(
                        binary_truth, binary_predictions, strict=True
                    )
                )
                false_attacks = sum(
                    truth == "normal" and predicted == "attack"
                    for truth, predicted in zip(
                        binary_truth, binary_predictions, strict=True
                    )
                )
                cascade_truth = [
                    "normal"
                    if truth == "normal"
                    else str(observation.ground_truth)
                    for (observation, _prediction), truth in zip(
                        labelled, binary_truth, strict=True
                    )
                ]
                cascade_predictions = [
                    "normal"
                    if prediction.binary_prediction == "normal"
                    else prediction.attack_class or "unclassified_attack"
                    for _observation, prediction in labelled
                ]
                ground_truth_performance = {
                    "labelled_count": len(labelled),
                    "detector_attack_recall": true_attacks / attacks if attacks else None,
                    "detector_normal_false_positive_rate": (
                        false_attacks / normals if normals else None
                    ),
                    "cascade_accuracy": sum(
                        truth == predicted
                        for truth, predicted in zip(
                            cascade_truth, cascade_predictions, strict=True
                        )
                    )
                    / len(cascade_truth),
                }
            event_ids = [observation.event_id for observation, _prediction in observations]
            feedback_rows = []
            if event_ids:
                feedback_rows = list(
                    session.execute(
                        select(AnalystFeedback.status)
                        .join(Alert, Alert.alert_id == AnalystFeedback.alert_id)
                        .where(Alert.event_id.in_(event_ids))
                    ).scalars()
                )
            reviewed = [
                value for value in feedback_rows if value in {"confirmed", "false_positive"}
            ]
            evidence["performance"] = {
                "end_to_end_latency_ms_median": (
                    float(np.median(latencies)) if latencies else None
                ),
                "end_to_end_latency_ms_p95": (
                    float(np.quantile(latencies, 0.95)) if latencies else None
                ),
                "ground_truth": ground_truth_performance,
                "analyst_review": {
                    "reviewed_alert_count": len(reviewed),
                    "confirmed": reviewed.count("confirmed"),
                    "false_positive": reviewed.count("false_positive"),
                    "confirmed_rate": (
                        reviewed.count("confirmed") / len(reviewed) if reviewed else None
                    ),
                    "scope": "reviewed alerts only; not a complete ground-truth sample",
                },
            }
            score = threshold = None
            if route is None:
                status = "incompatible_source"
                reason = reference_error or "cohort has no checksum-verified model route"
            elif reference is None:
                status = "blocked"
                reason = reference_error or (
                    "active model bundle has no checksum-bound drift reference"
                )
                if reference_error:
                    session.add(
                        ValidationFailure(
                            error_code="drift_reference_invalid",
                            ingestion_channel=str(cohort["ingestion_channel"]),
                            schema_version=str(cohort["schema_version"]),
                            extractor_fingerprint=cohort.get("extractor_fingerprint"),
                            details={"reason": reference_error},
                        )
                    )
            elif reference.get("schema_version") != cohort.get("schema_version"):
                status = "incompatible_source"
                reason = "cohort schema is incompatible with the active drift reference"
            elif len(observations) < policy.minimum:
                status = "collecting"
                reason = f"{len(observations)}/{policy.minimum} observations collected"
            else:
                result = evaluate_feature_window(
                    reference, [observation.raw_features for observation, _ in observations]
                )
                status = result["status"]
                score = result.get("aggregate_score")
                threshold = result.get("aggregate_threshold")
                evidence["features"] = result.get("features", [])
                for feature in evidence["features"]:
                    feature.setdefault(
                        "status", "warning" if feature.get("drifted") else "healthy"
                    )
                    feature.setdefault("score", feature.get("js_distance"))
                    feature.setdefault("threshold", feature.get("js_threshold"))
                evidence["unseen_categories"] = [
                    {"feature": item["feature"], **value}
                    for item in evidence["features"]
                    for value in item.get("unseen_values", [])
                ]
                predictions = [prediction for _, prediction in observations]
                attacks = sum(item.binary_prediction == "attack" for item in predictions)
                scores = [item.detection_score for item in predictions]
                output_result = evaluate_output_window(
                    reference.get("outputs", {}),
                    {
                        "detector_labels": [
                            item.binary_prediction for item in predictions
                        ],
                        "detector_scores": scores,
                        "classifier_labels": [
                            item.attack_class for item in predictions if item.attack_class
                        ],
                        "classifier_scores": [
                            item.attack_class_score
                            for item in predictions
                            if item.attack_class_score is not None
                        ],
                    },
                )
                output_result["current"] = {
                    "detector_labels": {
                        "attack": attacks,
                        "normal": len(predictions) - attacks,
                    },
                    "alert_rate": attacks / len(predictions),
                    "routing_rate": attacks / len(predictions),
                    "detection_score_median": float(np.median(scores)),
                    "detection_score_p95": float(np.quantile(scores, 0.95)),
                }
                evidence["outputs"] = output_result
                feature_alarm_count = sum(
                    bool(feature.get("drifted")) for feature in evidence["features"]
                )
                evidence["aggregate"] = {
                    "feature_alarm_count": feature_alarm_count,
                    "output_alarm_count": output_result["alarm_count"],
                    "output_aggregate_score": output_result["aggregate_score"],
                }
                if output_result["status"] == "warning":
                    status = "warning"
                score = max(float(score or 0), float(output_result["aggregate_score"]))
                reason = (
                    "calibrated feature or output alarms indicate changed traffic distribution"
                    if status == "warning"
                    else "no calibrated distribution alarm is active"
                )
                if status == "warning":
                    prior = list(
                        session.scalars(
                            select(DriftSnapshot)
                            .where(
                                DriftSnapshot.cohort_key == _cohort_key(cohort),
                                DriftSnapshot.window == window,
                            )
                            .order_by(DriftSnapshot.checked_at.desc())
                            .limit(2)
                        )
                    )
                    if len(prior) == 2 and all(
                        item.status in {"warning", "critical"} for item in prior
                    ):
                        status = "critical"
                        reason = "calibrated alarms persisted for three consecutive evaluations"

            row = DriftSnapshot(
                status=status,
                reason=reason,
                window=window,
                cohort_key=_cohort_key(cohort),
                cohort=cohort,
                reference=reference_identity,
                observation_count=len(observations),
                aggregate_score=score,
                aggregate_threshold=threshold,
                evidence=evidence,
                deployment_eligible=deployment_eligible,
                shadow_mode=self.shadow_mode,
                checked_at=checked_at,
            )
            session.add(row)
            cutoff = checked_at - timedelta(days=self.retention_days)
            for expired in session.scalars(
                select(DriftSnapshot).where(DriftSnapshot.checked_at < cutoff)
            ):
                session.delete(expired)
            session.commit()
            response = _snapshot_response(row)
            response_changed = previous is None or previous.status != row.status
            response.__dict__["_status_changed"] = response_changed
            return response

    def observed_cohorts(self) -> list[dict[str, Any]]:
        """Return server-identity cohorts; payload ``source`` is intentionally absent."""
        with self.session_factory() as session:
            rows = session.execute(
                select(
                    Prediction.model_version,
                    Prediction.detector_model_version,
                    Prediction.classifier_model_version,
                    Observation.schema_version,
                    Observation.ingestion_channel,
                    Observation.extractor_fingerprint,
                )
                .join(Observation, Observation.event_id == Prediction.event_id)
                .distinct()
            ).all()
        return [
            {
                "model_version": row.model_version,
                "detector_model_version": row.detector_model_version,
                "classifier_model_version": row.classifier_model_version,
                "schema_version": row.schema_version,
                "ingestion_channel": row.ingestion_channel,
                "extractor_fingerprint": row.extractor_fingerprint,
                "deployment_eligible": row.ingestion_channel == DEPLOYMENT_CHANNEL,
            }
            for row in rows
        ]

    def cohorts(self) -> list[dict[str, Any]]:
        observed = self.observed_cohorts()
        deployment = self.deployment_cohort()
        keys: set[str] = set()
        result: list[dict[str, Any]] = []
        for cohort in [deployment, *observed]:
            key = _cohort_key(cohort)
            if key not in keys:
                keys.add(key)
                result.append(cohort)
        return sorted(
            result,
            key=lambda item: (
                not bool(item.get("deployment_eligible")),
                str(item.get("ingestion_channel")),
                str(item.get("schema_version")),
                str(item.get("extractor_fingerprint") or ""),
            ),
        )

    def latest(
        self,
        *,
        window: WindowName = "fast",
        source: str | None = None,
        extractor_fingerprint: str | None = None,
        schema_version: str | None = None,
        model_version: str | None = None,
    ) -> ModelHealthSnapshotResponse | None:
        with self.session_factory() as session:
            rows = list(
                session.scalars(
                select(DriftSnapshot)
                .where(DriftSnapshot.window == window)
                .order_by(DriftSnapshot.checked_at.desc())
                .limit(1_000)
                )
            )
            row = next(
                (
                    item
                    for item in rows
                    if (source is None or item.cohort.get("ingestion_channel") == source)
                    and (
                        schema_version is None
                        or item.cohort.get("schema_version") == schema_version
                    )
                    and (
                        model_version is None
                        or item.cohort.get("model_version") == model_version
                    )
                    and (
                        extractor_fingerprint is None
                        or item.cohort.get("extractor_fingerprint")
                        == extractor_fingerprint
                    )
                    and (
                        source is not None
                        or extractor_fingerprint is not None
                        or schema_version is not None
                        or model_version is not None
                        or item.deployment_eligible
                    )
                ),
                None,
            )
            if row is None and source is None and extractor_fingerprint is None:
                row = next(
                    (
                        item
                        for item in rows
                        if item.cohort.get("ingestion_channel") == DEPLOYMENT_CHANNEL
                    ),
                    None,
                )
            return _snapshot_response(row) if row else None

    def history(
        self,
        *,
        window: WindowName = "fast",
        limit: int = 100,
        source: str | None = None,
        extractor_fingerprint: str | None = None,
        schema_version: str | None = None,
        model_version: str | None = None,
    ) -> ModelHealthHistoryResponse:
        with self.session_factory() as session:
            candidates = list(
                session.scalars(
                    select(DriftSnapshot)
                    .where(DriftSnapshot.window == window)
                    .order_by(DriftSnapshot.checked_at.desc())
                    .limit(5_000)
                )
            )
        rows = [
            item
            for item in candidates
            if (source is None or item.cohort.get("ingestion_channel") == source)
            and (
                schema_version is None
                or item.cohort.get("schema_version") == schema_version
            )
            and (
                model_version is None
                or item.cohort.get("model_version") == model_version
            )
            and (
                extractor_fingerprint is None
                or item.cohort.get("extractor_fingerprint") == extractor_fingerprint
            )
            and (
                source is not None
                or extractor_fingerprint is not None
                or schema_version is not None
                or model_version is not None
                or item.deployment_eligible
            )
        ][:limit]
        return ModelHealthHistoryResponse(
            items=[
                ModelHealthHistoryPoint(
                    checked_at=row.checked_at,
                    status=row.status,
                    observation_count=row.observation_count,
                    aggregate_score=row.aggregate_score,
                    aggregate_threshold=row.aggregate_threshold,
                    feature_alarm_count=int(
                        (row.evidence or {}).get("aggregate", {}).get(
                            "feature_alarm_count", 0
                        )
                    ),
                    output_alarm_count=int(
                        (row.evidence or {}).get("aggregate", {}).get(
                            "output_alarm_count", 0
                        )
                    ),
                    output_aggregate_score=(row.evidence or {}).get(
                        "aggregate", {}
                    ).get("output_aggregate_score"),
                )
                for row in rows
            ],
            limit=limit,
        )

    def component(self) -> dict[str, Any]:
        latest = self.latest()
        if latest is None:
            return {"status": "degraded", "reason": "model health has not been evaluated"}
        degrades = latest.status == "critical" and not latest.shadow_mode
        degrades = degrades and bool(latest.cohort.get("deployment_eligible"))
        return {
            "status": "degraded" if degrades else "ready",
            "reason": latest.reason,
            "monitoring_status": latest.status,
            "shadow_mode": latest.shadow_mode,
            "degrades_readiness": degrades,
            "checked_at": latest.checked_at.isoformat(),
        }
