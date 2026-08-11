import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ObservationPrediction } from "../../types";
import { ObservationResults } from "./ObservationResults";

const predictions: ObservationPrediction[] = [
  {
    prediction_id: "prediction-normal",
    event_id: "event-normal",
    model_version: "bundle-2026-08",
    detector_model_version: "binary-hgb-2102398e",
    classifier_model_version: null,
    binary_prediction: "normal",
    attack_class: null,
    confidence: 0.08,
    detection_score: 0.08,
    detection_score_calibrated: true,
    detector_latency_ms: 1.18,
    total_latency_ms: 2.06,
    end_to_end_latency_ms: 4.42,
    attack_class_score: null,
    attack_class_score_calibrated: null,
    alert_id: null,
  },
  {
    prediction_id: "prediction-attack",
    event_id: "event-attack",
    model_version: "bundle-2026-08",
    detector_model_version: "binary-hgb-2102398e",
    classifier_model_version: "multiclass-rf-bfe3010d",
    binary_prediction: "attack",
    attack_class: "ARP_poisioning",
    confidence: 0.97,
    detection_score: 0.97,
    detection_score_calibrated: true,
    attack_class_score: 0.91,
    attack_class_score_calibrated: true,
    detector_latency_ms: 1.34,
    classifier_latency_ms: 2.61,
    total_latency_ms: 4.28,
    end_to_end_latency_ms: 6.15,
    alert_id: "alert-attack",
  },
  {
    prediction_id: "prediction-detector-miss",
    event_id: "event-detector-miss",
    model_version: "bundle-2026-08",
    detector_model_version: "binary-hgb-2102398e",
    classifier_model_version: null,
    binary_prediction: "normal",
    attack_class: null,
    confidence: 0.44,
    detection_score: 0.44,
    detection_score_calibrated: false,
    detector_latency_ms: 1.09,
    total_latency_ms: 1.82,
    end_to_end_latency_ms: 3.74,
    attack_class_score: null,
    attack_class_score_calibrated: null,
    alert_id: null,
  },
  {
    prediction_id: "prediction-family-miss",
    event_id: "event-family-miss",
    model_version: "bundle-2026-08",
    detector_model_version: "binary-hgb-2102398e",
    classifier_model_version: "multiclass-rf-bfe3010d",
    binary_prediction: "attack",
    attack_class: "Port_Scan",
    confidence: 0.82,
    detection_score: 0.82,
    detection_score_calibrated: true,
    attack_class_score: 0.56,
    attack_class_score_calibrated: false,
    detector_latency_ms: 1.26,
    classifier_latency_ms: 2.73,
    total_latency_ms: 4.35,
    end_to_end_latency_ms: 6.32,
    alert_id: "alert-family-miss",
  },
];

const rows = [
  { Attack_type: "MQTT_Publish" },
  { Attack_type: "ARP_poisioning" },
  { Attack_type: "DOS_SYN_Hping" },
  { Attack_type: "DDoS_UDP" },
];

const meta = {
  title: "Workspaces/Testing/Observation results",
  component: ObservationResults,
  tags: ["autodocs"],
  decorators: [(Story) => <main style={{ maxWidth: 1180, margin: "0 auto" }}><Story /></main>],
  args: { completedMode: null, rows: [] },
} satisfies Meta<typeof ObservationResults>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AwaitingSubmission: Story = {};

export const PredictionReview: Story = {
  args: { completedMode: "immediate", response: { predictions }, rows },
};

export const DurableQueueReceipt: Story = {
  args: {
    completedMode: "durable",
    rows: [],
    response: {
      batch_id: "batch-2026-08-11-001",
      events: [
        { event_id: "event-001", state: "queued", disposition: "accepted" },
        { event_id: "event-002", state: "succeeded", disposition: "duplicate" },
      ],
    },
  },
};

export const CustomReplayReceipt: Story = {
  args: {
    completedMode: "replay",
    rows: [],
    response: { status: "running", processed: 12, total: 80, error: null, speed: 2, scenario: "custom", mode: "custom", offset: 0, limit: 80 },
  },
};
