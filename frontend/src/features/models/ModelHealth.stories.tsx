import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ModelHealthCohort, ModelHealthHistory, ModelHealthSnapshot } from "../../types";
import { ModelHealthView } from "./ModelHealthView";

const deployment: ModelHealthCohort = {
  model_version: "bundle-2026.08",
  detector_model_version: "binary-hgb-2102398e",
  classifier_model_version: "multiclass-rf-bfe3010d",
  schema_version: "rt-iot2022-v1",
  ingestion_channel: "live_capture",
  extractor_fingerprint: null,
  deployment_eligible: true,
};

const replay: ModelHealthCohort = {
  ...deployment,
  ingestion_channel: "dataset_replay",
  deployment_eligible: false,
};

const healthy: ModelHealthSnapshot = {
  status: "healthy",
  reason: "No calibrated distribution alarm is active.",
  window: "fast",
  cohort: { ...deployment },
  reference: { reference_version: "drift-reference-v1", dataset_checksum: "956956c0…" },
  observation_count: 4_820,
  aggregate: { score: 0.63, threshold: 1, feature_alarm_count: 0, output_alarm_count: 0, output_aggregate_score: 0.42 },
  features: [
    { feature: "flow_duration", status: "healthy", score: 0.42, threshold: 1, drifted: false, method: "Jensen-Shannon" },
    { feature: "service", status: "healthy", score: 0.31, threshold: 1, drifted: false, method: "Jensen-Shannon" },
  ],
  unseen_categories: [],
  outputs: { status: "healthy", alarm_count: 0, aggregate_score: 0.42, current: { alert_rate: 0.13 } },
  quality: { schema_rejections: 0, validation_error_codes: {} },
  performance: {
    ground_truth: { labelled_count: 320, detector_attack_recall: 0.94, detector_normal_false_positive_rate: 0.018 },
    analyst_review: { reviewed_alert_count: 24, confirmed: 19, false_positive: 5, scope: "reviewed alerts only" },
  },
  checked_at: "2026-08-11T12:30:00Z",
  shadow_mode: true,
};

const warning: ModelHealthSnapshot = {
  ...healthy,
  status: "warning",
  reason: "Calibrated feature or output alarms indicate changed traffic distribution.",
  aggregate: { score: 1.28, threshold: 1, feature_alarm_count: 2, output_alarm_count: 1, output_aggregate_score: 1.12 },
  features: [
    { feature: "service", status: "warning", score: 1.28, threshold: 1, drifted: true, unseen_values: [{ value: "custom-coap", count: 41 }] },
    { feature: "flow_duration", status: "warning", score: 1.14, threshold: 1, drifted: true },
    { feature: "proto", status: "healthy", score: 0.28, threshold: 1, drifted: false },
  ],
  unseen_categories: [{ feature: "service", value: "custom-coap", count: 41 }],
  outputs: { status: "warning", alarm_count: 1, aggregate_score: 1.12, current: { alert_rate: 0.27 } },
};

const history: ModelHealthHistory = {
  items: [
    { checked_at: "2026-08-11T12:30:00Z", status: "warning", observation_count: 4_820, aggregate_score: 1.28, aggregate_threshold: 1, feature_alarm_count: 2, output_alarm_count: 1, output_aggregate_score: 1.12 },
    { checked_at: "2026-08-11T12:00:00Z", status: "warning", observation_count: 4_610, aggregate_score: 1.08, aggregate_threshold: 1, feature_alarm_count: 1, output_alarm_count: 1, output_aggregate_score: 1.04 },
    { checked_at: "2026-08-11T11:30:00Z", status: "healthy", observation_count: 4_390, aggregate_score: 0.71, aggregate_threshold: 1, feature_alarm_count: 0, output_alarm_count: 0, output_aggregate_score: 0.48 },
    { checked_at: "2026-08-11T11:00:00Z", status: "healthy", observation_count: 4_180, aggregate_score: 0.64, aggregate_threshold: 1, feature_alarm_count: 0, output_alarm_count: 0, output_aggregate_score: 0.43 },
  ],
};

const meta = {
  title: "Workspaces/Models/Model health",
  component: ModelHealthView,
  tags: ["autodocs"],
  decorators: [(Story) => <main style={{ maxWidth: 1240, margin: "0 auto" }}><Story /></main>],
  parameters: { docs: { description: { component: "Documents live model-monitoring states without making network requests or inventing fixture evidence in the product workspace." } } },
  args: {
    fixtureMode: false,
    windowName: "fast",
    cohorts: [deployment, replay],
    cohortIndex: "",
    snapshot: healthy,
    history,
    loading: false,
    error: "",
    onWindowName: () => undefined,
    onCohortIndex: () => undefined,
  },
} satisfies Meta<typeof ModelHealthView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Healthy: Story = {};
export const WarningWithDrivers: Story = { args: { snapshot: warning } };
export const CriticalPersistentAlarms: Story = { args: { snapshot: { ...warning, status: "critical", reason: "Calibrated alarms persisted for three consecutive evaluations." }, history: { items: history.items.map((item, index) => index === 0 ? { ...item, status: "critical" } : item) } } };
export const CollectingEvidence: Story = { args: { snapshot: { ...healthy, status: "collecting", reason: "480/1,000 observations collected.", observation_count: 480, aggregate: { score: null, threshold: null, feature_alarm_count: 0, output_alarm_count: 0 }, features: [], outputs: {}, performance: { ground_truth: {}, analyst_review: {} } }, history: { items: [] } } };
export const MonitoringBlocked: Story = { args: { snapshot: { ...healthy, status: "blocked", reason: "The active model bundle has no checksum-bound drift reference.", observation_count: 0, aggregate: {}, reference: {}, features: [], outputs: {}, performance: {} }, history: { items: [] } } };
export const Loading: Story = { args: { snapshot: null, history: null, loading: true } };
export const EmptyScope: Story = { args: { snapshot: null, history: null } };
export const FailedRequest: Story = { args: { snapshot: null, history: null, error: "The model-health service did not respond." } };
export const FixtureBoundary: Story = { args: { fixtureMode: true, snapshot: null, history: null } };
