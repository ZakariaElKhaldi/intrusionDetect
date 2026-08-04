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
