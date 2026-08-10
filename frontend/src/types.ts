export type Severity = "critical" | "high" | "medium" | "low" | "normal";

export type AlertStatus =
  | "new"
  | "investigating"
  | "confirmed"
  | "false_positive"
  | "resolved";

export type EvidenceType = "model_contribution" | "highlighted_value";

export type IdentityQuality = "explicit" | "inferred" | "port_only" | "unknown";

export interface AlertEvidence {
  feature: string;
  /**
   * Kept for compatibility with the original alert drawer. For highlighted
   * values this is the raw numeric feature value, not a model contribution.
   */
  impact: number;
  value?: string | number;
  evidence_type?: EvidenceType;
}

export interface Alert {
  id: string;
  timestamp: string;
  attack_type: string;
  confidence: number;
  severity: Severity;
  source_ip: string;
  destination_ip: string;
  protocol: string;
  status: AlertStatus;
  features?: Record<string, string | number>;
  explanations?: AlertEvidence[];
  model_version?: string;
  detector_model_version?: string;
  classifier_model_version?: string | null;
  detection_score?: number;
  attack_class_score?: number | null;
  detector_latency_ms?: number;
  classifier_latency_ms?: number | null;
  total_latency_ms?: number;
  reasons?: string[];
  evidence_type?: EvidenceType;
  identity_quality?: IdentityQuality;
}

export interface HealthInfo {
  status: string;
  schema_version: string;
  model_version: string;
  detector_model_version?: string;
  classifier_model_version?: string | null;
  live_connections: number;
  dataset_ready?: boolean;
  dataset_checksum?: string | null;
  production_bundle_valid?: boolean;
  fallback_active?: boolean;
  fallback?: boolean;
  fallback_status?: string | { active: boolean; detector: boolean; classifier: boolean };
  readiness?: "ready" | "degraded" | "blocked";
  checked_at?: string;
  instance_id?: string;
  dataset_checksum_matches_training?: boolean | null;
  dataset_error?: string | null;
  components?: Record<string, HealthComponent>;
}

export interface HealthComponent {
  status: string;
  reason?: string;
  checked_at?: string;
  [key: string]: unknown;
}

export type IngestionPipelineState =
  | "healthy"
  | "idle"
  | "backlogged"
  | "retrying"
  | "dead_letter"
  | "offline";

export interface IngestionStatus {
  queue_depth: number;
  queued: number;
  processing: number;
  succeeded: number;
  oldest_pending_age_seconds: number | null;
  retries: number;
  retrying: number;
  failures: number;
  dead_letter: number;
  throughput_per_minute: number;
  worker: {
    status: "ready" | "degraded" | "blocked" | string;
    reason?: string;
    last_heartbeat_at: string | null;
  };
  outbox: {
    status: "ready" | "degraded" | "blocked" | string;
    reason?: string;
    pending: number;
    published: number;
    oldest_pending_age_seconds: number | null;
  };
  generated_at: string;
}

export type IngestionJobState = "queued" | "processing" | "retrying" | "succeeded" | "dead_letter";

export interface IngestionJob {
  event_id: string;
  batch_id: string;
  state: IngestionJobState;
  attempts: number;
  error_code: string | null;
  retryable: boolean;
  redrive_count: number;
  source: string;
  schema_version: string;
  extractor_fingerprint: string | null;
  created_at: string;
  updated_at: string;
  available_at: string;
  completed_at: string | null;
  last_error: string | null;
}

export interface IngestionTransition {
  transition_id: string;
  from_state: IngestionJobState | null;
  to_state: IngestionJobState;
  action: string;
  attempt: number;
  error_code: string | null;
  actor: string;
  reason: string | null;
  created_at: string;
}

export interface IngestionJobDetail extends IngestionJob {
  transitions: IngestionTransition[];
}

export interface CursorPage<T> {
  items: T[];
  total: number;
  limit: number;
  next_cursor: string | null;
}

export interface OutboxEvent {
  outbox_id: string;
  event_id: string;
  event_type: string;
  status: "pending" | "published" | "failed";
  publish_attempts: number;
  last_error: string | null;
  created_at: string;
  published_at: string | null;
}

export interface RedriveResult {
  event_id: string;
  eligible: boolean;
  reason: string;
}

export interface RedriveResponse {
  dry_run: boolean;
  results: RedriveResult[];
}

export interface AuthSession {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  expires_at: string;
  username: string;
}

export interface ModelHealthCohort {
  model_version: string;
  detector_model_version: string;
  classifier_model_version: string | null;
  schema_version: string;
  ingestion_channel: string;
  extractor_fingerprint: string | null;
  deployment_eligible: boolean;
}

export type ModelHealthStatus = "blocked" | "incompatible_source" | "collecting" | "healthy" | "warning" | "critical";

export interface ModelHealthSnapshot {
  status: ModelHealthStatus;
  reason: string;
  window: "fast" | "slow";
  cohort: Record<string, unknown>;
  reference: Record<string, unknown> | null;
  observation_count: number;
  aggregate: Record<string, unknown>;
  features: Record<string, unknown>[];
  unseen_categories: unknown[];
  outputs: Record<string, unknown>;
  quality: Record<string, unknown>;
  performance: Record<string, unknown>;
  checked_at: string;
  shadow_mode: boolean;
}

