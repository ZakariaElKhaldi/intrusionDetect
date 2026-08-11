import type {
  Alert,
  AlertStatus,
  AnalystFeedback,
  AnalystFeedbackRequest,
  EvidenceType,
  HealthInfo,
  IdentityQuality,
  LiveEvent,
  LivePrediction,
  ModelInfo,
  AlertExplanationStage,
  EvaluationCandidate,
  EvaluationReport,
  ReplayOptions,
  ReplayStatus,
  DashboardSummary,
  AlertPage,
  IngestionStatus,
  IngestionJob,
  IngestionJobDetail,
  CursorPage,
  OutboxEvent,
  ModelHealthSnapshot,
  ModelHealthHistory,
  ModelHealthCohort,
  RedriveResponse,
  AuthSession,
  IngestionBatchReceipt,
} from "./types";

const configuredApi = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "");
const API_BASE = configuredApi
  ? configuredApi.endsWith("/api/v1") ? configuredApi : `${configuredApi}/api/v1`
  : "/api/v1";

let accessToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setApiAccessToken(token: string | null) {
  accessToken = token;
}

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

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
  detector_model_version?: string;
  classifier_model_version?: string | null;
  detection_score?: number;
  attack_class_score?: number | null;
  detector_latency_ms?: number;
  classifier_latency_ms?: number | null;
  total_latency_ms?: number;
  attack_class?: string | null;
  confidence?: number;
  raw_features?: Record<string, string | number>;
  network_context?: {
    source_ip?: string | null;
    destination_ip?: string | null;
    source_port?: number | null;
    destination_port?: number | null;
    protocol?: string | null;
    interface?: string | null;
    capture_id?: string | null;
    extractor_fingerprint?: string | null;
  } | null;
  evidence_type?: string;
  explanation_type?: string;
  model_metadata?: {
    evidence_type?: string;
    explanation_type?: string;
  };
  feedback?: AnalystFeedback[];
}

interface ModelWire {
  model_version: string;
  model_type: string;
  active: boolean;
  metadata_json?: Record<string, unknown>;
  role?: string;
}

interface PredictionWire {
  prediction_id: string;
  event_id: string;
  model_version?: string;
  detector_model_version?: string;
  classifier_model_version?: string | null;
  binary_prediction: "normal" | "attack";
  attack_class: string | null;
  confidence?: number;
  detection_score?: number;
  detection_score_calibrated?: boolean;
  attack_class_score?: number | null;
  attack_class_score_calibrated?: boolean | null;
  detector_latency_ms?: number;
  classifier_latency_ms?: number | null;
  total_latency_ms?: number;
  latency_ms?: number;
  end_to_end_latency_ms?: number;
  raw_features?: Record<string, string | number>;
  top_features?: AlertWire["top_features"];
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
  const context = value.network_context ?? {};
  const identityFeatures = {
    ...features,
    ...(context.source_ip ? { source_ip: context.source_ip } : {}),
    ...(context.destination_ip ? { destination_ip: context.destination_ip } : {}),
  };
  const alertEvidenceType = evidenceTypeForAlert(value);
  return {
    id: value.alert_id,
    timestamp: value.created_at,
    attack_type: value.attack_class ?? value.reasons?.[0] ?? "Suspicious activity",
    confidence: value.detection_score ?? value.confidence ?? 0,
    severity: asSeverity(value.severity),
    source_ip: String(context.source_ip ?? features.source_ip ?? features.src_ip ?? (context.source_port !== undefined && context.source_port !== null ? `port ${context.source_port}` : features["id.orig_p"] !== undefined ? `port ${features["id.orig_p"]}` : "Source in details")),
    destination_ip: String(context.destination_ip ?? features.destination_ip ?? features.dst_ip ?? (context.destination_port !== undefined && context.destination_port !== null ? `port ${context.destination_port}` : features["id.resp_p"] !== undefined ? `port ${features["id.resp_p"]}` : "Destination in details")),
    protocol: String(context.protocol ?? features.proto ?? features.protocol ?? features.service ?? "—"),
    status: asAlertStatus(value.status),
    features,
    model_version: value.model_version,
    detector_model_version: value.detector_model_version ?? value.model_version,
    classifier_model_version: value.classifier_model_version,
    detection_score: value.detection_score ?? value.confidence,
    attack_class_score: value.attack_class_score,
    detector_latency_ms: value.detector_latency_ms,
    classifier_latency_ms: value.classifier_latency_ms,
    total_latency_ms: value.total_latency_ms,
    reasons: value.reasons ?? [],
    evidence_type: alertEvidenceType,
    identity_quality: identityQuality(identityFeatures),
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
    feedback: value.feedback ?? [],
  };
}

