import type { Meta, StoryObj } from "@storybook/react-vite";
import { ObservationLab } from "./ObservationLab";

const meta = {
  title: "Workspaces/Testing/Observation lab",
  component: ObservationLab,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main style={{ padding: 20, background: "#eceeeb", minHeight: "100vh" }}><Story /></main>],
  args: { fixtureMode: true },
} satisfies Meta<typeof ObservationLab>;

export default meta;
type Story = StoryObj<typeof meta>;
export const ReadOnlyFixture: Story = {};
