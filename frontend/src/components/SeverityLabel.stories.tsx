import type { Meta, StoryObj } from "@storybook/react-vite";
import { SeverityLabel } from "./SeverityLabel";

const meta = {
  title: "Components/Severity label",
  component: SeverityLabel,
  tags: ["autodocs"],
  args: { severity: "critical" },
} satisfies Meta<typeof SeverityLabel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Critical: Story = {};
export const High: Story = { args: { severity: "high" } };
export const Medium: Story = { args: { severity: "medium" } };
export const Low: Story = { args: { severity: "low" } };
export const Normal: Story = { args: { severity: "normal" } };

export const CompleteScale: Story = {
  render: () => <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}><SeverityLabel severity="critical" /><SeverityLabel severity="high" /><SeverityLabel severity="medium" /><SeverityLabel severity="low" /><SeverityLabel severity="normal" /></div>,
};