function predictionFromWire(value: PredictionWire): LivePrediction | null {
  if (
    typeof value.prediction_id !== "string"
    || typeof value.event_id !== "string"
    || !["normal", "attack"].includes(value.binary_prediction)
  ) return null;
  return {
    prediction_id: value.prediction_id,
    event_id: value.event_id,
    model_version: value.model_version,
    detector_model_version: value.detector_model_version ?? value.model_version,
    classifier_model_version: value.classifier_model_version,
    binary_prediction: value.binary_prediction,
    attack_class: typeof value.attack_class === "string" ? value.attack_class : null,
    confidence: value.confidence,
    detection_score: value.detection_score ?? value.confidence ?? 0,
    detection_score_calibrated: value.detection_score_calibrated === true,
    attack_class_score: value.attack_class_score,
    attack_class_score_calibrated: value.attack_class_score_calibrated,
    detector_latency_ms: value.detector_latency_ms ?? value.latency_ms,
    classifier_latency_ms: value.classifier_latency_ms,
    total_latency_ms: value.total_latency_ms,
    end_to_end_latency_ms: value.end_to_end_latency_ms,
    alert_id: typeof value.alert_id === "string" ? value.alert_id : null,
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }
  const retryAt = Date.parse(trimmed);
  if (!Number.isFinite(retryAt)) return undefined;
  return Math.max(0, Math.ceil((retryAt - Date.now()) / 1_000));
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
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const method = (init?.method ?? "GET").toUpperCase();
  const requiresToken = !["GET", "HEAD", "OPTIONS"].includes(method) || path === "/auth/me";
  if (accessToken && requiresToken && path !== "/auth/login") {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort("request-timeout"), 15_000);
  const abortFromCaller = () => controller.abort(init?.signal?.reason);
  init?.signal?.addEventListener("abort", abortFromCaller, { once: true });
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch (reason) {
    if (controller.signal.aborted && !init?.signal?.aborted) {
      throw new ApiError("Request timed out. Check the service connection and try again.", 0);
    }
    throw reason;
  } finally {
    window.clearTimeout(timeout);
    init?.signal?.removeEventListener("abort", abortFromCaller);
  }
  if (!response.ok) {
    const detail = await errorDetail(response);
    if (response.status === 401 && path !== "/auth/login") unauthorizedHandler?.();
    throw new ApiError(
      errorMessage(response.status, detail),
      response.status,
      detail,
      parseRetryAfter(response.headers.get("Retry-After")),
    );
  }
  return response.json() as Promise<T>;
}

export async function login(username: string, password: string): Promise<AuthSession> {
  const value = await request<Omit<AuthSession, "username">>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  return { ...value, username };
}

export async function getCurrentUser(): Promise<{ username: string; role: string }> {
  return request<{ username: string; role: string }>("/auth/me");
}

export async function getAuthenticationStatus(): Promise<{ enabled: boolean }> {
  return request<{ enabled: boolean }>("/auth/status");
}

export async function checkHealth(): Promise<HealthInfo | null> {
  try {
    return await request<HealthInfo>("/health");
  } catch {
    return null;
  }
}

