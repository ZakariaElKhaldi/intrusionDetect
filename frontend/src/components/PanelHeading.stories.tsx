import type { Meta, StoryObj } from "@storybook/react-vite";
import { PanelHeading } from "./PanelHeading";

const meta = {
  title: "Components/Panel heading",
  component: PanelHeading,
  tags: ["autodocs"],
  decorators: [(Story) => <section className="panel"><Story /></section>],
  args: {
    eyebrow: "Operational context",
    title: "Alert pressure",
    description: "A concise description explains scope, evidence, and time window.",
  },
} satisfies Meta<typeof PanelHeading>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithContext: Story = {};

export const WithAction: Story = {
  args: { action: <button className="secondary-button">Review queue</button> },
};

export const TitleOnly: Story = {
  args: { eyebrow: undefined, description: undefined },
};
