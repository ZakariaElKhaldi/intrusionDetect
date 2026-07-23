import type {
  Alert,
  AlertStatus,
  AnalystFeedback,
  AnalystFeedbackRequest,
  EvidenceType,
  HealthInfo,
  IdentityQuality,
  ModelInfo,
} from "./types";

const configuredApi = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "");
const API_BASE = configuredApi
  ? configuredApi.endsWith("/api/v1") ? configuredApi : `${configuredApi}/api/v1`
  : "/api/v1";

interface AlertWire {
  alert_id: string;
  event_id: string;
  severity: string;
  reasons: string[];
  top_features: {
    feature?: string;
    name?: string;
    impact?: number;
    contribution?: number;
    shap_value?: number;
    value?: string | number;
    evidence_type?: string;
  }[];
  status: string;
  created_at: string;
  model_version?: string;
  attack_class?: string | null;
  confidence?: number;
  raw_features?: Record<string, string | number>;
  evidence_type?: string;
  explanation_type?: string;
  model_metadata?: {
    evidence_type?: string;
    explanation_type?: string;
  };
}

interface ModelWire {
  model_version: string;
  model_type: string;
  active: boolean;
  metadata_json?: Record<string, unknown>;
}

interface PredictionWire {
  prediction_id: string;
  event_id: string;
  model_version: string;
  binary_prediction: "normal" | "attack";
  attack_class: string | null;
  confidence: number;
  raw_features: Record<string, string | number>;
  top_features: AlertWire["top_features"];
  alert_id: string | null;
}

function asSeverity(value: string): Alert["severity"] {
  return ["critical", "high", "medium", "low", "normal"].includes(value)
    ? value as Alert["severity"] : "medium";
}

function asAlertStatus(value: string): AlertStatus {
  return ["investigating", "confirmed", "false_positive", "resolved"].includes(value)
    ? value as AlertStatus
    : "new";
}

function explicitEvidenceType(value: string | undefined): EvidenceType | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  if (["model_contribution", "contribution", "shap", "shap_value"].includes(normalized)) {
    return "model_contribution";
  }
  if (["highlighted_value", "feature_value", "raw_value", "value"].includes(normalized)) {
    return "highlighted_value";
  }
  return undefined;
}

function evidenceTypeForAlert(value: AlertWire): EvidenceType {
  const declared = explicitEvidenceType(
    value.evidence_type
      ?? value.explanation_type
      ?? value.model_metadata?.evidence_type
      ?? value.model_metadata?.explanation_type,
  );
  if (declared) return declared;
  return value.top_features?.some((feature) =>
    typeof feature.impact === "number"
    || typeof feature.contribution === "number"
    || typeof feature.shap_value === "number"
    || explicitEvidenceType(feature.evidence_type) === "model_contribution"
  )
    ? "model_contribution"
    : "highlighted_value";
}

function identityQuality(features: Record<string, string | number>): IdentityQuality {
  if (
    features.source_ip !== undefined
    || features.src_ip !== undefined
    || features.destination_ip !== undefined
    || features.dst_ip !== undefined
  ) return "explicit";
  if (features["id.orig_p"] !== undefined || features["id.resp_p"] !== undefined) {
    return "port_only";
  }
  return "unknown";
}

function alertFromWire(value: AlertWire): Alert {
  const features = value.raw_features ?? {};
  const alertEvidenceType = evidenceTypeForAlert(value);
  return {
    id: value.alert_id,
    timestamp: value.created_at,
    attack_type: value.attack_class ?? value.reasons?.[0] ?? "Suspicious activity",
    confidence: value.confidence ?? 0,
    severity: asSeverity(value.severity),
    source_ip: String(features.source_ip ?? features.src_ip ?? (features["id.orig_p"] !== undefined ? `port ${features["id.orig_p"]}` : "Source in details")),
    destination_ip: String(features.destination_ip ?? features.dst_ip ?? (features["id.resp_p"] !== undefined ? `port ${features["id.resp_p"]}` : "Destination in details")),
    protocol: String(features.proto ?? features.protocol ?? features.service ?? "—"),
    status: asAlertStatus(value.status),
    features,
    model_version: value.model_version,
    reasons: value.reasons ?? [],
    evidence_type: alertEvidenceType,
    identity_quality: identityQuality(features),
    explanations: value.top_features?.map((feature) => ({
      feature: String(feature.feature ?? feature.name ?? "feature"),
      impact: Number(
        feature.impact
        ?? feature.contribution
        ?? feature.shap_value
        ?? (typeof feature.value === "number" ? feature.value : 0),
      ),
      value: feature.value,
      evidence_type: explicitEvidenceType(feature.evidence_type) ?? (
        typeof feature.impact === "number"
        || typeof feature.contribution === "number"
        || typeof feature.shap_value === "number"
          ? "model_contribution"
          : alertEvidenceType
      ),
    })),
  };
}