export interface ModelHealthHistoryItem {
  checked_at: string;
  status: ModelHealthStatus;
  observation_count: number;
  aggregate_score: number | null;
  aggregate_threshold: number | null;
  feature_alarm_count: number;
  output_alarm_count: number;
  output_aggregate_score: number | null;
}

export interface ModelHealthHistory {
  items: ModelHealthHistoryItem[];
  [key: string]: unknown;
}

export interface DashboardSummary {
  range: "15m" | "1h" | "24h" | "7d" | "all";
  checked_at: string;
  generated_at: string;
  window: { from: string | null; to: string };
  scope: { source: string; time_field: string; range: string; from: string | null; to: string; bucket_minutes: number; includes: string[] };
  persisted_totals: { predictions: number; alerts: number; unresolved_alerts: number };
  predictions: { total: number; attack: number; normal: number };
  alerts: { total: number; open: number; unresolved: number; critical_open: number; resolved: number; false_positive: number };
  median_detection_score: number | null;
  status_counts: Record<string, number>;
  severity_counts: Record<string, number>;
  family_counts: Record<string, number>;
  protocol_counts: Record<string, number>;
  severity_timeline: { bucket_start: string; total: number; critical: number; high: number; medium: number; low: number }[];
}

export interface AlertPage {
  items: Alert[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export type ReplayScenario = "attack" | "normal" | "all" | `class:${string}`;
export type ReplayLifecycle = "idle" | "running" | "paused" | "completed" | "stopped" | "failed";

export interface ReplayOptions {
  scenario: ReplayScenario;
  speed: number;
  limit: number;
  interval_ms?: number;
}

export interface ReplayStatus {
  status: ReplayLifecycle;
  processed: number;
  total: number;
  error: string | null;
  speed: number;
  scenario: string;
  mode: string;
  offset: number;
  limit: number | null;
}

export interface ExplanationContribution {
  feature: string;
  raw_feature?: string;
  raw_value?: string | number | null;
  transformed_value?: string | number | null;
  impact: number;
}

export interface ThresholdPoint {
  threshold: number;
  recall: number;
  precision: number;
  false_positive_rate: number;
  alert_rate: number;
}

export interface ThresholdAnalysis {
  operating_threshold: number;
  points: ThresholdPoint[];
  partition_rows?: number;
  score_note?: string;
  selection_policy?: string;
}

export interface CascadeEvaluation {
  protocol?: string;
  split_seed?: number;
  test_rows?: number;
  detector_false_negatives?: number;
  detector_routed_rows?: number;
  aggregate?: Record<string, number>;
  metrics?: Record<string, number>;
  classes: string[];
  confusion_matrix: number[][];
  class_support?: Record<string, number>;
}

export interface AlertExplanationStage {
  stage: "binary" | "multiclass" | "detector" | "classifier";
  model_version: string;
  explained_class: string;
  base_value: number;
  output_value: number;
  method: string;
  output_units?: string;
  calibration_scope?: string;
  contributions: ExplanationContribution[];
}

export interface EvaluationCandidate extends ModelInfo {
  selected?: boolean;
  selection_metric?: string;
  selection_value?: number;
  test_metrics?: Record<string, number>;
  seed_metrics?: Record<string, number>[];
  selection_summary?: Record<string, number>;
  support?: Record<string, number>;
}

export interface EvaluationReport {
  stage: "binary" | "multiclass";
  candidates: EvaluationCandidate[];
  selected_champion?: string;
  measurement_notes: string[];
  split_notes?: string;
  threshold_analysis?: ThresholdAnalysis;
  cascade_evaluation?: CascadeEvaluation;
}

export interface AnalystFeedbackRequest {
  analyst: string;
  status: AlertStatus;
  notes?: string | null;
}

export interface AnalystFeedback {
  feedback_id: string;
  alert_id: string;
  analyst: string;
  status: AlertStatus;
  notes: string | null;
  created_at: string;
}

export interface ModelInfo {
  id?: string;
  name: string;
  version: string;
  status?: string;
  macro_f1?: number;
  weighted_f1?: number;
  false_positive_rate?: number | null;
  inference_ms?: number;
  trained_at?: string;
  classes?: string[];
  confusion_matrix?: number[][];
  evaluation_scope?: string;
  role?: "detector" | "classifier" | "candidate";
  probability_calibrated?: boolean;
}

export interface LivePrediction {
  prediction_id: string;
  event_id: string;
  model_version?: string;
  detector_model_version?: string;
  classifier_model_version?: string | null;
  binary_prediction: "normal" | "attack";
  attack_class: string | null;
  confidence?: number;
  detection_score: number;
  attack_class_score?: number | null;
  detector_latency_ms?: number;
  classifier_latency_ms?: number | null;
  total_latency_ms?: number;
  end_to_end_latency_ms?: number;
  alert_id: string | null;
}

export type LiveEvent =
  | { type: "prediction.created"; data: LivePrediction }
  | { type: "alert.created"; data: Alert };

export type Page = "overview" | "alerts" | "topology" | "models" | "testing";
