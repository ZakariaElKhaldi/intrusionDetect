import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluationReport, ModelInfo } from "../../types";
import { ModelAnalysis } from "./ModelAnalysis";

const authState = vi.hoisted(() => ({ authenticated: true, openLogin: vi.fn() }));
vi.mock("../../auth", () => ({ useAuth: () => authState }));

const models: ModelInfo[] = [
  { name: "Isolation detector", version: "detector-7", role: "detector", status: "active", probability_calibrated: true, macro_f1: 0.94 },
  { name: "Forest classifier", version: "classifier-4", role: "classifier", status: "active", probability_calibrated: false, macro_f1: 0.88 },
];

describe("ModelAnalysis", () => {
  beforeEach(() => {
    authState.authenticated = true;
    authState.openLogin.mockClear();
  });

  it("does not mount protected model evidence before sign in", () => {
    authState.authenticated = false;
    render(<ModelAnalysis models={[]} />);
    expect(screen.getByRole("note")).toHaveTextContent("Sign in to inspect protected serving, health, and evaluation evidence");
    expect(screen.queryByRole("tab", { name: "Offline evaluation" })).not.toBeInTheDocument();
  });
  it("separates serving evidence from offline evaluation", async () => {
    render(<ModelAnalysis models={models} fixtureMode />);

    expect(screen.getByRole("heading", { name: "Serving bundle" })).toBeInTheDocument();
    expect(screen.getByText("detector-7")).toBeInTheDocument();
    expect(screen.queryByText(/random shared-split evidence/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Offline evaluation" }));
    expect(screen.getByText(/serving descriptors are not reused as benchmark results/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Isolation detector" })).not.toBeInTheDocument();
  });

  it("supports keyboard navigation between workspace views", async () => {
    render(<ModelAnalysis models={models} fixtureMode />);
    const operationsTab = screen.getByRole("tab", { name: "Serving & health" });
    operationsTab.focus();
    await userEvent.keyboard("{ArrowRight}{Enter}");
    expect(screen.getByRole("tab", { name: "Offline evaluation" })).toHaveAttribute("aria-selected", "true");
  });

  it("separates validation selection from held-out evidence and exposes the exact protocol", async () => {
    const report: EvaluationReport = {
      stage: "binary", probability_calibrated: true, evaluation_seeds: [42, 1337, 2026],
      split_definition: { strategy: "shared repeated stratified random", stratified_by: "Attack_type", shuffle: true },
      selected_champion: "Isolation detector", measurement_notes: ["Random-split evidence is not deployment validation."],
      candidates: [{ ...models[0], selected: true, selection_value: 0.95, weighted_f1: 0.96, false_positive_rate: 0.01, inference_ms: 3.2, validation_metrics: { macro_f1: 0.95 }, selection_summary: { mean_validation_macro_f1: 0.95, mean_validation_false_positive_rate: 0.012, mean_p95_inference_latency_ms: 4.8 }, operational_metrics: { p95_inference_latency_ms: 4.4, serialized_model_size_bytes: 4096 }, classes: ["normal", "attack"], confusion_matrix: [[90, 2], [3, 85]], support: { normal: 92, attack: 88 } }],
    };
    render(<ModelAnalysis models={models} fixtureMode initialView="evaluation" initialReports={{ binary: report }}/>);

    expect(screen.getByRole("heading", { name: "What this comparison measures" })).toBeInTheDocument();
    expect(screen.getByText("42 · 1337 · 2026")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Validation selection and held-out test metrics" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Candidate selection aggregates across 3 seeds" })).toBeInTheDocument();
    const splitToggle = screen.getByText("Exact split definition");
    await userEvent.click(splitToggle);
    expect(splitToggle.closest("details")).toHaveTextContent("shared repeated stratified random");
  });
});
