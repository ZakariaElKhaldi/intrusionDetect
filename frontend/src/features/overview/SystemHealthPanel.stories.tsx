import type { Meta, StoryObj } from "@storybook/react-vite";
import type { HealthInfo } from "../../types";
import { SystemHealthPanel } from "./SystemHealthPanel";

const ready: HealthInfo = {
  status: "ok", readiness: "ready", checked_at: "2026-08-11T12:00:00Z", instance_id: "sentinel-api-1",
  schema_version: "rt-iot2022-v1", model_version: "bundle-7", detector_model_version: "detector-7",
  classifier_model_version: "classifier-4", detector_probability_calibrated: true,
  classifier_probability_calibrated: false, live_connections: 2, dataset_ready: true,
  dataset_checksum: "65f7f43e08c11a60be44ed6f19602bdd8b76f53ddd2677ff21c303ca0c20e18e",
  production_bundle_valid: true, fallback: false,
  components: {
    api: { status: "ready", reason: "HTTP API is serving requests" },
    database: { status: "ready", reason: "Database connectivity check passed" },
    bundle: { status: "ready", reason: "Validated promoted artifacts are active" },
    dataset: { status: "ready", reason: "Validated replay dataset is available" },
    worker: { status: "ready", reason: "Worker heartbeat is current" },
    outbox: { status: "ready", reason: "Publication queue is available" },
  },
};

const meta = {
  title: "Workspaces/Overview/System health",
  component: SystemHealthPanel,
  tags: ["autodocs"],
  args: { health: ready, socketState: "live", lastUpdate: new Date("2026-08-11T12:00:00Z"), fixtureMode: false },
} satisfies Meta<typeof SystemHealthPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
export const DegradedWithExceptions: Story = { args: { health: { ...ready, readiness: "degraded", fallback: true, components: { ...ready.components, database: { status: "blocked", reason: "Database connectivity check failed" }, worker: { status: "degraded", reason: "Worker heartbeat is stale" } } }, socketState: "offline" } };
export const Blocked: Story = { args: { health: { ...ready, readiness: "blocked", production_bundle_valid: false, components: { ...ready.components, bundle: { status: "blocked", reason: "Validated model artifacts are unavailable" } } } } };
export const Unavailable: Story = { args: { health: null, socketState: "offline", lastUpdate: null } };
export const FixtureBoundary: Story = { args: { health: null, socketState: "offline", lastUpdate: null, fixtureMode: true } };
