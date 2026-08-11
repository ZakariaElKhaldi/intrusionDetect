import type { Meta, StoryObj } from "@storybook/react-vite";
import { sampleAlerts } from "../../data";
import type { IngestionStatus } from "../../types";
import { IngestionStatusPanel, Overview } from "./Overview";

const ingestion: IngestionStatus = {
  queue_depth: 12, queued: 12, processing: 2, succeeded: 4812, oldest_pending_age_seconds: 38,
  retries: 4, retrying: 1, failures: 0, dead_letter: 0, throughput_per_minute: 86.4,
  worker: { status: "ready", last_heartbeat_at: "2026-08-11T12:58:00Z" },
  outbox: { status: "ready", pending: 3, published: 4790, oldest_pending_age_seconds: 5 },
  generated_at: "2026-08-11T12:58:03Z",
};

const meta = {
  title: "Workspaces/Overview/Monitoring overview",
  component: Overview,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main style={{ padding: 20, background: "#eceeeb", minHeight: "100vh" }}><Story /></main>],
  args: { alerts: sampleAlerts.slice(0, 40), health: null, ingestion: null, ingestionLoading: false, ingestionError: "", fixtureMode: true, onRetryIngestion: () => undefined, socketState: "offline", lastUpdate: null, livePredictionCount: 0, onOpenAlert: () => undefined, onTimeBucket: () => undefined },
} satisfies Meta<typeof Overview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FixtureOverview: Story = {};
export const NoAlerts: Story = { args: { alerts: [] } };

export const IngestionHealthy: Story = {
  render: () => <IngestionStatusPanel status={ingestion} loading={false} error="" fixtureMode={false} onRetry={() => undefined} />,
};
export const IngestionBacklogged: Story = {
  render: () => <IngestionStatusPanel status={{ ...ingestion, queue_depth: 842, queued: 842, oldest_pending_age_seconds: 322 }} loading={false} error="" fixtureMode={false} onRetry={() => undefined} />,
};
export const IngestionUnavailable: Story = {
  render: () => <IngestionStatusPanel status={null} loading={false} error="Connection refused." fixtureMode={false} onRetry={() => undefined} />,
};