export async function getIngestionStatus(): Promise<IngestionStatus> {
  const value = await request<unknown>("/ingestion/status");
  if (!value || typeof value !== "object" || !("queue_depth" in value) || !("worker" in value) || !("outbox" in value)) {
    throw new ApiError("Ingestion status response is invalid.", 502, value);
  }
  return value as IngestionStatus;
}

function queryString(values: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "") query.set(key, String(value));
  });
  return query.toString();
}

function cursorPage<T>(value: unknown, label: string): CursorPage<T> {
  if (!value || typeof value !== "object" || !("items" in value) || !Array.isArray(value.items) || !("total" in value) || !("limit" in value)) {
    throw new ApiError(`${label} response is invalid.`, 502, value);
  }
  return value as CursorPage<T>;
}

export async function getIngestionJobs(filters: { state?: string; error_code?: string; source?: string; created_from?: string; created_to?: string; limit?: number; cursor?: string } = {}): Promise<CursorPage<IngestionJob>> {
  return cursorPage<IngestionJob>(await request<unknown>(`/ingestion/jobs?${queryString(filters)}`), "Ingestion jobs");
}

export async function getIngestionEvent(eventId: string): Promise<IngestionJobDetail> {
  return request<IngestionJobDetail>(`/ingestion/events/${encodeURIComponent(eventId)}`);
}

export async function getOutboxEvents(filters: { status?: string; event_type?: string; limit?: number; cursor?: string } = {}): Promise<CursorPage<OutboxEvent>> {
  return cursorPage<OutboxEvent>(await request<unknown>(`/ingestion/outbox/events?${queryString(filters)}`), "Outbox events");
}

export async function redriveIngestionJobs(
  eventIds: string[], reason: string, dryRun: boolean,
): Promise<RedriveResponse> {
  return request<RedriveResponse>("/ingestion/jobs/redrive", {
    method: "POST",
    body: JSON.stringify({ event_ids: eventIds, reason, dry_run: dryRun }),
  });
}

type ModelHealthFilters = {
  window: "fast" | "slow";
  source?: string;
  extractor_fingerprint?: string;
  schema_version?: string;
  model_version?: string;
};

export async function getModelHealth(filters: ModelHealthFilters): Promise<ModelHealthSnapshot> {
  const value = await request<unknown>(`/model-health?${queryString(filters)}`);
  if (!value || typeof value !== "object" || !("status" in value) || !("features" in value) || !Array.isArray(value.features)) {
    throw new ApiError("Model-health response is invalid.", 502, value);
  }
  return value as ModelHealthSnapshot;
}

export async function getModelHealthHistory(filters: ModelHealthFilters & { from?: string; to?: string; limit?: number }): Promise<ModelHealthHistory> {
  const value = await request<unknown>(`/model-health/history?${queryString(filters)}`);
  if (!value || typeof value !== "object" || !("items" in value) || !Array.isArray(value.items)) {
    throw new ApiError("Model-health history response is invalid.", 502, value);
  }
  return value as ModelHealthHistory;
}

export async function getModelHealthCohorts(): Promise<ModelHealthCohort[]> {
  const value = await request<{ items: ModelHealthCohort[] }>("/model-health/cohorts");
  if (!Array.isArray(value.items)) throw new ApiError("Model-health cohorts response is invalid.", 502, value);
  return value.items;
}

export async function getAlerts(): Promise<Alert[]> {
  const value = await request<AlertWire[]>("/alerts?limit=500");
  return value.map(alertFromWire);
}

export async function getAlertsPage(filters: { severity?: string; status?: string; family?: string; q?: string; from?: string; to?: string; limit?: number; offset?: number }): Promise<AlertPage> {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== "" && value !== "all") query.set(key, String(value)); });
  const value = await request<{ items: AlertWire[]; total: number; limit: number; offset: number; has_more: boolean }>(`/alerts/page?${query.toString()}`);
  return { ...value, items: value.items.map(alertFromWire) };
}

