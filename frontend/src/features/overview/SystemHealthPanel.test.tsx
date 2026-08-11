import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { HealthInfo } from "../../types";
import { SystemHealthPanel } from "./SystemHealthPanel";

const ready: HealthInfo = {
  status: "ok", readiness: "ready", schema_version: "rt-iot2022-v1", model_version: "bundle-7",
  detector_model_version: "detector-7", classifier_model_version: "classifier-4", live_connections: 2,
  detector_probability_calibrated: true, classifier_probability_calibrated: false,
  dataset_ready: true, dataset_checksum: "abc123", production_bundle_valid: true, fallback: false,
  components: {
    api: { status: "ready", reason: "HTTP API is serving requests" },
    database: { status: "ready", reason: "Connectivity check passed" },
    bundle: { status: "ready", reason: "Promoted artifacts are active" },
    dataset: { status: "ready", reason: "Validated replay dataset is available" },
  },
};

describe("SystemHealthPanel", () => {
  it("shows readiness and core states before exact component evidence", async () => {
    render(<SystemHealthPanel health={ready} socketState="live" lastUpdate={new Date("2026-08-11T12:00:00Z")} fixtureMode={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("ready");
    expect(screen.queryByText("Current assessment")).not.toBeInTheDocument();
    expect(screen.getByText("Live stream").nextElementSibling).toHaveTextContent("live");
    const table = screen.getByRole("table", { name: "Runtime component evidence" });
    expect(table.closest("details")).not.toHaveAttribute("open");
    await userEvent.click(screen.getByText("Component and artifact evidence"));
    expect(table.closest("details")).toHaveAttribute("open");
    expect(screen.getByText("Connectivity check passed")).toBeInTheDocument();
  });

  it("prioritizes degraded and blocked components", () => {
    const degraded: HealthInfo = { ...ready, readiness: "degraded", components: { ...ready.components, database: { status: "blocked", reason: "Database connectivity check failed" }, worker: { status: "degraded", reason: "Heartbeat is stale" } } };
    render(<SystemHealthPanel health={degraded} socketState="offline" lastUpdate={null} fixtureMode={false} />);
    expect(screen.getByText("2 reported components need review")).toBeInTheDocument();
    expect(screen.getAllByText(/Database connectivity check failed/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Heartbeat is stale/).length).toBeGreaterThan(0);
  });

  it("does not invent connected health in fixture mode", () => {
    render(<SystemHealthPanel health={null} socketState="offline" lastUpdate={null} fixtureMode />);
    expect(screen.getByRole("status")).toHaveTextContent("fixture");
    expect(screen.getAllByText("not reported").length).toBeGreaterThan(0);
  });
});
