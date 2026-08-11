import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReplayStatus } from "../../types";
import { ReplayPanel } from "./ReplayPanel";

const running: ReplayStatus = { status: "running", processed: 42, total: 120, error: null, speed: 2, scenario: "attack", mode: "dataset", offset: 0, limit: 120 };

const meta = {
  title: "Workspaces/Overview/Replay control",
  component: ReplayPanel,
  tags: ["autodocs"],
  args: { replay: null, scenario: "attack", speed: 1, offset: 0, limit: 100, error: "", onScenario: () => undefined, onSpeed: () => undefined, onOffset: () => undefined, onLimit: () => undefined, onPrimary: () => undefined, onStop: () => undefined, onRetry: () => undefined },
} satisfies Meta<typeof ReplayPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
export const Running: Story = { args: { replay: running } };
export const Paused: Story = { args: { replay: { ...running, status: "paused", processed: 63 } } };
export const LaterDatasetWindow: Story = { args: { offset: 500, limit: 100 } };
export const ConnectedApiRequired: Story = { args: { disabled: true } };
export const Failed: Story = { args: { replay: { ...running, status: "failed", error: "Replay worker stopped." }, error: "Replay worker stopped." } };
