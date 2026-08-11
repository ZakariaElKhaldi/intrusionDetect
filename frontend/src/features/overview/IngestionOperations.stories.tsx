import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PanelHeading } from "../../components/PanelHeading";
import type { IngestionJob, IngestionJobDetail, OutboxEvent } from "../../types";
import { IngestionOperations } from "./IngestionOperations";
import { IngestionJobDetailView, IngestionJobsView, OutboxEventsView } from "./IngestionOperationsView";

const meta = {
  title: "Workspaces/Overview/Ingestion operations",
  component: IngestionOperations,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Durable ingestion and transactional-outbox evidence, including an authenticated preview-and-confirm recovery workflow for eligible dead letters." } } },
  args: { fixtureMode: true },
} satisfies Meta<typeof IngestionOperations>;

export default meta;
type Story = StoryObj<typeof meta>;

const time = "2026-08-07T10:01:00Z";
const retryAt = "2026-08-07T10:06:00Z";
const baseJob: IngestionJob = {
  event_id: "event-6e92", batch_id: "batch-14", state: "retrying", attempts: 2,
  error_code: "stream_timeout", retryable: true, redrive_count: 0, source: "edge-gateway-c",
  schema_version: "rt-iot2022-v1", extractor_fingerprint: "sha256:6a04c2",
  created_at: "2026-08-07T09:58:00Z", updated_at: time, available_at: retryAt,
  lease_expires_at: null, completed_at: null, last_error: "Publisher did not acknowledge before timeout",
};
const jobs: IngestionJob[] = [
  baseJob,
  { ...baseJob, event_id: "event-a150", state: "processing", attempts: 1, error_code: null, last_error: null, lease_expires_at: retryAt, available_at: time, source: "edge-gateway-a" },
  { ...baseJob, event_id: "event-c911", state: "dead_letter", attempts: 5, error_code: "model_route_missing", retryable: false, last_error: "Persisted model route is unavailable", available_at: time, source: "archive-import" },
  { ...baseJob, event_id: "event-b380", state: "succeeded", attempts: 1, error_code: null, retryable: false, last_error: null, available_at: time, completed_at: time, source: "edge-gateway-b" },
];
const outbox: OutboxEvent[] = [
  { outbox_id: "outbox-101", event_id: "event-b380", event_type: "prediction.created", status: "published", publish_attempts: 1, last_error: null, claimed: false, claim_expires_at: null, next_attempt_at: null, created_at: time, published_at: retryAt },
  { outbox_id: "outbox-102", event_id: "event-a150", event_type: "alert.created", status: "pending", publish_attempts: 1, last_error: null, claimed: true, claim_expires_at: retryAt, next_attempt_at: null, created_at: time, published_at: null },
  { outbox_id: "outbox-103", event_id: "event-6e92", event_type: "prediction.created", status: "failed", publish_attempts: 3, last_error: "Stream unavailable", claimed: false, claim_expires_at: null, next_attempt_at: retryAt, created_at: time, published_at: null },
];
const deadLetter: IngestionJobDetail = {
  ...baseJob, event_id: "event-c911", state: "dead_letter", attempts: 5, error_code: "model_route_missing", retryable: false, last_error: "Persisted model route is unavailable", available_at: time, source: "archive-import", model_version: "detector-4.2", last_redriven_at: null, last_redriven_by: null, last_redrive_reason: null,
  transitions: [{ transition_id: "transition-52", from_state: "processing", to_state: "dead_letter", reason_code: "attempts_exhausted", error_code: "model_route_missing", retryable: false, worker_id: "worker-3", operator: null, reason: "Persisted model route could not be loaded", details: { requested_model: "detector-4.2", max_attempts: 5 }, occurred_at: time, action: "dead_lettered", attempt: 5, actor: "worker-3", created_at: time }],
};
const recovered: IngestionJobDetail = {
  ...baseJob, state: "queued", redrive_count: 1, model_version: "detector-4.2", last_redriven_at: time, last_redriven_by: "ops.mina", last_redrive_reason: "Model route restored after deployment rollback",
  transitions: [{ transition_id: "transition-53", from_state: "dead_letter", to_state: "queued", reason_code: "manual_redrive", error_code: null, retryable: true, worker_id: null, operator: "ops.mina", reason: "Model route restored after deployment rollback", details: { dry_run_verified: true }, occurred_at: time, action: "redriven", attempt: 5, actor: "ops.mina", created_at: time }],
};

function Frame({ children }: { children: ReactNode }) {
  return <section className="panel operations-panel"><PanelHeading eyebrow="Operational evidence" title="Ingestion operations" description="Investigate durable jobs and committed publication. Authenticated operators can safely redrive eligible dead letters after review."/>{children}</section>;
}

export const FixtureBoundary: Story = {};

export const JobQueuePopulated: Story = {
  render: () => <Frame><IngestionJobsView page={{ items: jobs, total: 47, limit: 20, next_cursor: "next-page" }} previous onInspect={() => undefined}/></Frame>,
};

export const JobQueueEmpty: Story = {
  render: () => <Frame><IngestionJobsView page={{ items: [], total: 0, limit: 20, next_cursor: null }} onInspect={() => undefined}/></Frame>,
};

export const OutboxDeliveryMixed: Story = {
  render: () => <Frame><OutboxEventsView page={{ items: outbox, total: 112, limit: 20, next_cursor: "next-page" }}/></Frame>,
};

export const DeadLetterInvestigation: Story = {
  parameters: { docs: { description: { story: "Interactive safe-recovery path: enter a reason, check eligibility, review the exact action, then confirm." } } },
  render: () => <Frame><IngestionJobDetailView job={deadLetter} authenticated onAuthenticate={() => undefined} onClose={() => undefined} previewRedrive={async (eventId) => ({ event_id: eventId, eligible: true, reason: "compatible" })} executeRedrive={async () => undefined} onChanged={async () => undefined}/></Frame>,
};

export const AuthenticationBoundary: Story = {
  render: () => <Frame><IngestionJobDetailView job={deadLetter} authenticated={false} onAuthenticate={() => undefined} onClose={() => undefined} previewRedrive={async () => null} executeRedrive={async () => undefined} onChanged={async () => undefined}/></Frame>,
};

export const RecoveredJobAudit: Story = {
  render: () => <Frame><IngestionJobDetailView job={recovered} authenticated onAuthenticate={() => undefined} onClose={() => undefined} previewRedrive={async () => null} executeRedrive={async () => undefined} onChanged={async () => undefined}/></Frame>,
};

export const LoadingEvidence: Story = {
  render: () => <Frame><div className="data-state" role="status">Loading jobs evidence…</div></Frame>,
};

export const EvidenceUnavailable: Story = {
  render: () => <Frame><div className="data-state data-state--error" role="alert">Operational evidence is unavailable. Try again after connectivity is restored.</div></Frame>,
};
