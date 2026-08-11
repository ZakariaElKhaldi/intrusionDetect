import type { Meta, StoryObj } from "@storybook/react-vite";
import { sampleAlerts } from "../../data";
import { AlertDrawer, AlertWorkspace } from "./AlertWorkspace";

const meta = {
  title: "Workspaces/Alerts/Alert queue",
  component: AlertWorkspace,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main style={{ padding: 20, background: "#eceeeb", minHeight: "100vh" }}><Story /></main>],
  args: { alerts: sampleAlerts.slice(0, 24), pending: 0, onSelect: () => undefined, applyPending: () => undefined, fixtureMode: true },
} satisfies Meta<typeof AlertWorkspace>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PopulatedQueue: Story = {};
export const IncomingAlerts: Story = { args: { pending: 3 } };
export const EmptyQueue: Story = { args: { alerts: [] } };
export const FailedLoad: Story = { args: { alerts: [], error: "The alert service did not respond." } };

export const InvestigationDrawer: Story = {
  render: () => <AlertDrawer alert={sampleAlerts[0]} onClose={() => undefined} onStatusChange={() => undefined} loadExplanation={false} readOnly />,
};
