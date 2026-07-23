import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  checkHealth,
  getAlerts,
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
