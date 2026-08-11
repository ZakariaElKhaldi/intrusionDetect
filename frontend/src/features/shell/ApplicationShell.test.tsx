import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApplicationShell } from "./ApplicationShell";

const base = {
  page: "alerts" as const,
  fixtureMode: false,
  health: { status: "ok", readiness: "ready" as const, schema_version: "v1", model_version: "m1", live_connections: 1 },
  healthChecked: true,
  socketState: "live" as const,
  queuedAlertCount: 3,
  session: null,
  authRequired: true,
  onNavigate: vi.fn(),
  onSignIn: vi.fn(),
  onSignOut: vi.fn(),
};

describe("application shell", () => {
  it("uses real links, exposes the current page, and keeps all destinations directly available", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<ApplicationShell {...base} onNavigate={onNavigate}><p>Content</p></ApplicationShell>);

    const links = screen.getAllByRole("link");
    expect(screen.getByRole("link", { name: "Triage alerts" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Validate models" })).toHaveAttribute("href", "?view=models");
    expect(screen.getByLabelText("3 new alerts")).toBeInTheDocument();
    expect(links).toHaveLength(7);
    await user.click(screen.getByRole("link", { name: "Map routes" }));
    expect(onNavigate).toHaveBeenCalledWith("topology");
  });

  it("separates backend evidence, stream, and operator authority", () => {
    render(<ApplicationShell {...base} health={{ ...base.health, readiness: "degraded" }} socketState="offline"><p>Content</p></ApplicationShell>);
    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getByText("Signed out")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Operator sign in" })).toBeInTheDocument();
  });

  it("preserves the fixture boundary in navigation and identity", () => {
    render(<ApplicationShell {...base} fixtureMode health={null} socketState="offline"><p>Content</p></ApplicationShell>);
    expect(screen.getByRole("link", { name: "Test observations" })).toHaveAttribute("href", "?view=testing&fixture=true");
    expect(screen.getByText("Read-only preview")).toBeInTheDocument();
    expect(screen.getByText("Fixture data · not connected evidence")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Operator sign in" })).not.toBeInTheDocument();
  });
});
