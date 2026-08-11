import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  checkHealth,
  getAlerts,
  getAlert,
  getAlertExplanation,
  getEvaluation,
  getIngestionStatus,
  getIngestionJobs,
  getOutboxEvents,
  getModelHealth,
  getModelHealthHistory,
  getModels,
  enqueueObservations,
  liveEventFromSocketMessage,
  startCustomReplay,
  startReplay,
  submitAlertFeedback,
  setApiAccessToken,
} from "../api";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("frontend API adapter", () => {
  afterEach(() => {
    setApiAccessToken(null);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

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

  it("aborts stalled requests instead of leaving the interface waiting forever", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })
    )));

    const pending = getAlerts();
    const rejection = expect(pending).rejects.toMatchObject({
      status: 0,
      message: "Request timed out. Check the service connection and try again.",
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
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

    await getIngestionJobs({ state: "retrying", source: "sensor-a", created_from: "2026-08-07T09:00:00.000Z", created_to: "2026-08-07T11:00:00.000Z", limit: 20 });
    await getOutboxEvents({ status: "failed", event_type: "alert.created", limit: 20 });
    await getModelHealth({ window: "fast", source: "sensor-a", extractor_fingerprint: "extractor-1" });
    await getModelHealthHistory({ window: "fast", source: "sensor-a", limit: 50 });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/v1/ingestion/jobs?state=retrying&source=sensor-a&created_from=2026-08-07T09%3A00%3A00.000Z&created_to=2026-08-07T11%3A00%3A00.000Z&limit=20",
      "/api/v1/ingestion/outbox/events?status=failed&event_type=alert.created&limit=20",
      "/api/v1/model-health?window=fast&source=sensor-a&extractor_fingerprint=extractor-1",
      "/api/v1/model-health/history?window=fast&source=sensor-a&limit=50",
    ]);
  });

  it("submits validated rows to durable ingestion and custom replay contracts", async () => {
    const ingestion = { batch_id: "batch-1", events: [{ event_id: "event-1", state: "queued", disposition: "accepted" }] };
    const replay = { status: "running", processed: 0, total: 1, error: null, speed: 1, scenario: "custom-upload", mode: "custom", offset: 0, limit: null };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(ingestion))
      .mockResolvedValueOnce(jsonResponse(replay));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "event-1" });
    const rows = [{ flow_duration: 1.5, source: "lab" }];

    await expect(enqueueObservations(rows)).resolves.toEqual(ingestion);
    await expect(startCustomReplay(rows)).resolves.toEqual(replay);

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/v1/ingestion/events",
      "/api/v1/replay/start",
    ]);
    const ingestionBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const replayBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(ingestionBody.observations[0]).toMatchObject({
      event_id: "event-1", schema_version: "rt-iot2022-v1", source: "lab",
    });
    expect(replayBody).toMatchObject({
      mode: "custom", scenario: "custom-upload", speed: 1,
    });
    expect(replayBody.observations).toHaveLength(1);
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

  it("preserves the authoritative analyst disposition history on alert detail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      alert_id: "alert-history",
      event_id: "event-history",
      severity: "high",
      reasons: ["detector threshold exceeded"],
      top_features: [],
      status: "investigating",
      created_at: "2026-08-10T20:00:00Z",
      attack_class: "Port Scan",
      detection_score: 0.92,
      raw_features: {},
      feedback: [{
        feedback_id: "feedback-1",
        alert_id: "alert-history",
        analyst: "admin",
        status: "investigating",
        notes: "Correlated with maintenance window.",
        created_at: "2026-08-10T20:05:00Z",
      }],
    })));

    const detail = await getAlert("alert-history");
    expect(detail.feedback).toEqual([expect.objectContaining({
      analyst: "admin",
      status: "investigating",
      notes: "Correlated with maintenance window.",
    })]);
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
        interface: "sensor-edge-1",
        capture_id: "capture-42",
        extractor_fingerprint: "nfstream-sha256:abc",
      },
    }])));

    const [alert] = await getAlerts();
    expect(alert).toMatchObject({
      source_ip: "10.0.0.15",
      destination_ip: "10.0.0.20",
      protocol: "mqtt",
      identity_quality: "explicit",
      event_id: "event-context",
      network_context: expect.objectContaining({
        interface: "sensor-edge-1",
        capture_id: "capture-42",
        extractor_fingerprint: "nfstream-sha256:abc",
      }),
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
        detection_score_calibrated: true,
        attack_class_score: null,
        attack_class_score_calibrated: null,
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
        detection_score_calibrated: true,
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

    await startReplay({ scenario: "attack", speed: 4, offset: 25, limit: 40 });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/replay/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          mode: "dataset",
          scenario: "attack",
          offset: 25,
          limit: 40,
          interval_ms: 250,
          speed: 4,
        }),
      }),
    );
  });

  it("adds the operator bearer token to mutation requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "stopped" }));
    vi.stubGlobal("fetch", fetchMock);
    setApiAccessToken("signed-token");
    await startReplay({ scenario: "normal", speed: 1, offset: 0, limit: 2 });
    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer signed-token");
  });

  it("does not attach tokens or entity headers to public read requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    setApiAccessToken("signed-token");

    await getAlerts();

    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("Content-Type")).toBeNull();
    expect(headers.get("Accept")).toBe("application/json");
  });

  it("normalizes task-specific evaluation evidence without mixing stages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      stage: "binary",
      probability_calibrated: true,
      evaluation_seeds: [42, 1337, 2026],
      split_definition: { strategy: "shared repeated stratified random" },
      selected_champion: { model_name: "hist_gradient_boosting" },
      candidates: [{
        model_name: "hist_gradient_boosting",
        selected: true,
        validation_metrics: { macro_f1: 0.97 },
        operational: { median_inference_latency_ms: 3.1, p95_inference_latency_ms: 4.5 },
        test_metrics: { macro_f1: 0.98, weighted_f1: 0.99, false_positive_rate: 0.01 },
        confusion_matrix: [[80, 1], [2, 90]],
        classes: ["normal", "attack"],
        class_support: { normal: 81, attack: 92 },
      }],
      measurement_notes: ["Random split is not deployment validation."],
    })));

    const report = await getEvaluation("binary");
    expect(report.selected_champion).toBe("hist_gradient_boosting");
    expect(report.probability_calibrated).toBe(true);
    expect(report.evaluation_seeds).toEqual([42, 1337, 2026]);
    expect(report.split_definition).toEqual({ strategy: "shared repeated stratified random" });
    expect(report.candidates[0]).toMatchObject({
      name: "hist_gradient_boosting",
      selected: true,
      macro_f1: 0.98,
      support: { normal: 81, attack: 92 },
      validation_metrics: { macro_f1: 0.97 },
      operational_metrics: { median_inference_latency_ms: 3.1, p95_inference_latency_ms: 4.5 },
    });
  });

  it("preserves serving schema and artifact registration without inventing missing metrics", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([{
      model_version: "binary-model-4", model_type: "hist_gradient_boosting",
      artifact_path: "/runtime/models/binary.joblib", schema_version: "rt-iot2022-v1", active: true,
      metadata_json: { target: "binary", probability_calibrated: true },
    }])));

    await expect(getModels()).resolves.toEqual([expect.objectContaining({
      version: "binary-model-4", role: "detector", schema_version: "rt-iot2022-v1",
      artifact_registered: true, probability_calibrated: true, macro_f1: undefined,
    })]);
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
      status: "investigating",
      notes: "Reviewing route.",
    })).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/alerts/alert%2Fone/feedback",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          status: "investigating",
          notes: "Reviewing route.",
        }),
      }),
    );
  });

  it("surfaces FastAPI validation details in a typed API error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      detail: [
        { loc: ["body", "status"], msg: "Input should be valid", type: "literal_error" },
      ],
    }, { status: 422 })));

    const failure = submitAlertFeedback("alert-1", {
      status: "new",
    });
    await expect(failure).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
      message: "Input should be valid",
    } satisfies Partial<ApiError>);
  });

  it("preserves Retry-After guidance on throttled requests", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      detail: "Too many failed login attempts",
    }, { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "120" } })));

    const failure = import("../api").then(({ login }) => login("admin", "incorrect"));
    await expect(failure).rejects.toMatchObject({
      name: "ApiError",
      status: 429,
      message: "Too many failed login attempts",
      retryAfterSeconds: 120,
    } satisfies Partial<ApiError>);
  });
});
