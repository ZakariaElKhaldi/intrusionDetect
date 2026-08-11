import type { Meta, StoryObj } from "@storybook/react-vite";
import { sampleAlerts } from "../../data";
import { TopologyWorkspace } from "./TopologyWorkspace";

const meta = {
  title: "Workspaces/Topology/Route map",
  component: TopologyWorkspace,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main style={{ padding: 20, background: "#eceeeb", minHeight: "100vh" }}><Story /></main>],
  args: { alerts: sampleAlerts.slice(0, 60), onViewAlerts: () => undefined, reducedMotion: true },
} satisfies Meta<typeof TopologyWorkspace>;

export default meta;
type Story = StoryObj<typeof meta>;
export const PopulatedMap: Story = {};
export const EmptyMap: Story = { args: { alerts: [] } };
