import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { verifiedNormalObservationCsv } from "../../sampleObservation";
import { parseCsv } from "../../utils";
import { ObservationLabView, type ObservationLabViewProps } from "./ObservationLabView";
import { validateObservationRows } from "./observationValidation";

const row = parseCsv(verifiedNormalObservationCsv)[0];
const callbacks = {
  onFile: vi.fn(), onLoadNormal: vi.fn(), onLoadAttack: vi.fn(), onProcessingMode: vi.fn(),
  onReplaySpeed: vi.fn(), onRun: vi.fn(), onClear: vi.fn(),
};

function renderView(overrides: Partial<ObservationLabViewProps> = {}) {
  const rows = overrides.rows ?? [];
  return render(<ObservationLabView
    rows={rows}
    filename=""
    validation={validateObservationRows(rows)}
    processingMode="immediate"
    replaySpeed={1}
    {...callbacks}
    {...overrides}
  />);
}

describe("ObservationLabView", () => {
  it("offers a labelled native file control and explains the inactive boundary", () => {
    renderView();

    expect(screen.getByLabelText("RT-IoT2022 CSV file")).toHaveAttribute("type", "file");
    expect(screen.getByText(/Validation remains local until submission/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyze 0 rows" })).toBeDisabled();
  });

  it("previews a valid file and exposes all three operational effects", async () => {
    const user = userEvent.setup();
    renderView({ rows: [row], filename: "review.csv", validation: validateObservationRows([row]) });

    expect(screen.getByText("83 feature names in canonical order")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Observation sample preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyze 1 row" })).toBeEnabled();
    await user.click(screen.getByRole("radio", { name: /Replay as live traffic/ }));
    expect(callbacks.onProcessingMode).toHaveBeenCalledWith("replay");
  });

  it("blocks submission and names the invalid row and feature", () => {
    const invalid = { ...row, flow_duration: Number.NaN };
    renderView({ rows: [invalid], filename: "invalid.csv", validation: validateObservationRows([invalid]) });

    expect(screen.getByText(/Row 1, flow_duration/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyze 1 row" })).toBeDisabled();
  });

  it("supports the backend replay-speed range while preserving a clear fixture boundary", async () => {
    const user = userEvent.setup();
    renderView({
      rows: [row], filename: "replay.csv", validation: validateObservationRows([row]),
      processingMode: "replay", replaySpeed: 4, fixtureMode: true,
    });

    const speed = screen.getByRole("spinbutton", { name: "Replay speed" });
    expect(speed).toHaveAttribute("max", "100");
    await user.clear(speed);
    await user.type(speed, "12");
    expect(callbacks.onReplaySpeed).toHaveBeenCalled();
    expect(screen.getByText(/Fixture preview validates files locally/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start 1-row replay" })).toBeDisabled();
  });
});
