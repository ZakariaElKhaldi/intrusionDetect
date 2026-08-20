import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplayStatus } from "../../types";
import { ReplayPanel, type ReplayPanelProps } from "./ReplayPanel";

const running: ReplayStatus = {
  status: "running", processed: 42, total: 120, error: null, speed: 2,
  scenario: "attack", mode: "dataset", offset: 25, limit: 120,
};
const callbacks = {
  onScenario: vi.fn(), onSpeed: vi.fn(), onOffset: vi.fn(), onLimit: vi.fn(),
  onPrimary: vi.fn(), onStop: vi.fn(), onRetry: vi.fn(),
};

function renderPanel(overrides: Partial<ReplayPanelProps> = {}) {
  return render(<ReplayPanel
    replay={null} scenario="attack" speed={1} offset={0} limit={40} error=""
    {...callbacks} {...overrides}
  />);
}

describe("ReplayPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("puts the frequent replay controls in the header and keeps backend input ranges available", () => {
    renderPanel();

    expect(screen.getByRole("heading", { name: "Traffic replay" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Replay scenario" })).toHaveValue("attack");
    expect(screen.getByText("250.0 ms / event")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Replay speed" })).toHaveAttribute("max", "100");
    expect(screen.getByRole("spinbutton", { name: "Replay limit" })).toHaveAttribute("max", "1000000");
    expect(screen.getByText(/skipped before scenario filtering/i)).toBeInTheDocument();
    expect(screen.getByText(/creates a persisted prediction/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start replay" })).toBeEnabled();
  });

  it("identifies invalid fields in text and blocks the mutation", () => {
    renderPanel({ speed: 0, offset: -1, limit: 1_000_001 });

    expect(screen.getByText(/speed above 0/i)).toBeInTheDocument();
    expect(screen.getByText(/whole dataset row of 0 or greater/i)).toBeInTheDocument();
    expect(screen.getByText(/limit from 1 through 1,000,000/i)).toBeInTheDocument();
    expect(screen.getAllByRole("spinbutton").every((input) => input.getAttribute("aria-invalid") === "true")).toBe(true);
    expect(screen.getByRole("button", { name: "Start replay" })).toBeDisabled();
  });

  it("keeps the server snapshot distinct from local configuration", () => {
    renderPanel({ replay: running, scenario: "normal", speed: 8, offset: 0, limit: 500 });

    expect(screen.getByRole("status")).toHaveTextContent("Running");
    expect(screen.getByText("42 processed · 78 remaining")).toBeInTheDocument();
    expect(screen.getByText("2×")).toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause replay" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "Replay scenario" })).toBeDisabled();
  });

  it("reviews the irreversible remainder before stopping and restores focus on cancel", async () => {
    const user = userEvent.setup();
    renderPanel({ replay: running });

    const review = screen.getByRole("button", { name: "Review stop" });
    await user.click(review);
    const confirm = screen.getByRole("button", { name: "Confirm stop" });
    expect(confirm).toHaveFocus();
    expect(screen.getByText(/78 unprocessed observations will not be emitted/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue run" }));
    expect(screen.getByRole("button", { name: "Review stop" })).toHaveFocus();
    expect(callbacks.onStop).not.toHaveBeenCalled();
  });

  it("allows a paused replay speed correction and exposes stale status recovery", async () => {
    const user = userEvent.setup();
    renderPanel({ replay: { ...running, status: "paused" }, error: "Status request timed out." });

    expect(screen.getByText("Replay status may be stale")).toBeInTheDocument();
    const speed = screen.getByRole("spinbutton", { name: "Replay speed" });
    expect(speed).toBeEnabled();
    await user.clear(speed);
    await user.type(speed, "12");
    expect(callbacks.onSpeed).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Retry status" }));
    expect(callbacks.onRetry).toHaveBeenCalledOnce();
  });

  it("names each failed readiness dependency instead of presenting a generic disabled control", () => {
    renderPanel({ disabled: true, unavailableReasons: ["Dataset is blocked: checksum mismatch.", "Database is unavailable."] });

    expect(screen.getByText("Dataset is blocked: checksum mismatch.")).toBeInTheDocument();
    expect(screen.getByText("Database is unavailable.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start replay" })).toBeDisabled();
  });
});
