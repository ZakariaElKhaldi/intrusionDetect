import type { Meta, StoryObj } from "@storybook/react-vite";
import { sampleAlerts } from "../../data";
import { Overview } from "./Overview";
import { connectedDashboardSummary, emptyDashboardSummary } from "./overviewFixtures";

const noop = () => undefined;
const meta = {
  title: "Workspaces/Overview/Monitoring overview",
  component: Overview,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main style={{ padding: 20, background: "#eceeeb", minHeight: "100vh" }}><h1 className="sr-only">Monitoring overview</h1><Story /></main>],
  args: {
    alerts: sampleAlerts.slice(0, 18), fixtureMode: false, socketState: "live", lastUpdate: new Date("2026-08-11T13:58:00Z"), livePredictionCount: 17,
    summary: connectedDashboardSummary, summaryRange: "24h", onSummaryRange: noop, onRetrySummary: noop, onRetry: noop,
    onOpenAlert: noop, onTimeBucket: noop, onViewAlertQueue: noop,
  },
} satisfies Meta<typeof Overview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ConnectedOperational: Story = {};
export const CriticalWorkload: Story = { args: { summary: { ...connectedDashboardSummary, alerts: { ...connectedDashboardSummary.alerts, critical_open: 12, unresolved: 31, open: 31 }, persisted_totals: { ...connectedDashboardSummary.persisted_totals, unresolved_alerts: 31 } } } };
export const EmptyPersistedWindow: Story = { args: { alerts: [], livePredictionCount: 0, summary: emptyDashboardSummary } };
export const InitialSummaryLoading: Story = { args: { summary: null, summaryLoading: true, alerts: [] } };
export const SummaryUnavailable: Story = { args: { summary: null, summaryError: "The dashboard summary request exceeded the response deadline.", alerts: [] } };
export const StaleSummarySnapshot: Story = { args: { summaryError: "The latest dashboard summary request exceeded the response deadline." } };
export const SwitchingEvidenceWindow: Story = { args: { summaryRange: "7d", summaryLoading: true } };
export const LoadedAlertCacheStale: Story = { args: { alertsError: "The latest alert-cache refresh failed." } };
export const AllPersistedRecords: Story = { args: { summaryRange: "all", summary: { ...connectedDashboardSummary, range: "all", window: { from: "2026-05-01T00:00:00Z", to: connectedDashboardSummary.window.to }, scope: { ...connectedDashboardSummary.scope, range: "all", from: "2026-05-01T00:00:00Z", bucket_minutes: 1440 } } } };
export const FixtureOverview: Story = { args: { fixtureMode: true, summary: null, summaryRange: "24h", socketState: "offline", livePredictionCount: 0 } };
export const EmptyFixture: Story = { args: { fixtureMode: true, summary: null, alerts: [], socketState: "offline", livePredictionCount: 0 } };