function predictionAsAlert(value: PredictionWire): Alert | null {
  if (!value.alert_id) return null;
  return alertFromWire({
    alert_id: value.alert_id,
    event_id: value.event_id,
    severity: value.confidence >= 0.95 ? "critical" : value.confidence >= 0.8 ? "high" : "medium",
    reasons: [value.attack_class ?? value.binary_prediction],
    top_features: value.top_features,
    status: "new",
    created_at: new Date().toISOString(),
    attack_class: value.attack_class,
    confidence: value.confidence,
    raw_features: value.raw_features,
    model_version: value.model_version,
  });
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function errorMessage(status: number, payload: unknown): string {
  if (typeof payload === "string" && payload.trim()) return payload;
  if (payload && typeof payload === "object") {
    const body = payload as { detail?: unknown; message?: unknown; error?: unknown };
    const detail = body.detail ?? body.message ?? body.error;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail)) {
      const messages = detail.flatMap((item) => {
        if (typeof item === "string") return [item];
        if (item && typeof item === "object") {
          const message = (item as { msg?: unknown; message?: unknown }).msg
            ?? (item as { message?: unknown }).message;
          return typeof message === "string" ? [message] : [];
        }
        return [];
      });
      if (messages.length) return messages.join("; ");
    }
  }
  return `Request failed (${status})`;
}

async function errorDetail(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  } catch {
    return undefined;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const detail = await errorDetail(response);
    throw new ApiError(errorMessage(response.status, detail), response.status, detail);
  }
  return response.json() as Promise<T>;
}

export async function checkHealth(): Promise<HealthInfo | null> {
  try {
    return await request<HealthInfo>("/health");
  } catch {
    return null;
  }
}

export async function getAlerts(): Promise<Alert[]> {
  const value = await request<AlertWire[]>("/alerts?limit=500");
  return value.map(alertFromWire);
}

export async function getAlert(id: string): Promise<Alert> {
  return alertFromWire(await request<AlertWire>(`/alerts/${encodeURIComponent(id)}`));
}

export async function submitAlertFeedback(
  alertId: string,
  feedback: AnalystFeedbackRequest,
): Promise<AnalystFeedback> {
  return request<AnalystFeedback>(`/alerts/${encodeURIComponent(alertId)}/feedback`, {
    method: "POST",
    body: JSON.stringify(feedback),
  });
}

export async function getModels(): Promise<ModelInfo[]> {
  const value = await request<ModelWire[]>("/models");
  return value.map((model) => {
    const metrics = (model.metadata_json?.metrics ?? model.metadata_json ?? {}) as Record<string, unknown>;
    return {
      name: model.model_type,
      version: model.model_version,
      status: model.active ? "active" : "candidate",
      macro_f1: Number(metrics.macro_f1 ?? 0),
      weighted_f1: Number(metrics.weighted_f1 ?? 0),
      false_positive_rate: Number(metrics.false_positive_rate ?? 0),
      inference_ms: Number(metrics.inference_ms ?? 0),
      trained_at: typeof model.metadata_json?.trained_at === "string" ? model.metadata_json.trained_at : undefined,
      classes: Array.isArray(metrics.classes) ? metrics.classes.map(String) : undefined,
      confusion_matrix: Array.isArray(metrics.confusion_matrix) ? metrics.confusion_matrix as number[][] : undefined,
      evaluation_scope: typeof metrics.evaluation_scope === "string" ? metrics.evaluation_scope : undefined,
    };
  });
}

function observationsFromRows(rows: Record<string, string | number>[]) {
  return rows.map((row) => {
    const ended = new Date();
    const durationSeconds = Number(row.flow_duration ?? 0);
    // Preserve CSV insertion order: the backend schema freezes the canonical
    // 83-feature order and rejects target/index artifacts.
    const features = Object.fromEntries(Object.entries(row).filter(([key]) =>
      key !== "Attack_type" &&
      key !== "ground_truth" &&
      key !== "source" &&
      !key.toLowerCase().startsWith("unnamed")
    ));
    return {
      schema_version: "rt-iot2022-v1",
      event_id: crypto.randomUUID(),
      flow_started_at: new Date(ended.valueOf() - Math.max(0, durationSeconds) * 1000).toISOString(),
      flow_ended_at: ended.toISOString(),
      source: String(row.source ?? "dashboard-upload"),
      features,
      ground_truth: typeof row.Attack_type === "string"
        ? row.Attack_type
        : typeof row.ground_truth === "string" ? row.ground_truth : null,
    };
  });
}

export async function predict(rows: Record<string, string | number>[]) {
  const observations = observationsFromRows(rows);
  return request<unknown>(rows.length === 1 ? "/predict" : "/predict/batch", {
    method: "POST",
    body: JSON.stringify(rows.length === 1 ? observations[0] : { observations }),
  });
}

export async function startReplay(rows: Record<string, string | number>[], speed: number) {
  return request<unknown>("/replay/start", {
    method: "POST",
    body: JSON.stringify({
      observations: observationsFromRows(rows),
      interval_ms: 1000,
      speed,
      scenario: "saved-normal-observation",
    }),
  });
}

export async function replayAction(action: "pause" | "resume", speed: number) {
  return request<unknown>(`/replay/${action}`, {
    method: "POST",
    body: JSON.stringify(action === "resume" ? { speed } : {}),
  });
}

export function socketUrl(): string {
  const configured = import.meta.env.VITE_WS_URL as string | undefined;
  if (configured) return configured;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/api/v1/live`;
}

export function alertFromSocketMessage(value: unknown): Alert | null {
  if (!value || typeof value !== "object") return null;
  const message = value as { type?: string; data?: PredictionWire };
  return message.type === "prediction" && message.data ? predictionAsAlert(message.data) : null;
}
