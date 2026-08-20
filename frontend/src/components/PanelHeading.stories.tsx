import type { Meta, StoryObj } from "@storybook/react-vite";
import { PanelHeading } from "./PanelHeading";

const meta = {
  title: "Components/Panel heading",
  component: PanelHeading,
  tags: ["autodocs"],
  decorators: [(Story) => <section className="panel"><Story /></section>],
  args: {
    title: "Alert pressure",
  },
} satisfies Meta<typeof PanelHeading>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithAction: Story = {
  args: { action: <button className="secondary-button">Review queue</button> },
};
