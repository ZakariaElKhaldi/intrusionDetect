import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Alert, AlertExplanationStage, AnalystFeedback } from "../../types";
import { AlertInvestigationView } from "./AlertInvestigationDrawer";

const feedback: AnalystFeedback = {
  feedback_id: "feedback-1",
  alert_id: "ALT-0042",
  analyst: "operator@example",
  status: "investigating",
  notes: "The route overlaps an approved maintenance window; validating the source owner.",
  created_at: "2026-08-11T10:08:00Z",
};

const alert: Alert = {
  id: "ALT-0042",
  event_id: "019c-event-0042",
  timestamp: "2026-08-11T10:02:00Z",
  attack_type: "NMAP_UDP_SCAN",
  binary_prediction: "attack",
  attack_class: "NMAP_UDP_SCAN",
  confidence: 0.9731,
  detection_score: 0.9731,
  attack_class_score: 0.8814,
  severity: "critical",
  source_ip: "192.168.10.42",
  destination_ip: "10.0.0.7",
  protocol: "UDP",
  status: "new",
  detector_model_version: "detector-rf-2026.08",
  classifier_model_version: "classifier-rf-2026.08",
  detector_latency_ms: 3.82,
  classifier_latency_ms: 4.61,
  total_latency_ms: 9.07,
  identity_quality: "explicit",
  reasons: ["Detector score exceeded the promoted operating threshold.", "Classifier assigned the NMAP_UDP_SCAN family."],
  explanations: [
    { feature: "packet_rate", impact: 0.31, evidence_type: "model_contribution" },
    { feature: "flow_duration", impact: -0.08, evidence_type: "model_contribution" },
  ],
  evidence_type: "model_contribution",
  network_context: {
    source_ip: "192.168.10.42",
    destination_ip: "10.0.0.7",
    source_port: 5353,
    destination_port: 53,
    protocol: "udp",
    interface: "sensor-edge-1",
    capture_id: "capture-2026-08-11-17",
    extractor_fingerprint: "nfstream-sha256:4f8d…9a2c",
  },
  features: {
    flow_duration: 1240,
    packet_rate: 96.4,
    total_fwd_packets: 44,
    total_bwd_packets: 3,
    protocol_type: "udp",
  },
  feedback: [],
};

const detectorExplanation: AlertExplanationStage = {
  stage: "binary",
  model_version: "detector-rf-2026.08",
  explained_class: "attack",
  base_value: 0.22,
  output_value: 0.73,
  method: "SHAP TreeExplainer",
  output_units: "raw model output",
  calibration_scope: "This alert response does not declare probability calibration.",
  contributions: [
    { feature: "packet_rate_scaled", raw_feature: "packet_rate", raw_value: 96.4, transformed_value: 1.82, impact: 0.31 },
    { feature: "flow_duration_scaled", raw_feature: "flow_duration", raw_value: 1240, transformed_value: 0.71, impact: 0.17 },
    { feature: "fwd_packets_scaled", raw_feature: "total_fwd_packets", raw_value: 44, transformed_value: 1.14, impact: 0.09 },
    { feature: "bwd_packets_scaled", raw_feature: "total_bwd_packets", raw_value: 3, transformed_value: -0.42, impact: -0.08 },
    { feature: "protocol_udp", raw_feature: "protocol_type", raw_value: "udp", transformed_value: 1, impact: 0.04 },
    { feature: "duration_rate_interaction", raw_feature: "flow_duration", raw_value: 1240, transformed_value: 1.29, impact: -0.02 },
  ],
};

const classifierExplanation: AlertExplanationStage = {
  ...detectorExplanation,
  stage: "multiclass",
  model_version: "classifier-rf-2026.08",
  explained_class: "NMAP_UDP_SCAN",
  base_value: 0.16,
  output_value: 0.62,
  contributions: detectorExplanation.contributions.map((item, index) => ({ ...item, impact: index === 0 ? 0.27 : item.impact - 0.01 })),
};

const meta = {
  title: "Workspaces/Alerts/Alert investigation",
  component: AlertInvestigationView,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main style={{ minHeight: "100vh", background: "#eceeeb" }}><h1 className="sr-only">Alert investigation component preview</h1><button type="button" style={{ margin: 20 }}>Originating alert</button><Story /></main>],
  args: {
    alert,
    onClose: () => undefined,
    onDisposition: async (status, notes) => ({ ...feedback, feedback_id: `feedback-${status}`, status, notes }),
    explanations: [detectorExplanation, classifierExplanation],
    explanationState: "ready",
  },
} satisfies Meta<typeof AlertInvestigationView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NeedsReviewTriage: Story = {};
export const ExistingInvestigation: Story = { args: { alert: { ...alert, status: "investigating", feedback: [feedback] } } };
export const ModelEvidence: Story = { args: { initialView: "model" } };
export const ExplanationLoading: Story = { args: { initialView: "model", explanations: [], explanationState: "loading" } };
export const ExplanationUnavailable: Story = { args: { initialView: "model", explanations: [], explanationState: "error", explanationError: "The artifacts used for this historical alert are no longer active.", onRetryExplanation: () => undefined } };
export const RecordProvenance: Story = { args: { initialView: "record" } };
export const LimitedRouteIdentity: Story = { args: { alert: { ...alert, source_ip: "port 5353", destination_ip: "port 53", identity_quality: "port_only", network_context: { source_port: 5353, destination_port: 53, protocol: "udp" } } } };
export const ReadOnlyFixture: Story = { args: { readOnly: true, explanationState: "empty", explanations: [] } };
