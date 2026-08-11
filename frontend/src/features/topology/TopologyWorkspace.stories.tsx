import type { Meta, StoryObj } from "@storybook/react-vite";
import { sampleAlerts } from "../../data";
import type { Alert } from "../../types";
import { TopologyWorkspace } from "./TopologyWorkspace";

const limitedIdentityAlerts: Alert[] = [
  {
    id: "limited-1",
    timestamp: new Date().toISOString(),
    attack_type: "Inbound service probe",
    confidence: 0.94,
    severity: "critical",
    source_ip: "port:443",
    destination_ip: "",
    protocol: "TCP",
    status: "new",
  },
];

const meta = {
  title: "Workspaces/Topology/Route map",
  component: TopologyWorkspace,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main style={{ padding: 20, background: "#eceeeb", minHeight: "100vh" }}><h1 className="sr-only">Topology route map</h1><Story /></main>],
  args: { alerts: sampleAlerts.slice(0, 60), onViewAlerts: () => undefined, reducedMotion: true },
} satisfies Meta<typeof TopologyWorkspace>;

export default meta;
type Story = StoryObj<typeof meta>;
export const PopulatedMap: Story = {};
export const ElevatedActivity: Story = {
  args: { alerts: sampleAlerts.filter((alert) => alert.severity === "critical" || alert.severity === "high").slice(0, 35) },
};
export const LimitedIdentity: Story = { args: { alerts: limitedIdentityAlerts } };
export const EmptyMap: Story = { args: { alerts: [] } };
export const LoadingEvidence: Story = { args: { alerts: [], loading: true } };
export const Unavailable: Story = { args: { alerts: [], error: "The alert service did not respond.", onRetry: () => undefined } };
export const CachedRefreshFailure: Story = {
  args: { error: "The latest refresh timed out. Cached evidence remains available.", onRetry: () => undefined },
};
export const FixtureSample: Story = { args: { alerts: sampleAlerts.slice(0, 40), fixtureMode: true } };
