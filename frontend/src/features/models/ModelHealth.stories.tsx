import type { Meta, StoryObj } from "@storybook/react-vite";
import { ModelHealth } from "./ModelHealth";

const meta = {
  title: "Workspaces/Models/Model health",
  component: ModelHealth,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "The fixture story preserves the boundary between designed examples and production monitoring evidence." } } },
  args: { fixtureMode: true },
} satisfies Meta<typeof ModelHealth>;

export default meta;
type Story = StoryObj<typeof meta>;
export const FixtureBoundary: Story = {};
