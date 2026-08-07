import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getModelHealth, getModelHealthHistory } from "../../api";
import { ModelHealth } from "./ModelHealth";

vi.mock("../../api", () => ({ getModelHealth: vi.fn(), getModelHealthHistory: vi.fn() }));

describe("ModelHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getModelHealth).mockResolvedValue({
      status: "warning", reason: "Feature shift exceeds the warning threshold.", window: "fast",
      cohort: { source: "sensor-a" }, reference: { dataset: "RT-IoT2022" }, observation_count: 250,
      aggregate: { score: 0.18, threshold: 0.15 },
      features: [{ feature: "flow_duration", status: "warning", score: 0.22, threshold: 0.2, method: "PSI" }],
      unseen_categories: [{ feature: "service", value: "custom" }], outputs: { attack_rate: 0.12 },
      quality: { invalid_rows: 0 }, performance: { p95_latency_ms: 4.2 }, checked_at: "2026-08-07T10:00:00Z", shadow_mode: true,
    });
    vi.mocked(getModelHealthHistory).mockResolvedValue({ items: [{ checked_at: "2026-08-07T10:00:00Z", status: "warning", observation_count: 250, aggregate_score: 0.18, aggregate_threshold: 0.15 }] });
  });

  it("shows state, reason, exact evidence tables, and history", async () => {
    render(<ModelHealth fixtureMode={false}/>);
    expect(await screen.findByText("Feature shift exceeds the warning threshold.")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Per-feature model-health evidence" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Recent model-health history" })).toBeInTheDocument();
    expect(screen.getAllByText("250").length).toBeGreaterThan(0);
    expect(screen.getByText("flow_duration")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retrain|promote|threshold/i })).not.toBeInTheDocument();
  });

  it("changes monitoring windows without changing model state", async () => {
    render(<ModelHealth fixtureMode={false}/>);
    await screen.findByText("Feature shift exceeds the warning threshold.");
    await userEvent.click(screen.getByRole("tab", { name: "Slow window" }));
    expect(getModelHealth).toHaveBeenLastCalledWith(expect.objectContaining({ window: "slow" }));
  });

  it("keeps fixture evidence separate", () => {
    render(<ModelHealth fixtureMode/>);
    expect(screen.getByRole("note")).toHaveTextContent("no model-health cohort");
    expect(getModelHealth).not.toHaveBeenCalled();
  });
});
