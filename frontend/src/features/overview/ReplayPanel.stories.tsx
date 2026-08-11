import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { ReplayScenario, ReplayStatus } from "../../types";
import { ReplayPanel } from "./ReplayPanel";

const running: ReplayStatus = { status: "running", processed: 42, total: 120, error: null, speed: 2, scenario: "attack", mode: "dataset", offset: 0, limit: 120 };
const noop = () => undefined;

function InteractiveReplay() {
  const [replay, setReplay] = useState<ReplayStatus | null>(null);
  const [scenario, setScenario] = useState<ReplayScenario>("attack");
  const [speed, setSpeed] = useState(1);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(100);
  const primary = () => setReplay((current) => current?.status === "running"
    ? { ...current, status: "paused" }
    : current?.status === "paused"
      ? { ...current, status: "running", speed }
      : { status: "running", processed: 0, total: Math.min(limit, 72), error: null, speed, scenario, mode: "dataset", offset, limit });
  return <ReplayPanel replay={replay} scenario={scenario} speed={speed} offset={offset} limit={limit} error="" onScenario={setScenario} onSpeed={setSpeed} onOffset={setOffset} onLimit={setLimit} onPrimary={primary} onStop={() => setReplay((current) => current ? { ...current, status: "stopped" } : current)} onRetry={noop} />;
}

const meta = {
  title: "Workspaces/Overview/Replay control",
  component: ReplayPanel,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main style={{ padding: 20, background: "#eceeeb", minHeight: "100vh" }}><h1 className="sr-only">Replay control</h1><Story /></main>],
  args: {
    replay: null, scenario: "attack", speed: 1, offset: 0, limit: 100, error: "", unavailableReasons: [], pendingAction: null,
    onScenario: noop, onSpeed: noop, onOffset: noop, onLimit: noop, onPrimary: noop, onStop: noop, onRetry: noop,
  },
} satisfies Meta<typeof ReplayPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadyToConfigure: Story = {};
export const ExactFamilyWindow: Story = { args: { scenario: "class:NMAP_TCP_scan", speed: 4, offset: 12_500, limit: 850 } };
export const InvalidConfiguration: Story = { args: { speed: 0, offset: -2, limit: 1_000_001 } };
export const Starting: Story = { args: { replay: null, pendingAction: "starting" } };
export const Running: Story = { args: { replay: running } };
export const RunningWithStopReview: Story = { args: { replay: running, initialStopReview: true } };
export const Paused: Story = { args: { replay: { ...running, status: "paused", processed: 63 } } };
export const Resuming: Story = { args: { replay: { ...running, status: "paused", processed: 63 }, pendingAction: "resuming", speed: 8 } };
export const Completed: Story = { args: { replay: { ...running, status: "completed", processed: 120 } } };
export const Stopped: Story = { args: { replay: { ...running, status: "stopped", processed: 58 } } };
export const WorkerFailed: Story = { args: { replay: { ...running, status: "failed", processed: 58, error: "Detector artifact became unavailable during row processing." } } };
export const StatusUnavailable: Story = { args: { error: "The replay status request exceeded the response deadline." } };
export const StaleRunningSnapshot: Story = { args: { replay: running, error: "The latest status request exceeded the response deadline." } };
export const BlockedDependencies: Story = { args: { disabled: true, unavailableReasons: ["Dataset is blocked: checksum does not match the serving bundle.", "Database is unavailable: readiness check failed."] } };
export const CheckingAvailability: Story = { args: { disabled: true, unavailableReasons: ["API readiness is still being checked."] } };
export const ReadOnlyFixture: Story = { args: { disabled: true, unavailableReasons: ["Fixture preview is read-only and does not send replay mutations."] } };
export const InteractiveLifecycle: Story = { render: () => <InteractiveReplay /> };
