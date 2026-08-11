import type { Meta, StoryObj } from "@storybook/react-vite";
import { verifiedAttackObservationCsv, verifiedNormalObservationCsv } from "../../sampleObservation";
import { parseCsv } from "../../utils";
import { ObservationLab } from "./ObservationLab";
import { ObservationLabView } from "./ObservationLabView";
import { validateObservationRows } from "./observationValidation";

const normal = parseCsv(verifiedNormalObservationCsv)[0];
const attack = parseCsv(verifiedAttackObservationCsv)[0];
const validRows = [normal, attack];
const noop = () => undefined;

const meta = {
  title: "Workspaces/Testing/Observation lab",
  component: ObservationLabView,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main style={{ padding: 20, background: "#eceeeb", minHeight: "100vh" }}><h1 className="sr-only">Observation lab</h1><Story /></main>],
  args: {
    rows: [], filename: "", validation: validateObservationRows([]), processingMode: "immediate", replaySpeed: 1,
    completedMode: null, onFile: noop, onLoadNormal: noop, onLoadAttack: noop, onProcessingMode: noop,
    onReplaySpeed: noop, onRun: noop, onClear: noop,
  },
} satisfies Meta<typeof ObservationLabView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AwaitingFile: Story = {};
export const ValidatedNormal: Story = { args: { rows: [normal], filename: "normal-sample.csv", validation: validateObservationRows([normal]) } };
export const ValidatedMixedBatch: Story = { args: { rows: validRows, filename: "review-batch.csv", validation: validateObservationRows(validRows) } };

const invalidValue = { ...normal, flow_duration: "not-a-number", proto: "" };
export const InvalidValues: Story = { args: { rows: [invalidValue], filename: "invalid-values.csv", validation: validateObservationRows([invalidValue]) } };
const missingColumn = { ...normal };
delete missingColumn.flow_duration;
export const InvalidHeader: Story = { args: { rows: [missingColumn], filename: "missing-column.csv", validation: validateObservationRows([missingColumn]) } };

export const DurableConfiguration: Story = { args: { rows: validRows, filename: "durable-batch.csv", validation: validateObservationRows(validRows), processingMode: "durable" } };
export const ReplayConfiguration: Story = { args: { rows: validRows, filename: "replay-batch.csv", validation: validateObservationRows(validRows), processingMode: "replay", replaySpeed: 4 } };
export const Submitting: Story = { args: { rows: validRows, filename: "review-batch.csv", validation: validateObservationRows(validRows), loading: true } };
export const FailedSubmission: Story = { args: { rows: validRows, filename: "review-batch.csv", validation: validateObservationRows(validRows), error: "The detector did not respond before the request deadline." } };
export const PredictionComplete: Story = {
  args: { rows: [attack], filename: "attack.csv", validation: validateObservationRows([attack]), completedMode: "immediate", response: { predictions: [{ prediction_id: "pred-41", event_id: "evt-41", model_version: "bundle-2026-08", detector_model_version: "binary-hgb-2102398e", classifier_model_version: "multiclass-rf-bfe3010d", binary_prediction: "attack", attack_class: "ARP_poisioning", confidence: .97, detection_score: .97, detection_score_calibrated: true, attack_class_score: .91, attack_class_score_calibrated: true, detector_latency_ms: 1.34, classifier_latency_ms: 2.61, total_latency_ms: 4.28, end_to_end_latency_ms: 6.15, alert_id: "alert-41" }] } },
};
export const DurableComplete: Story = { args: { rows: [normal], filename: "queued.csv", validation: validateObservationRows([normal]), processingMode: "durable", completedMode: "durable", response: { batch_id: "batch-2026-08-11-001", events: [{ event_id: "evt-51", state: "queued", disposition: "accepted" }] } } };
export const ReplayComplete: Story = { args: { rows: validRows, filename: "replay.csv", validation: validateObservationRows(validRows), processingMode: "replay", replaySpeed: 4, completedMode: "replay", response: { status: "running", processed: 0, total: 2, error: null, speed: 4, scenario: "custom", mode: "custom", offset: 0, limit: 2 } } };
export const ReadOnlyFixture: Story = { args: { rows: [normal], filename: "normal-sample.csv", validation: validateObservationRows([normal]), fixtureMode: true } };
export const InteractiveFixture: Story = { render: () => <ObservationLab fixtureMode /> };
