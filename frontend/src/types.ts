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
  reasons?: string[];
  evidence_type?: EvidenceType;
  identity_quality?: IdentityQuality;
}

export interface HealthInfo {
  status: string;
  schema_version: string;
  model_version: string;
  live_connections: number;
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
  false_positive_rate?: number;
  inference_ms?: number;
  trained_at?: string;
  classes?: string[];
  confusion_matrix?: number[][];
  evaluation_scope?: string;
}

export type Page = "overview" | "alerts" | "topology" | "models" | "testing";
