import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    vi.mocked(getOutboxEvents).mockResolvedValue({ items: [
      { outbox_id: "out-1", event_id: "event-1", event_type: "prediction.created", status: "published", publish_attempts: 1, last_error: null, claimed: false, claim_expires_at: null, next_attempt_at: null, created_at: job.created_at, published_at: job.updated_at },
      { outbox_id: "out-2", event_id: "event-2", event_type: "alert.created", status: "pending", publish_attempts: 0, last_error: null, claimed: true, claim_expires_at: job.available_at, next_attempt_at: null, created_at: job.created_at, published_at: null },
      { outbox_id: "out-3", event_id: "event-3", event_type: "prediction.created", status: "failed", publish_attempts: 2, last_error: "stream unavailable", claimed: false, claim_expires_at: null, next_attempt_at: job.available_at, created_at: job.created_at, published_at: null },
    ], total: 3, limit: 20, next_cursor: null });
    vi.mocked(getIngestionEvent).mockResolvedValue({ ...job, transitions: [{ transition_id: "transition-1", from_state: "processing", to_state: "retrying", action: "retry_scheduled", attempt: 2, error_code: "publish_timeout", actor: "worker-a", reason: "Transient failure", created_at: job.updated_at }] });
    vi.mocked(redriveIngestionJobs).mockResolvedValue({ dry_run: true, results: [{ event_id: "event-1", eligible: true, reason: "eligible" }] });
  });

  it("loads exact job evidence and transition history without mutation controls", async () => {
    render(<IngestionOperations fixtureMode={false}/>);
    expect(await screen.findByRole("table", { name: /Ingestion jobs/ })).toBeInTheDocument();
    expect(screen.getByText("publish_timeout")).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: /View history for event event-1/ });
    await userEvent.click(trigger);
    const detail = await screen.findByRole("region", { name: "Job history for event-1" });
    await waitFor(() => expect(detail).toHaveFocus());
    expect(screen.getByRole("table", { name: "Immutable state transitions" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /redrive|retry job/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close history" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("loads independently filtered outbox evidence", async () => {
    render(<IngestionOperations fixtureMode={false}/>);
    await userEvent.click(screen.getByRole("tab", { name: "Outbox" }));
    expect(await screen.findByRole("table", { name: /Outbox delivery events/ })).toBeInTheDocument();
    expect(screen.getAllByText("prediction.created")).toHaveLength(2);
    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.getByText(/Delivering · lease expires/)).toBeInTheDocument();
    expect(screen.getByText(/Retry scheduled/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Event type"), "alert.created");
    await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => expect(getOutboxEvents).toHaveBeenLastCalledWith(expect.objectContaining({ event_type: "alert.created" })));
  });

  it("applies the complete backend job filter contract and reports the active scope", async () => {
    render(<IngestionOperations fixtureMode={false}/>);
    await screen.findByRole("table", { name: /Ingestion jobs/ });
    await userEvent.selectOptions(screen.getByLabelText("State"), "retrying");
    await userEvent.type(screen.getByLabelText("Source"), "sensor-a");
    fireEvent.change(screen.getByLabelText(/Created after/), { target: { value: "2026-08-07T09:00" } });
    fireEvent.change(screen.getByLabelText(/Created before/), { target: { value: "2026-08-07T11:00" } });
    await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() => expect(getIngestionJobs).toHaveBeenLastCalledWith(expect.objectContaining({
      state: "retrying",
      source: "sensor-a",
      created_from: new Date("2026-08-07T09:00").toISOString(),
      created_to: new Date("2026-08-07T11:00").toISOString(),
    })));
    expect(screen.getByText(/state: retrying · source: sensor-a · from/i)).toBeInTheDocument();
  });

  it("rejects an inverted job time range before requesting it", async () => {
    render(<IngestionOperations fixtureMode={false}/>);
    await screen.findByRole("table", { name: /Ingestion jobs/ });
    fireEvent.change(screen.getByLabelText(/Created after/), { target: { value: "2026-08-07T12:00" } });
    fireEvent.change(screen.getByLabelText(/Created before/), { target: { value: "2026-08-07T11:00" } });
    const calls = vi.mocked(getIngestionJobs).mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Created after must be earlier");
    expect(getIngestionJobs).toHaveBeenCalledTimes(calls);
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
    const review = screen.getByRole("button", { name: "Review redrive" });
    await waitFor(() => expect(review).toBeEnabled());
    expect(redriveIngestionJobs).toHaveBeenCalledTimes(1);
    await userEvent.click(review);
    expect(screen.getByRole("region", { name: "Confirm manual redrive" })).toHaveTextContent("service recovered");
    expect(screen.getByRole("button", { name: "Confirm redrive" })).toHaveFocus();
    expect(redriveIngestionJobs).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("region", { name: "Confirm manual redrive" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Review redrive" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm redrive" }));
    await waitFor(() => expect(redriveIngestionJobs).toHaveBeenLastCalledWith(
      ["event-1"], "service recovered", false,
    ));
  });
});
