import type { Meta, StoryObj } from "@storybook/react-vite";
import { OverviewOperations } from "./OverviewOperations";

const meta = {
  title: "Workspaces/Overview/Operations evidence",
  component: OverviewOperations,
  tags: ["autodocs"],
  decorators: [(Story) => <main style={{ padding: 20, background: "#eceeeb", minHeight: "100vh" }}><h1 className="sr-only">Operations evidence</h1><Story /></main>],
  args: { health: null, ingestion: null, ingestionLoading: false, ingestionError: "", fixtureMode: true, socketState: "offline", lastUpdate: null, onRetryIngestion: () => undefined },
} satisfies Meta<typeof OverviewOperations>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ReadOnlyFixtureComposition: Story = {};
