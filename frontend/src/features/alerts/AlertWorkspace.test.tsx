import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Alert } from "../../types";
import { AlertWorkspace } from "./AlertWorkspace";

const api = vi.hoisted(() => ({
  getAlertsPage: vi.fn(),
  getAlertExplanation: vi.fn(),
  submitAlertFeedback: vi.fn(),
}));

vi.mock("../../api", () => api);

const alert: Alert = {
  id: "alert-1",
  timestamp: "2026-08-10T20:00:00Z",
  attack_type: "NMAP_UDP_SCAN",
  confidence: 0.92,
  severity: "high",
  source_ip: "port 5353",
  destination_ip: "port 5353",
  protocol: "udp",
  status: "new",
};

describe("AlertWorkspace", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState(null, "", "/?view=alerts");
    api.getAlertsPage.mockReset();
    api.getAlertsPage.mockReturnValue(new Promise(() => undefined));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("keeps populated results keyboard-operable while a page refresh is pending", () => {
    const onSelect = vi.fn();
    render(
      <AlertWorkspace
        alerts={[alert]}
        pending={0}
        onSelect={onSelect}
        applyPending={vi.fn()}
      />,
    );

    act(() => vi.advanceTimersByTime(250));

    const region = screen.getByRole("region", { name: "Security alerts" });
    const row = screen.getByRole("row", { name: /Open NMAP_UDP_SCAN alert alert-1/ });
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("table", { name: "Security alerts" })).toBeInTheDocument();

    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(alert);
  });

  it("preserves stale results and retries after a background refresh fails", async () => {
    api.getAlertsPage.mockRejectedValueOnce(new Error("Network unavailable"));
    render(
      <AlertWorkspace
        alerts={[alert]}
        pending={0}
        onSelect={vi.fn()}
        applyPending={vi.fn()}
      />,
    );

    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "showing the last successful results. Network unavailable",
    );
    expect(screen.getByRole("table", { name: "Security alerts" })).toBeInTheDocument();

    api.getAlertsPage.mockReturnValue(new Promise(() => undefined));
    fireEvent.click(screen.getByRole("button", { name: "Retry alerts" }));
    act(() => vi.advanceTimersByTime(250));
    expect(api.getAlertsPage).toHaveBeenCalledTimes(2);
  });
});
