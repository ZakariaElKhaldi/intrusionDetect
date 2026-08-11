import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { IngestionStatus } from "../../types";
import { IngestionStatusPanel } from "./IngestionStatusPanel";

const healthy: IngestionStatus = {
  queue_depth: 0,
  queued: 0,
  processing: 0,
  retrying: 0,
  succeeded: 120,
  dead_letter: 0,
  retries: 2,
  failures: 0,
  oldest_pending_age_seconds: null,
  throughput_per_minute: 18.5,
  worker: { status: "ready", reason: "Heartbeat current", last_heartbeat_at: "2026-08-07T10:00:00Z" },
  outbox: { status: "ready", reason: "Drained", pending: 0, published: 120, oldest_pending_age_seconds: null },
  generated_at: "2026-08-07T10:00:01Z",
};

describe("IngestionStatusPanel", () => {
  it("shows exact queue, throughput, retry, delivery, and worker evidence", () => {
    render(<IngestionStatusPanel status={healthy} loading={false} error="" fixtureMode={false} onRetry={vi.fn()}/>);
    expect(screen.getByText("Idle and ready")).toBeInTheDocument();
    expect(screen.getByText("18.5/min")).toBeInTheDocument();
    expect(screen.getByText("2 total retries")).toBeInTheDocument();
    expect(screen.getByText(/120 published/)).toBeInTheDocument();
    expect(screen.getByText("ready")).toBeInTheDocument();
  });

  it.each([
    [{ ...healthy, queue_depth: 8, oldest_pending_age_seconds: 75 }, "Queue backlog", "backlogged"],
    [{ ...healthy, retrying: 1 }, "Jobs retrying", "retrying"],
    [{ ...healthy, dead_letter: 2, failures: 2 }, "Dead-letter jobs need attention", "dead_letter"],
    [{ ...healthy, worker: { ...healthy.worker, status: "blocked" } }, "Worker offline", "offline"],
  ] as const)("announces actionable pipeline states", (status, label, state) => {
    render(<IngestionStatusPanel status={status} loading={false} error="" fixtureMode={false} onRetry={vi.fn()}/>);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Ingestion pipeline" })).toHaveAttribute("data-ingestion-state", state);
  });

  it("keeps the last snapshot visible when refresh fails", () => {
    render(<IngestionStatusPanel status={healthy} loading={false} error="Network request failed." fixtureMode={false} onRetry={vi.fn()}/>);
    expect(screen.getByRole("alert")).toHaveTextContent("showing the last successful snapshot");
    expect(screen.getByText("18.5/min")).toBeInTheDocument();
  });

  it("does not imply connected queue evidence in fixture mode", () => {
    render(<IngestionStatusPanel status={null} loading={false} error="" fixtureMode onRetry={vi.fn()}/>);
    expect(screen.getByRole("note")).toHaveTextContent("No ingestion request was made");
  });

  it("offers a retry when ingestion is offline", async () => {
    const retry = vi.fn();
    render(<IngestionStatusPanel status={null} loading={false} error="Network request failed." fixtureMode={false} onRetry={retry}/>);
    await userEvent.click(screen.getByRole("button", { name: "Retry ingestion status" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
