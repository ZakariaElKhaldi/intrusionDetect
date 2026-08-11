import type { Meta, StoryObj } from "@storybook/react-vite";
import type { EvaluationCandidate, EvaluationReport, ModelInfo } from "../../types";
import { ModelAnalysis } from "./ModelAnalysis";
import { ModelEvaluationView } from "./ModelEvaluationView";

const models: ModelInfo[] = [
  { name: "Calibrated forest", version: "detector-2026.08.4", role: "detector", status: "active", probability_calibrated: true, schema_version: "rt-iot2022-v1", artifact_registered: true, macro_f1: 0.947, weighted_f1: 0.982, false_positive_rate: 0.013, inference_ms: 3.8 },
  { name: "Attack family forest", version: "classifier-2026.08.2", role: "classifier", status: "active", probability_calibrated: false, schema_version: "rt-iot2022-v1", artifact_registered: true, macro_f1: 0.921, weighted_f1: 0.954, inference_ms: 4.6 },
];

const detectorCandidates: EvaluationCandidate[] = [
  { ...models[0], selected: true, selection_value: 0.947, validation_metrics: { macro_f1: 0.947 }, operational_metrics: { p95_inference_latency_ms: 5.2, serialized_model_size_bytes: 124123 }, selection_summary: { mean_validation_macro_f1: 0.947, mean_validation_false_positive_rate: 0.012, mean_p95_inference_latency_ms: 5.4 }, classes: ["normal", "attack"], confusion_matrix: [[930, 18], [24, 428]], support: { normal: 948, attack: 452 } },
  { name: "Linear baseline", version: "evaluation-only", role: "candidate", status: "candidate", macro_f1: 0.901, weighted_f1: 0.942, false_positive_rate: 0.026, inference_ms: 1.4, selection_value: 0.894, validation_metrics: { macro_f1: 0.894 }, operational_metrics: { p95_inference_latency_ms: 2.1, serialized_model_size_bytes: 18432 }, selection_summary: { mean_validation_macro_f1: 0.894, mean_validation_false_positive_rate: 0.028, mean_p95_inference_latency_ms: 2.2 }, classes: ["normal", "attack"], confusion_matrix: [[918, 30], [41, 411]], support: { normal: 948, attack: 452 } },
];

const detectorReport: EvaluationReport = {
  stage: "binary", probability_calibrated: true, selected_champion: "Calibrated forest", evaluation_seeds: [42, 1337, 2026],
  split_definition: { population: "all rows", strategy: "shared repeated stratified random", stratified_by: "original 12-label Attack_type", shuffle: true },
  candidates: detectorCandidates, measurement_notes: ["Candidate selection aggregates the declared random seeds; displayed test metrics use the promoted seed.", "Random-split evidence is not deployment validation."],
  threshold_analysis: { operating_threshold: 0.5, partition_rows: 47166, selection_policy: "Current threshold retained after validation review", points: [{ threshold: 0.2, recall: 0.99, precision: 0.91, false_positive_rate: 0.08, alert_rate: 0.39 }, { threshold: 0.5, recall: 0.95, precision: 0.96, false_positive_rate: 0.013, alert_rate: 0.34 }, { threshold: 0.8, recall: 0.81, precision: 0.99, false_positive_rate: 0.003, alert_rate: 0.28 }] },
  cascade_evaluation: { protocol: "Detector followed by family classifier on the untouched shared test partition.", test_rows: 1400, detector_false_negatives: 24, detector_routed_rows: 446, metrics: { macro_f1: 0.89 }, classes: ["normal", "scan", "dos"], confusion_matrix: [[930, 12, 6], [18, 192, 4], [6, 5, 227]], class_support: { normal: 948, scan: 214, dos: 238 } },
};

const classifierCandidates: EvaluationCandidate[] = [
  { ...models[1], selected: true, selection_value: 0.921, validation_metrics: { macro_f1: 0.921 }, operational_metrics: { p95_inference_latency_ms: 6.8, serialized_model_size_bytes: 183442 }, selection_summary: { mean_validation_macro_f1: 0.921, mean_p95_inference_latency_ms: 7.1 }, classes: ["scan", "dos", "brute force"], confusion_matrix: [[178, 4, 2], [3, 221, 1], [2, 1, 7]], support: { scan: 184, dos: 225, "brute force": 10 } },
  { name: "Nearest-neighbor baseline", version: "evaluation-only", role: "candidate", status: "candidate", macro_f1: 0.84, weighted_f1: 0.9, inference_ms: 12.6, selection_value: 0.831, validation_metrics: { macro_f1: 0.831 }, operational_metrics: { p95_inference_latency_ms: 18.4, serialized_model_size_bytes: 284100 }, selection_summary: { mean_validation_macro_f1: 0.831, mean_p95_inference_latency_ms: 19.2 } },
];
const classifierReport: EvaluationReport = { stage: "multiclass", probability_calibrated: false, selected_champion: "Attack family forest", evaluation_seeds: [42, 1337, 2026], split_definition: detectorReport.split_definition, candidates: classifierCandidates, measurement_notes: ["Numeric classifier outputs are not declared calibrated probabilities.", "Rare attack families have limited held-out support."] };

const meta = {
  title: "Workspaces/Models/Model analysis",
  component: ModelAnalysis,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen", docs: { description: { component: "Separates runtime descriptors and production monitoring from protocol-bound offline evaluation. Serving descriptors are never substituted for missing benchmark evidence." } } },
  decorators: [(Story) => <main style={{ padding: 20, background: "#eceeeb", minHeight: "100vh" }}><Story/></main>],
  args: { models, fixtureMode: true, descriptorLoading: false, descriptorError: "" },
} satisfies Meta<typeof ModelAnalysis>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ServingAndHealth: Story = {};
export const DescriptorLoading: Story = { args: { models: [], descriptorLoading: true } };
export const DescriptorFailure: Story = { args: { models: [], descriptorError: "Serving model descriptors are unavailable." } };
export const EvaluationFixtureBoundary: Story = { args: { initialView: "evaluation" } };
export const DetectorEvaluation: Story = { args: { initialView: "evaluation", initialReports: { binary: detectorReport } } };
export const ClassifierEvaluation: Story = { args: { initialView: "evaluation", initialStage: "multiclass", initialReports: { multiclass: classifierReport } } };
export const EmptyEvaluation: Story = { args: { initialView: "evaluation", initialReports: { binary: { ...detectorReport, candidates: [] } } } };
export const EvaluationLoading: Story = { render: () => <ModelEvaluationView stage="binary" report={null} loading/> };
export const EvaluationUnavailable: Story = { render: () => <ModelEvaluationView stage="binary" report={null} error="The evaluation registry did not respond."/> };