export async function getDashboardSummary(range: DashboardSummary["range"] = "24h"): Promise<DashboardSummary> {
  const value = await request<unknown>(`/dashboard/summary?range=${range}`);
  if (!value || typeof value !== "object" || !("predictions" in value) || !("alerts" in value) || !("scope" in value)) {
    throw new ApiError("Dashboard summary response is invalid.", 502, value);
  }
  return value as DashboardSummary;
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
    const declaredRole = model.role ?? model.metadata_json?.role ?? model.metadata_json?.target;
    const role: ModelInfo["role"] = declaredRole === "binary"
      ? "detector"
      : declaredRole === "multiclass"
        ? "classifier"
        : ["detector", "classifier", "candidate"].includes(String(declaredRole))
          ? String(declaredRole) as ModelInfo["role"]
          : undefined;
    return {
      name: model.model_type,
      version: model.model_version,
      status: model.active ? "active" : "candidate",
      macro_f1: Number(metrics.macro_f1 ?? 0),
      weighted_f1: Number(metrics.weighted_f1 ?? 0),
      false_positive_rate: optionalNumber(metrics.false_positive_rate),
      inference_ms: Number(metrics.inference_ms ?? 0),
      trained_at: typeof model.metadata_json?.trained_at === "string" ? model.metadata_json.trained_at : undefined,
      classes: Array.isArray(metrics.classes) ? metrics.classes.map(String) : undefined,
      confusion_matrix: Array.isArray(metrics.confusion_matrix) ? metrics.confusion_matrix as number[][] : undefined,
      evaluation_scope: typeof metrics.evaluation_scope === "string" ? metrics.evaluation_scope : undefined,
      role,
      probability_calibrated: model.metadata_json?.probability_calibrated === true,
    };
  });
}

function numericRecord(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number");
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function evaluationCandidate(value: unknown, champion?: string): EvaluationCandidate | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const test = (row.test_metrics ?? row.test ?? row.metrics ?? {}) as Record<string, unknown>;
  const operational = (row.operational ?? {}) as Record<string, unknown>;
  const name = String(row.name ?? row.model_name ?? row.model_type ?? row.candidate ?? "Candidate");
  const matrix = test.confusion_matrix ?? row.confusion_matrix;
  const classes = test.classes ?? row.classes;
  const support = test.class_support ?? test.support ?? row.class_support ?? row.support;
  const seedValues = row.seed_metrics ?? row.seeds ?? row.runs;
  return {
    name,
    version: String(row.version ?? row.model_version ?? "evaluation-only"),
    status: Boolean(row.selected) || champion === name ? "active" : "candidate",
    role: "candidate",
    probability_calibrated: row.probability_calibrated === true,
    selected: Boolean(row.selected) || champion === name,
    macro_f1: Number(test.macro_f1 ?? row.macro_f1 ?? 0),
    weighted_f1: Number(test.weighted_f1 ?? row.weighted_f1 ?? 0),
    false_positive_rate: optionalNumber(test.false_positive_rate ?? test.fpr ?? row.false_positive_rate),
    inference_ms: Number(operational.median_inference_latency_ms ?? operational.p50_latency_ms ?? operational.inference_ms ?? row.inference_ms ?? 0),
    classes: Array.isArray(classes) ? classes.map(String) : undefined,
    confusion_matrix: Array.isArray(matrix) ? matrix as number[][] : undefined,
    evaluation_scope: typeof row.evaluation_scope === "string" ? row.evaluation_scope : "shared random test split",
    selection_metric: typeof row.selection_metric === "string" ? row.selection_metric : undefined,
    selection_value: typeof row.selection_value === "number" ? row.selection_value : undefined,
    test_metrics: numericRecord(test),
    seed_metrics: Array.isArray(seedValues)
      ? seedValues.map(numericRecord).filter((item): item is Record<string, number> => Boolean(item))
      : undefined,
    selection_summary: numericRecord(row.three_seed_aggregate ?? row.selection_aggregate),
    support: numericRecord(support),
  };
}

