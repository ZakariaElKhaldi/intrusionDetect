import type { Meta, StoryObj } from "@storybook/react-vite";
import { IngestionOperations } from "./IngestionOperations";

const meta = {
  title: "Workspaces/Overview/Ingestion operations",
  component: IngestionOperations,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "The fixture state documents that durable job and outbox evidence cannot be fabricated without a connected backend." } } },
  args: { fixtureMode: true },
} satisfies Meta<typeof IngestionOperations>;

export default meta;
type Story = StoryObj<typeof meta>;
export const FixtureBoundary: Story = {};
