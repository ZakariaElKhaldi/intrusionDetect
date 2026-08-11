import type { Meta, StoryObj } from "@storybook/react-vite";
import { OperatorSignInDialog } from "./OperatorSignInDialog";

const meta = {
  title: "Foundations/Operator sign in",
  component: OperatorSignInDialog,
  tags: ["autodocs"],
  decorators: [(Story) => <main className="shell-auth-story"><h1 className="sr-only">Authentication boundary preview</h1><button type="button">Invoking action</button><Story/></main>],
  args: { onClose: () => undefined, onSubmit: () => undefined },
} satisfies Meta<typeof OperatorSignInDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
export const InvalidCredentials: Story = { args: { error: "The supplied credentials were not accepted." } };
export const ServerUnavailable: Story = { args: { error: "Authentication service could not be reached." } };
export const RateLimited: Story = { args: { error: "Too many failed login attempts.", retryAvailableAt: new Date("2026-08-11T17:01:00Z") } };
export const Submitting: Story = { args: { submitting: true } };