export async function getEvaluation(stage: "binary" | "multiclass"): Promise<EvaluationReport> {
  const payload = await request<unknown>(`/evaluation?stage=${stage}`);
  const body = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const championValue = body.selected_champion ?? body.champion ?? body.selected_model;
  const champion = championValue && typeof championValue === "object"
    ? String((championValue as Record<string, unknown>).model_name ?? (championValue as Record<string, unknown>).name ?? "") || undefined
    : championValue == null ? undefined : String(championValue) || undefined;
  const rawCandidates = Array.isArray(body.candidates)
    ? body.candidates
    : Array.isArray(body.models) ? body.models : Array.isArray(payload) ? payload : [];
  const notes = body.measurement_notes ?? body.notes;
  const threshold = body.threshold_analysis && typeof body.threshold_analysis === "object"
    ? body.threshold_analysis as Record<string, unknown> : undefined;
  const cascadeValue = body.cascade_evaluation ?? body.cascade_summary;
  const cascade = cascadeValue && typeof cascadeValue === "object"
    ? cascadeValue as Record<string, unknown> : undefined;
  return {
    stage,
    probability_calibrated: body.probability_calibrated === true,
    candidates: rawCandidates
      .map((candidate) => evaluationCandidate(candidate, champion))
      .filter((candidate): candidate is EvaluationCandidate => candidate !== null),
    selected_champion: champion,
    measurement_notes: Array.isArray(notes) ? notes.map(String) : [],
    split_notes: typeof body.split_notes === "string"
      ? body.split_notes
      : typeof body.evaluation_scope === "string" ? body.evaluation_scope
        : body.split_definition && typeof body.split_definition === "object" ? JSON.stringify(body.split_definition) : undefined,
    threshold_analysis: threshold ? {
      operating_threshold: Number(threshold.operating_threshold ?? 0.5),
      points: (Array.isArray(threshold.points) ? threshold.points : []).map((point) => {
        const row = point as Record<string, unknown>;
        return {
          threshold: Number(row.threshold ?? 0),
          recall: Number(row.recall ?? 0),
          precision: Number(row.precision ?? 0),
          false_positive_rate: Number(row.false_positive_rate ?? row.fpr ?? 0),
          alert_rate: Number(row.alert_rate ?? 0),
        };
      }),
      partition_rows: optionalNumber(threshold.partition_rows),
      score_note: typeof threshold.score_note === "string" ? threshold.score_note : undefined,
      selection_policy: typeof threshold.selection_policy === "string" ? threshold.selection_policy : undefined,
    } : undefined,
    cascade_evaluation: cascade ? {
      protocol: typeof cascade.protocol === "string" ? cascade.protocol : undefined,
      split_seed: optionalNumber(cascade.split_seed),
      test_rows: optionalNumber(cascade.test_rows),
      detector_false_negatives: optionalNumber(cascade.detector_false_negatives),
      detector_routed_rows: optionalNumber(cascade.detector_routed_rows),
      aggregate: numericRecord(cascade.aggregate),
      metrics: numericRecord(cascade.metrics),
      classes: Array.isArray(cascade.classes) ? cascade.classes.map(String) : [],
      confusion_matrix: Array.isArray(cascade.confusion_matrix) ? cascade.confusion_matrix as number[][] : [],
      class_support: numericRecord(cascade.class_support),
    } : undefined,
  };
}

