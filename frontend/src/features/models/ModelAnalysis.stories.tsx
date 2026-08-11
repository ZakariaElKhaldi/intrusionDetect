import type { Meta, StoryObj } from "@storybook/react-vite";
import { ModelAnalysis } from "./ModelAnalysis";

const models = [
  { name: "Calibrated forest", version: "detector-2026.08.4", role: "detector" as const, status: "active", probability_calibrated: true, macro_f1: 0.947, weighted_f1: 0.982, false_positive_rate: 0.013, inference_ms: 3.8 },
  { name: "Attack family forest", version: "classifier-2026.08.2", role: "classifier" as const, status: "active", probability_calibrated: false, macro_f1: 0.921, weighted_f1: 0.954, inference_ms: 4.6 },
];

const meta = {
  title: "Workspaces/Models/Model analysis",
  component: ModelAnalysis,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "Separates runtime descriptors and production monitoring from offline candidate evaluation. The fixture story intentionally reports monitoring as unavailable rather than inventing live evidence." } },
  },
  decorators: [(Story) => <main style={{ padding: 20, background: "#eceeeb", minHeight: "100vh" }}><Story /></main>],
  args: { models, fixtureMode: true, descriptorLoading: false, descriptorError: "" },
} satisfies Meta<typeof ModelAnalysis>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ServingAndHealth: Story = {};
export const DescriptorFailure: Story = { args: { models: [], descriptorError: "Serving model descriptors are unavailable." } };
