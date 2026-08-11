import type { Meta, StoryObj } from "@storybook/react-vite";
import type { IngestionStatus } from "../../types";
import { IngestionStatusPanel } from "./IngestionStatusPanel";

const healthy: IngestionStatus = {
  queue_depth: 0, queued: 0, processing: 0, succeeded: 4812, oldest_pending_age_seconds: null,
  retries: 4, retrying: 0, failures: 0, dead_letter: 0, throughput_per_minute: 86.4,
  worker: { status: "ready", reason: "Heartbeat current", last_heartbeat_at: "2026-08-11T13:58:00Z" },
  outbox: { status: "ready", reason: "Delivery current", pending: 0, published: 4790, oldest_pending_age_seconds: null },
  generated_at: "2026-08-11T13:58:03Z",
};
const meta = {
  title: "Workspaces/Overview/Ingestion status",
  component: IngestionStatusPanel,
  tags: ["autodocs"],
  decorators: [(Story) => <main style={{ padding: 20, background: "#eceeeb", minHeight: "100vh" }}><h1 className="sr-only">Ingestion status</h1><Story /></main>],
  args: { status: healthy, loading: false, error: "", fixtureMode: false, onRetry: () => undefined },
} satisfies Meta<typeof IngestionStatusPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const IdleAndReady: Story = {};
export const Processing: Story = { args: { status: { ...healthy, processing: 3 } } };
export const Backlogged: Story = { args: { status: { ...healthy, queue_depth: 842, queued: 842, oldest_pending_age_seconds: 322 } } };
export const Retrying: Story = { args: { status: { ...healthy, retrying: 5, retries: 18, queue_depth: 21 } } };
export const DeadLetterAttention: Story = { args: { status: { ...healthy, dead_letter: 7, failures: 7 } } };
export const StaleSnapshot: Story = { args: { error: "The latest ingestion status request timed out." } };
export const Loading: Story = { args: { status: null, loading: true } };
export const Unavailable: Story = { args: { status: null, error: "Connection refused." } };
export const ReadOnlyFixture: Story = { args: { status: null, fixtureMode: true } };