function explanationStage(value: unknown): AlertExplanationStage | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const contributions = row.contributions ?? row.features ?? row.attributions;
  if (!Array.isArray(contributions)) return null;
  const stage = String(row.stage ?? "binary");
  if (!["binary", "multiclass", "detector", "classifier"].includes(stage)) return null;
  return {
    stage: stage as AlertExplanationStage["stage"],
    model_version: String(row.model_version ?? "not reported"),
    explained_class: String(row.explained_class ?? row.output_class ?? row.class ?? "prediction"),
    base_value: Number(row.base_value ?? 0),
    output_value: Number(row.output_value ?? 0),
    method: String(row.method ?? "SHAP"),
    output_units: typeof row.output_units === "string" ? row.output_units : undefined,
    calibration_scope: typeof row.calibration_scope === "string" ? row.calibration_scope : undefined,
    contributions: contributions.map((item) => {
      const contribution = item as Record<string, unknown>;
      return {
        feature: String(contribution.transformed_feature ?? contribution.feature ?? contribution.name ?? "feature"),
        raw_feature: typeof contribution.raw_feature === "string"
          ? contribution.raw_feature
          : typeof contribution.feature === "string" ? contribution.feature : undefined,
        raw_value: typeof contribution.raw_value === "string" || typeof contribution.raw_value === "number"
          ? contribution.raw_value : null,
        ...(typeof contribution.transformed_value === "string" || typeof contribution.transformed_value === "number"
          ? { transformed_value: contribution.transformed_value } : {}),
        impact: Number(contribution.impact ?? contribution.shap_value ?? contribution.contribution ?? 0),
      };
    }),
  };
}

export async function getAlertExplanation(alertId: string): Promise<AlertExplanationStage[]> {
  const payload = await request<unknown>(`/alerts/${encodeURIComponent(alertId)}/explanation`);
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const raw = Array.isArray(payload)
    ? payload
    : Array.isArray(body.explanations) ? body.explanations
      : Array.isArray(body.stages) ? body.stages : [payload];
  return raw.map(explanationStage).filter((item): item is AlertExplanationStage => item !== null);
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

export async function enqueueObservations(
  rows: Record<string, string | number>[],
): Promise<IngestionBatchReceipt> {
  return request<IngestionBatchReceipt>("/ingestion/events", {
    method: "POST",
    body: JSON.stringify({ observations: observationsFromRows(rows) }),
  });
}

export async function startCustomReplay(
  rows: Record<string, string | number>[],
  speed = 1,
): Promise<ReplayStatus> {
  return request<ReplayStatus>("/replay/start", {
    method: "POST",
    body: JSON.stringify({
      mode: "custom",
      observations: observationsFromRows(rows),
      interval_ms: 250,
      speed,
      scenario: "custom-upload",
    }),
  });
}

export async function startReplay(options: ReplayOptions): Promise<ReplayStatus> {
  return request<ReplayStatus>("/replay/start", {
    method: "POST",
    body: JSON.stringify({
      mode: "dataset",
      scenario: options.scenario,
      offset: options.offset,
      limit: options.limit,
      interval_ms: options.interval_ms ?? 250,
      speed: options.speed,
    }),
  });
}

export async function getReplayStatus(): Promise<ReplayStatus> {
  return request<ReplayStatus>("/replay/status");
}

export async function replayAction(
  action: "pause" | "resume" | "stop",
  speed: number,
): Promise<ReplayStatus> {
  return request<ReplayStatus>(`/replay/${action}`, {
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

function decodedSocketValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/** Convert the WebSocket wire envelope into the two events the UI understands. */
export function liveEventFromSocketMessage(value: unknown): LiveEvent | null {
  const decoded = decodedSocketValue(value);
  if (!decoded || typeof decoded !== "object") return null;
  const message = decoded as { type?: unknown; data?: unknown; payload?: unknown };
  const data = message.data ?? message.payload;
  if (!data || typeof data !== "object") return null;

  // `prediction` is accepted during the backend transition, but it always
  // remains telemetry: an alert_id on a prediction is not an alert payload.
  if (message.type === "prediction.created" || message.type === "prediction") {
    const prediction = predictionFromWire(data as PredictionWire);
    return prediction ? { type: "prediction.created", data: prediction } : null;
  }
  if (message.type === "alert.created" || message.type === "alert") {
    const alert = data as AlertWire;
    if (typeof alert.alert_id !== "string" || typeof alert.created_at !== "string") return null;
    return { type: "alert.created", data: alertFromWire(alert) };
  }
  return null;
}
