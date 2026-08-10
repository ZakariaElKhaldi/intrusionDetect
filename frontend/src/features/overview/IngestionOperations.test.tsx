import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getIngestionEvent, getIngestionJobs, getOutboxEvents, redriveIngestionJobs } from "../../api";
import { IngestionOperations } from "./IngestionOperations";

vi.mock("../../api", () => ({
  getIngestionJobs: vi.fn(),
  getIngestionEvent: vi.fn(),
  getOutboxEvents: vi.fn(),
  redriveIngestionJobs: vi.fn(),
}));
vi.mock("../../auth", () => ({ useAuth: () => ({ authenticated: true, openLogin: vi.fn() }) }));

const job = {
  event_id: "event-1", batch_id: "batch-1", state: "retrying" as const, attempts: 2,
  error_code: "publish_timeout", retryable: true, redrive_count: 0, source: "sensor-a",
  schema_version: "rt-iot2022-v1", extractor_fingerprint: "extractor-1",
  created_at: "2026-08-07T10:00:00Z", updated_at: "2026-08-07T10:01:00Z",
  available_at: "2026-08-07T10:02:00Z", completed_at: null, last_error: "Timed out",
};

describe("IngestionOperations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getIngestionJobs).mockResolvedValue({ items: [job], total: 1, limit: 20, next_cursor: null });
    vi.mocked(getOutboxEvents).mockResolvedValue({ items: [{ outbox_id: "out-1", event_id: "event-1", event_type: "prediction.created", status: "published", publish_attempts: 1, last_error: null, created_at: job.created_at, published_at: job.updated_at }], total: 1, limit: 20, next_cursor: null });
    vi.mocked(getIngestionEvent).mockResolvedValue({ ...job, transitions: [{ transition_id: "transition-1", from_state: "processing", to_state: "retrying", action: "retry_scheduled", attempt: 2, error_code: "publish_timeout", actor: "worker-a", reason: "Transient failure", created_at: job.updated_at }] });
    vi.mocked(redriveIngestionJobs).mockResolvedValue({ dry_run: true, results: [{ event_id: "event-1", eligible: true, reason: "eligible" }] });
  });

  it("loads exact job evidence and transition history without mutation controls", async () => {
    render(<IngestionOperations fixtureMode={false}/>);
    expect(await screen.findByRole("table", { name: /Ingestion jobs/ })).toBeInTheDocument();
    expect(screen.getByText("publish_timeout")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /View history for event event-1/ }));
    expect(await screen.findByRole("region", { name: "Job history for event-1" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Immutable state transitions" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /redrive|retry job/i })).not.toBeInTheDocument();
  });

  it("loads independently filtered outbox evidence", async () => {
    render(<IngestionOperations fixtureMode={false}/>);
    await userEvent.click(screen.getByRole("tab", { name: "Outbox" }));
    expect(await screen.findByRole("table", { name: /Outbox delivery events/ })).toBeInTheDocument();
    expect(screen.getByText("prediction.created")).toBeInTheDocument();
  });

  it("does not request live operational evidence in fixture mode", async () => {
    render(<IngestionOperations fixtureMode/>);
    expect(screen.getByRole("note")).toHaveTextContent("no operational queue evidence");
    await waitFor(() => expect(getIngestionJobs).not.toHaveBeenCalled());
  });

  it("previews an eligible dead-letter before enabling redrive", async () => {
    const dead = { ...job, state: "dead_letter" as const, retryable: true };
    vi.mocked(getIngestionJobs).mockResolvedValue({ items: [dead], total: 1, limit: 20, next_cursor: null });
    vi.mocked(getIngestionEvent).mockResolvedValue({ ...dead, transitions: [] });
    render(<IngestionOperations fixtureMode={false}/>);
    await userEvent.click(await screen.findByRole("button", { name: /View history/ }));
    await userEvent.type(await screen.findByLabelText("Operator reason"), "service recovered");
    await userEvent.click(screen.getByRole("button", { name: "Check eligibility" }));
    expect(await screen.findByText("Eligible for transactional redrive.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Redrive job" })).toBeEnabled();
  });
});
