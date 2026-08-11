import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Alert, AlertExplanationStage } from "../../types";
import { AlertInvestigationView, chartContributions } from "./AlertInvestigationDrawer";

const alert: Alert = {
  id: "alert-1",
  event_id: "event-1",
  timestamp: "2026-08-11T10:00:00Z",
  attack_type: "Port scan",
  binary_prediction: "attack",
  attack_class: "Port scan",
  confidence: 0.92,
  detection_score: 0.92,
  attack_class_score: 0.81,
  severity: "high",
  source_ip: "10.0.0.4",
  destination_ip: "10.0.0.8",
  protocol: "TCP",
  status: "new",
  identity_quality: "explicit",
  detector_model_version: "detector-v2",
  classifier_model_version: "classifier-v2",
  network_context: {
    source_ip: "10.0.0.4",
    destination_ip: "10.0.0.8",
    source_port: 44000,
    destination_port: 443,
    protocol: "tcp",
    interface: "sensor-a",
    capture_id: "capture-1",
    extractor_fingerprint: "extractor-1",
  },
  features: { packet_rate: 90, flow_duration: 1200 },
  feedback: [],
};

const explanation: AlertExplanationStage = {
  stage: "binary",
  model_version: "detector-v2",
  explained_class: "attack",
  base_value: 0.2,
  output_value: 0.79,
  method: "SHAP TreeExplainer",
  output_units: "raw output",
  contributions: [
    { feature: "tiny-positive", impact: 0.01 },
    { feature: "largest", impact: 0.4 },
    { feature: "negative", impact: -0.2 },
    { feature: "middle", impact: 0.15 },
    { feature: "a", impact: 0.08 },
    { feature: "b", impact: 0.06 },
    { feature: "c", impact: 0.04 },
    { feature: "d", impact: 0.03 },
    { feature: "small-negative", impact: -0.02 },
    { feature: "smallest", impact: 0.04 },
  ],
};

describe("AlertInvestigationView", () => {
  it("organizes triage, model evidence, and record provenance as keyboard tabs", () => {
    render(<AlertInvestigationView alert={alert} onClose={vi.fn()} readOnly />);

    expect(screen.getByRole("dialog", { name: "Port scan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close alert details" })).toHaveFocus();
    expect(screen.getByText("Observed communication")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Record data" }));
    expect(screen.getByText("Record provenance")).toBeInTheDocument();
    expect(screen.getByText("event-1")).toBeInTheDocument();
    expect(screen.getByText("extractor-1")).toBeInTheDocument();
  });

  it("requires reasoning and confirmation before a terminal disposition", async () => {
    const onDisposition = vi.fn().mockResolvedValue({
      feedback_id: "feedback-1",
      alert_id: alert.id,
      analyst: "operator",
      status: "false_positive",
      notes: "Approved scanner activity",
      created_at: "2026-08-11T10:05:00Z",
    });
    render(<AlertInvestigationView alert={alert} onClose={vi.fn()} onDisposition={onDisposition} />);

    fireEvent.change(screen.getByLabelText("Next disposition"), { target: { value: "false_positive" } });
    fireEvent.click(screen.getByRole("button", { name: "Review decision" }));
    expect(screen.getByRole("alert")).toHaveTextContent("at least 8 characters");

    fireEvent.change(screen.getByRole("textbox", { name: /Investigation reasoning/ }), { target: { value: "Approved scanner activity" } });
    fireEvent.click(screen.getByRole("button", { name: "Review decision" }));
    expect(screen.getByRole("group", { name: "Confirm analyst disposition" })).toHaveTextContent("new → false positive");
    fireEvent.click(screen.getByRole("button", { name: "Confirm and record" }));

    await waitFor(() => expect(onDisposition).toHaveBeenCalledWith("false_positive", "Approved scanner activity"));
    expect(await screen.findByRole("status")).toHaveTextContent("immutable feedback history");
    expect(screen.getByText("Approved scanner activity")).toBeInTheDocument();
  });

  it("builds the chart remainder from the same absolute-impact ordering as the visible features", () => {
    const result = chartContributions(explanation.contributions, 8);

    expect(result.sorted.slice(0, 3).map((item) => item.feature)).toEqual(["largest", "negative", "middle"]);
    expect(result.chart.at(-1)).toEqual({ feature: "Other 2 features", impact: -0.01 });
  });

  it("provides complete exact explanation evidence and recovery from explanation failure", () => {
    const retry = vi.fn();
    const { rerender } = render(<AlertInvestigationView alert={alert} onClose={vi.fn()} initialView="model" explanations={[explanation]} explanationState="ready" />);

    expect(screen.getByRole("region", { name: "Exact signed feature contributions" })).toBeInTheDocument();
    expect(screen.getByText("All contributions ordered by absolute impact")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(explanation.contributions.length + 1);

    rerender(<AlertInvestigationView alert={alert} onClose={vi.fn()} initialView="model" explanations={[]} explanationState="error" explanationError="Historical artifacts unavailable" onRetryExplanation={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Historical artifacts unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry explanation" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("closes with Escape", () => {
    const onClose = vi.fn();
    render(<AlertInvestigationView alert={alert} onClose={onClose} readOnly />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
