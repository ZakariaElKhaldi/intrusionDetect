import type { Meta, StoryObj } from "@storybook/react-vite";
import { sampleAlerts, sampleModels } from "../../data";
import { ConfusionMatrixChart, DetectionRankingChart, EvidenceChart, ModelComparisonChart, ProtocolDistributionChart, SeverityTimelineChart } from ".";

const meta = {
  title: "Components/Charts/Operational charts",
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Charts summarize evidence visually. Product workspaces pair them with exact tables or structured alternatives when precise inspection is required." } } },
  decorators: [(Story) => <section className="panel" style={{ maxWidth: 900, padding: 16 }}><Story /></section>],
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const SeverityTimeline: Story = { render: () => <SeverityTimelineChart alerts={sampleAlerts.slice(0, 80)} /> };
export const ProtocolDistribution: Story = { render: () => <ProtocolDistributionChart alerts={sampleAlerts.slice(0, 80)} /> };
export const DetectionRanking: Story = { render: () => <DetectionRankingChart alerts={sampleAlerts.slice(0, 80)} /> };
export const ModelComparison: Story = { render: () => <ModelComparisonChart models={sampleModels} /> };
export const ConfusionMatrix: Story = { render: () => <ConfusionMatrixChart classes={["Normal", "Attack"]} matrix={[[930, 18], [24, 428]]} /> };
export const SignedEvidence: Story = { render: () => <EvidenceChart evidence={sampleAlerts[0].explanations ?? []} /> };
