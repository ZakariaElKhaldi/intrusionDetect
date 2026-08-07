import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  checkHealth,
  getAlerts,
  getAlertExplanation,
  getEvaluation,
  getIngestionStatus,
  getIngestionJobs,
  getOutboxEvents,
  getModelHealth,
  getModelHealthHistory,
  liveEventFromSocketMessage,
  startReplay,
  submitAlertFeedback,
} from "../api";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("frontend API adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns structured health information and null while offline", async () => {
    const health = {
      status: "ok",
      schema_version: "rt-iot2022-v1",
      model_version: "binary-rf-v1",
      live_connections: 2,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(health))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkHealth()).resolves.toEqual(health);
    await expect(checkHealth()).resolves.toBeNull();
  });

  it("loads independently reported ingestion and worker status", async () => {
    const status = {
      queue_depth: 3, queued: 2, processing: 1, retrying: 0, succeeded: 48,
      dead_letter: 0, retries: 2, failures: 0, oldest_pending_age_seconds: 4.2,
      throughput_per_minute: 24,
      worker: { status: "ready", reason: "Worker heartbeat is current.", last_heartbeat_at: "2026-08-07T10:00:00Z" },
      outbox: { status: "ready", reason: "Outbox is draining.", pending: 1, published: 47, oldest_pending_age_seconds: 1 },
      generated_at: "2026-08-07T10:00:01Z",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(status)));

    await expect(getIngestionStatus()).resolves.toEqual(status);
    expect(fetch).toHaveBeenCalledWith("/api/v1/ingestion/status", expect.any(Object));
  });

  it("rejects malformed ingestion status instead of displaying invented zeroes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ queue_depth: 0 })));
    await expect(getIngestionStatus()).rejects.toMatchObject({
      status: 502,
      message: "Ingestion status response is invalid.",
    });
  });

  it("uses the read-only operations and model-health filter contracts", async () => {
    const jobs = { items: [], total: 0, limit: 20, next_cursor: null };
    const outbox = { items: [], total: 0, limit: 20, next_cursor: null };
    const health = { status: "collecting", reason: "More observations required.", features: [] };
    const history = { items: [] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(jobs))
      .mockResolvedValueOnce(jsonResponse(outbox))
      .mockResolvedValueOnce(jsonResponse(health))
      .mockResolvedValueOnce(jsonResponse(history));
    vi.stubGlobal("fetch", fetchMock);

    await getIngestionJobs({ state: "retrying", source: "sensor-a", limit: 20 });
    await getOutboxEvents({ status: "failed", limit: 20 });
    await getModelHealth({ window: "fast", source: "sensor-a", extractor_fingerprint: "extractor-1" });
    await getModelHealthHistory({ window: "fast", source: "sensor-a", limit: 50 });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/v1/ingestion/jobs?state=retrying&source=sensor-a&limit=20",
      "/api/v1/ingestion/outbox/events?status=failed&limit=20",
      "/api/v1/model-health?window=fast&source=sensor-a&extractor_fingerprint=extractor-1",
      "/api/v1/model-health/history?window=fast&source=sensor-a&limit=50",
    ]);
  });

  it("maps raw top feature values without calling them contributions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([{
      alert_id: "alert-1",
      event_id: "event-1",
      severity: "high",
      reasons: ["confidence threshold exceeded"],
      top_features: [{ feature: "flow_duration", value: 14.5 }],
      status: "false_positive",
      created_at: "2026-07-23T10:00:00Z",
      model_version: "binary-rf-v1",
      attack_class: "DDoS",
      confidence: 0.91,
      raw_features: { "id.orig_p": 443, "id.resp_p": 8080, proto: "tcp" },
    }])));

    const [alert] = await getAlerts();
    expect(alert).toMatchObject({
      model_version: "binary-rf-v1",
      reasons: ["confidence threshold exceeded"],
      status: "false_positive",
      evidence_type: "highlighted_value",
      identity_quality: "port_only",
    });
    expect(alert.explanations?.[0]).toEqual({
      feature: "flow_duration",
      impact: 14.5,
      value: 14.5,
      evidence_type: "highlighted_value",
    });
  });

  it("recognizes explicit signed model contributions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([{
      alert_id: "alert-2",
      event_id: "event-2",
      severity: "critical",
      reasons: [],
      top_features: [{ name: "rate", impact: -0.42 }],
      status: "new",
      created_at: "2026-07-23T10:00:00Z",
      model_version: "explainable-v2",
      confidence: 0.98,
      raw_features: { source_ip: "10.0.0.1", destination_ip: "10.0.0.2" },
      model_metadata: { explanation_type: "shap" },
    }])));

    const [alert] = await getAlerts();
    expect(alert.evidence_type).toBe("model_contribution");
    expect(alert.identity_quality).toBe("explicit");
    expect(alert.explanations?.[0]).toMatchObject({
      impact: -0.42,
      evidence_type: "model_contribution",
    });
  });

  it("uses non-model network context for alert route identity", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([{
      alert_id: "alert-context",
      event_id: "event-context",
      severity: "high",
      reasons: [],
      top_features: [],
      status: "new",
      created_at: "2026-08-07T10:00:00Z",
      confidence: 0.94,
      raw_features: { "id.orig_p": 41000, "id.resp_p": 1883, proto: "tcp" },
      network_context: {
        source_ip: "10.0.0.15",
        destination_ip: "10.0.0.20",
        source_port: 41000,
        destination_port: 1883,
        protocol: "mqtt",
      },
    }])));

    const [alert] = await getAlerts();
    expect(alert).toMatchObject({
      source_ip: "10.0.0.15",
      destination_ip: "10.0.0.20",
      protocol: "mqtt",
      identity_quality: "explicit",
    });
  });

  it("parses prediction JSON as telemetry without manufacturing an alert", () => {
    const event = liveEventFromSocketMessage(JSON.stringify({
      type: "prediction.created",
      data: {
        prediction_id: "prediction-1",
        event_id: "event-1",
        model_version: "legacy-v1",
        detector_model_version: "detector-v2",
        classifier_model_version: null,
        binary_prediction: "normal",
        attack_class: null,
        confidence: 0.04,
        detection_score: 0.04,
        attack_class_score: null,
        detector_latency_ms: 1.2,
        classifier_latency_ms: null,
        alert_id: null,
      },
    }));

    expect(event).toEqual({
      type: "prediction.created",
      data: expect.objectContaining({
        prediction_id: "prediction-1",
        detector_model_version: "detector-v2",
        detection_score: 0.04,
        alert_id: null,
      }),
    });
  });

  it("uses the authoritative alert event severity and cascade metadata", () => {
    const event = liveEventFromSocketMessage(JSON.stringify({
      type: "alert.created",
      data: {
        alert_id: "alert-3",
        event_id: "event-3",
        severity: "low",
        reasons: ["device profile deviation"],
        top_features: [],
        status: "new",
        created_at: "2026-08-03T10:00:00Z",
        model_version: "detector-v2",
        detector_model_version: "detector-v2",
        classifier_model_version: "classifier-v4",
        binary_prediction: "attack",
        attack_class: "DDoS-UDP",
        confidence: 0.88,
        detection_score: 0.88,
        attack_class_score: 0.73,
        raw_features: { source_ip: "10.0.0.1", destination_ip: "10.0.0.2" },
      },
    }));

    expect(event).toEqual({
      type: "alert.created",
      data: expect.objectContaining({
        id: "alert-3",
        severity: "low",
        detector_model_version: "detector-v2",
        classifier_model_version: "classifier-v4",
        detection_score: 0.88,
        attack_class_score: 0.73,
      }),
    });
  });

  it("ignores malformed and unknown socket messages", () => {
    expect(liveEventFromSocketMessage("not-json")).toBeNull();
    expect(liveEventFromSocketMessage(JSON.stringify({ type: "heartbeat", data: {} }))).toBeNull();
    expect(liveEventFromSocketMessage(JSON.stringify({
      type: "prediction.created",
      data: { event_id: "missing-prediction-id" },
    }))).toBeNull();
  });

  it("starts bounded server-side replay from the real prepared dataset", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "running" }));
    vi.stubGlobal("fetch", fetchMock);

    await startReplay({ scenario: "attack", speed: 4, limit: 40 });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/replay/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          mode: "dataset",
          scenario: "attack",
          offset: 0,
          limit: 40,
          interval_ms: 250,
          speed: 4,
        }),
      }),
    );
  });

  it("normalizes task-specific evaluation evidence without mixing stages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      stage: "binary",
      selected_champion: { model_name: "hist_gradient_boosting" },
      candidates: [{
        model_name: "hist_gradient_boosting",
        selected: true,
        test_metrics: { macro_f1: 0.98, weighted_f1: 0.99, false_positive_rate: 0.01 },
        confusion_matrix: [[80, 1], [2, 90]],
        classes: ["normal", "attack"],
        class_support: { normal: 81, attack: 92 },
      }],
      measurement_notes: ["Random split is not deployment validation."],
    })));

    const report = await getEvaluation("binary");
    expect(report.selected_champion).toBe("hist_gradient_boosting");
    expect(report.candidates[0]).toMatchObject({
      name: "hist_gradient_boosting",
      selected: true,
      macro_f1: 0.98,
      support: { normal: 81, attack: 92 },
    });
  });

  it("preserves transformed and raw feature names in signed explanations", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      alert_id: "alert-1",
      explanations: [{
        stage: "binary",
        model_version: "detector-v2",
        explained_class: "attack",
        base_value: -1.2,
        output_value: 0.8,
        method: "SHAP TreeExplainer",
        contributions: [{
          feature: "proto",
          transformed_feature: "categorical__proto_tcp",
          raw_value: "tcp",
          impact: 0.42,
        }],
      }],
    })));

    await expect(getAlertExplanation("alert-1")).resolves.toEqual([
      expect.objectContaining({
        stage: "binary",
        explained_class: "attack",
        contributions: [{
          feature: "categorical__proto_tcp",
          raw_feature: "proto",
          raw_value: "tcp",
          impact: 0.42,
        }],
      }),
    ]);
  });

  it("posts analyst feedback with the backend wire contract", async () => {
    const response = {
      feedback_id: "feedback-1",
      alert_id: "alert/one",
      analyst: "soc-analyst",
      status: "investigating",
      notes: "Reviewing route.",
      created_at: "2026-07-23T10:01:00Z",
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(response, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitAlertFeedback("alert/one", {
      analyst: "soc-analyst",
      status: "investigating",
      notes: "Reviewing route.",
    })).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/alerts/alert%2Fone/feedback",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          analyst: "soc-analyst",
          status: "investigating",
          notes: "Reviewing route.",
        }),
      }),
    );
  });

  it("surfaces FastAPI validation details in a typed API error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      detail: [
        { loc: ["body", "analyst"], msg: "Field required", type: "missing" },
        { loc: ["body", "status"], msg: "Input should be valid", type: "literal_error" },
      ],
    }, { status: 422 })));

    const failure = submitAlertFeedback("alert-1", {
      analyst: "",
      status: "new",
    });
    await expect(failure).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
      message: "Field required; Input should be valid",
    } satisfies Partial<ApiError>);
  });
});
