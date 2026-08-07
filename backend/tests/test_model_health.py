from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from app.database.models import Base, Observation, Prediction
from app.database.session import create_engine_and_session
from app.monitoring.service import ModelHealthService


class ApprovedRegistry:
    bundle_dir = None
    manifest = None
    predictor = SimpleNamespace(version="cascade-v1")
    detector = SimpleNamespace(version="detector-v1")
    classifier = SimpleNamespace(version="classifier-v1")
    descriptor = SimpleNamespace(schema_version="nfstream-iot-v1")

    def resolve_route(self, schema_version, fingerprint):
        assert schema_version == "nfstream-iot-v1"
        assert fingerprint == "a" * 64
        return SimpleNamespace(
            compatibility_evidence={"status": "approved"},
            detector=self.detector,
            classifier=self.classifier,
            bundle_dir=self.bundle_dir,
            manifest=self.manifest,
        )



def reference() -> dict:
    return {
        "reference_schema_version": "drift-reference-v1",
        "schema_version": "nfstream-iot-v1",
        "artifact_sha256": "b" * 64,
        "numeric_features": {
            "value": {
                "min": 0,
                "max": 9,
                "quantiles": {"0.5": 4.5, "0.95": 8.55},
                "histogram_edges": [0, 3, 6, 9],
                "histogram_counts": [3, 3, 4],
                "comparison_sample": list(range(10)),
                "js_threshold": 0.1,
            }
        },
        "categorical_features": {
            "kind": {
                "vocabulary": ["known"],
                "counts": {"known": 10, "__OTHER__": 0},
                "js_threshold": 0.1,
            }
        },
        "outputs": {},
    }


def seed_shifted(session_factory) -> None:
    now = datetime.now(UTC)
    with session_factory() as session:
        for index in range(10):
            event_id = f"00000000-0000-0000-0000-{index:012d}"
            session.add(
                Observation(
                    event_id=event_id,
                    schema_version="nfstream-iot-v1",
                    flow_started_at=now,
                    flow_ended_at=now,
                    source="caller-controlled-value",
                    ingestion_channel="live_capture",
                    extractor_fingerprint="a" * 64,
                    raw_features={"value": 100 + index, "kind": "unseen"},
                )
            )
            session.add(
                Prediction(
                    event_id=event_id,
                    model_version="cascade-v1",
                    detector_model_version="detector-v1",
                    classifier_model_version="classifier-v1",
                    binary_prediction="attack",
                    attack_class="scan",
                    confidence=0.9,
                    detection_score=0.9,
                    attack_class_score=0.8,
                    latency_ms=1,
                    detector_latency_ms=0.5,
                    classifier_latency_ms=0.5,
                    end_to_end_latency_ms=2,
                    top_features=[],
                )
            )
        session.commit()


def test_persistent_alarm_becomes_critical_and_non_shadow_degrades(tmp_path) -> None:
    engine, sessions = create_engine_and_session(f"sqlite:///{tmp_path / 'health.db'}")
    Base.metadata.create_all(engine)
    seed_shifted(sessions)
    service = ModelHealthService(
        sessions,
        ApprovedRegistry(),
        shadow_mode=False,
        fast_minimum=10,
        slow_minimum=10,
    )
    service._reference = lambda _route: (reference(), None)  # type: ignore[method-assign]
    cohort = {
        "model_version": "cascade-v1",
        "detector_model_version": "detector-v1",
        "classifier_model_version": "classifier-v1",
        "schema_version": "nfstream-iot-v1",
        "ingestion_channel": "live_capture",
        "extractor_fingerprint": "a" * 64,
        "deployment_eligible": True,
    }
    checked = datetime.now(UTC)
    assert service.evaluate("fast", cohort=cohort, checked_at=checked).status == "warning"
    assert (
        service.evaluate("fast", cohort=cohort, checked_at=checked + timedelta(seconds=1)).status
        == "warning"
    )
    critical = service.evaluate(
        "fast", cohort=cohort, checked_at=checked + timedelta(seconds=2)
    )
    assert critical.status == "critical"
    assert critical.features[0]["score"] is not None
    assert service.component()["degrades_readiness"] is True
    engine.dispose()


def test_non_live_cohort_is_visible_but_never_deployment_eligible(tmp_path) -> None:
    engine, sessions = create_engine_and_session(f"sqlite:///{tmp_path / 'cohort.db'}")
    Base.metadata.create_all(engine)
    service = ModelHealthService(sessions, ApprovedRegistry(), fast_minimum=1)
    service._reference = lambda _route: (reference(), None)  # type: ignore[method-assign]
    cohort = {
        "model_version": "cascade-v1",
        "detector_model_version": "detector-v1",
        "classifier_model_version": "classifier-v1",
        "schema_version": "nfstream-iot-v1",
        "ingestion_channel": "offline_pcap",
        "extractor_fingerprint": "a" * 64,
        "deployment_eligible": True,
    }
    result = service.evaluate("fast", cohort=cohort)
    assert result.status == "collecting"
    assert result.cohort["deployment_eligible"] is False
    assert service.latest(source="offline_pcap") is not None
    assert service.latest() is None
    engine.dispose()


@pytest.mark.anyio
async def test_api_exposes_snapshot_history_and_health_component(client) -> None:
    snapshot = await client.get("/model-health")
    assert snapshot.status_code == 200
    assert snapshot.json()["status"] in {
        "blocked",
        "incompatible_source",
        "collecting",
        "healthy",
        "warning",
        "critical",
    }
    history = await client.get("/model-health/history")
    assert history.status_code == 200
    health = (await client.get("/health")).json()
    assert "model_health" in health["components"]
