import type { Meta, StoryObj } from "@storybook/react-vite";
import { ServingModelSummary } from "./ServingModelSummary";

const models = [
  { name: "Calibrated forest", version: "detector-2026.08.4", role: "detector" as const, status: "active", probability_calibrated: true, schema_version: "rt-iot2022-v1", artifact_registered: true },
  { name: "Attack family forest", version: "classifier-2026.08.2", role: "classifier" as const, status: "active", probability_calibrated: false, schema_version: "rt-iot2022-v1", artifact_registered: true },
];

const meta = {
  title: "Workspaces/Models/Serving bundle",
  component: ServingModelSummary,
  tags: ["autodocs"],
  args: { models, loading: false, error: "" },
} satisfies Meta<typeof ServingModelSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CompleteBundle: Story = {};
export const MissingClassifier: Story = { args: { models: models.slice(0, 1) } };
export const Loading: Story = { args: { models: [], loading: true } };
export const Unavailable: Story = { args: { models: [], error: "The model registry did not respond." } };
