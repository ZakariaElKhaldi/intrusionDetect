import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { sampleAlerts } from "../../data";
import { Overview, type OverviewProps } from "./Overview";
import { connectedDashboardSummary } from "./overviewFixtures";

const callbacks = { onSummaryRange: vi.fn(), onRetrySummary: vi.fn(), onRetry: vi.fn(), onOpenAlert: vi.fn(), onTimeBucket: vi.fn(), onViewAlertQueue: vi.fn() };
function renderOverview(overrides: Partial<OverviewProps> = {}) {
  return render(<Overview alerts={sampleAlerts.slice(0, 8)} fixtureMode={false} socketState="live" lastUpdate={new Date("2026-08-11T13:58:00Z")} livePredictionCount={7} summary={connectedDashboardSummary} {...callbacks} {...overrides}/>);
}

describe("Overview", () => {
  it("uses every persisted summary dimension and keeps browser context separate", () => {
    renderOverview();

    expect(screen.getByText("128 predictions · 42 alerts")).toBeInTheDocument();
    expect(screen.getByText("database grouped")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Persisted workload summary" })).toHaveTextContent("42 attack · 86 normal");
    for (const heading of ["Severity", "Disposition", "Families", "Protocols"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    expect(screen.getByRole("list", { name: "Severity exact counts" })).toHaveTextContent("critical8");
    expect(screen.getByRole("list", { name: "Disposition exact counts" })).toHaveTextContent("false positive3");
    expect(screen.getByText("this browser session")).toBeInTheDocument();
    expect(screen.getByText("cache, not full corpus")).toBeInTheDocument();
  });

  it("pairs the timeline summary with an exact actionable table", async () => {
    const user = userEvent.setup();
    const onTimeBucket = vi.fn();
    renderOverview({ onTimeBucket });

    expect(screen.getByRole("group", { name: /stacked alert counts across 8 persisted time buckets/i })).toBeInTheDocument();
    await user.click(screen.getByText("Inspect and open exact intervals"));
    const table = screen.getByRole("table", { name: /Persisted alert counts by 60-minute interval/ });
    const firstAction = within(table).getAllByRole("button")[0];
    await user.click(firstAction);
    expect(onTimeBucket).toHaveBeenCalledWith("2026-08-11T06:00:00Z", 60);
  });

  it("preserves stale evidence and offers focused retries for summary and alert-cache failures", async () => {
    const user = userEvent.setup();
    const retrySummary = vi.fn();
    const retryAlerts = vi.fn();
    renderOverview({ summaryError: "Summary timed out.", alertsError: "Alert cache timed out.", onRetrySummary: retrySummary, onRetry: retryAlerts });

    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.getByText("128 predictions · 42 alerts")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry summary" }));
    await user.click(screen.getByRole("button", { name: "Retry alerts" }));
    expect(retrySummary).toHaveBeenCalledOnce();
    expect(retryAlerts).toHaveBeenCalledOnce();
  });

  it("distinguishes initial loading from genuine absence", () => {
    renderOverview({ summary: null, summaryLoading: true, alerts: [] });

    expect(screen.getByText("Loading persisted summary…")).toHaveAttribute("role", "status");
    expect(screen.queryByRole("region", { name: "Persisted workload summary" })).not.toBeInTheDocument();
    expect(screen.queryByText("No unresolved alerts in this persisted window")).not.toBeInTheDocument();
  });

  it("keeps fixture records outside the persisted timeline contract", () => {
    renderOverview({ fixtureMode: true, summary: null, socketState: "offline", livePredictionCount: 0 });

    expect(screen.getByText(/Generated alert records demonstrate layout/i)).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("not projected onto a fabricated persisted timeline");
    expect(screen.queryByText("Exact summary provenance")).not.toBeInTheDocument();
  });

  it("hands off to the complete alert queue", async () => {
    const user = userEvent.setup();
    const onViewAlertQueue = vi.fn();
    renderOverview({ onViewAlertQueue });
    await user.click(screen.getByRole("button", { name: /Open full queue/ }));
    expect(onViewAlertQueue).toHaveBeenCalledOnce();
  });
});
