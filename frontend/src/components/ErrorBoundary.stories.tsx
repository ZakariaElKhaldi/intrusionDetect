import type { Meta, StoryObj } from "@storybook/react-vite";
import { ErrorBoundary } from "./ErrorBoundary";

function BrokenSurface(): never {
  throw new Error("Deliberate Storybook render failure");
}

const meta = {
  title: "Components/Error boundary",
  component: ErrorBoundary,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Contains a render failure without exposing thrown values or observation data to the operator." } } },
} satisfies Meta<typeof ErrorBoundary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ContainedFailure: Story = {
  args: { children: <BrokenSurface />, title: "Alert evidence could not be displayed", message: "The failure was contained inside this panel." },
};
