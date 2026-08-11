import type { Meta, StoryObj } from "@storybook/react-vite";
import type { HealthInfo } from "../../types";
import { ApplicationShell } from "./ApplicationShell";

const readyHealth: HealthInfo = { status: "ok", readiness: "ready", schema_version: "rt-iot2022-v1", model_version: "detector-v4", live_connections: 2 };

const meta = {
  title: "Foundations/Application shell",
  component: ApplicationShell,
  tags: ["autodocs"],
  args: {
    page: "overview",
    fixtureMode: false,
    health: readyHealth,
    healthChecked: true,
    socketState: "live",
    queuedAlertCount: 4,
    session: { access_token: "storybook", token_type: "bearer", expires_in: 3600, expires_at: "2026-08-11T17:00:00Z", username: "m.chen" },
    authRequired: true,
    onNavigate: () => undefined,
    onSignIn: () => undefined,
    onSignOut: () => undefined,
    children: <section className="panel shell-story-content"><span className="eyebrow">Workspace content</span><h2>Situation workspace begins here</h2><p>The shell keeps navigation, operator authority, API evidence, and the live stream distinct from page evidence.</p></section>,
  },
} satisfies Meta<typeof ApplicationShell>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ConnectedSignedIn: Story = {};
export const AlertWorkQueued: Story = { args: { page: "alerts", queuedAlertCount: 19 } };
export const StreamReconnecting: Story = { args: { socketState: "connecting" } };
export const DegradedBackend: Story = { args: { health: { ...readyHealth, readiness: "degraded" }, socketState: "offline" } };
export const BlockedBackend: Story = { args: { health: { ...readyHealth, readiness: "blocked" }, socketState: "offline" } };
export const BackendUnavailable: Story = { args: { health: null, healthChecked: true, socketState: "offline" } };
export const CheckingConnection: Story = { args: { health: null, healthChecked: false, socketState: "connecting" } };
export const SignedOut: Story = { args: { session: null, authRequired: true } };
export const LocalAuthenticationDisabled: Story = { args: { session: null, authRequired: false } };
export const ReadOnlyFixture: Story = { args: { fixtureMode: true, health: null, socketState: "offline", session: null } };
export const ModelsCurrent: Story = { args: { page: "models" } };
