import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { AuthProvider } from "../auth";
import { connectedDashboardSummary } from "../features/overview/overviewFixtures";

describe("dashboard", () => {
  beforeEach(() => {
    history.replaceState(null, "", "/");
    sessionStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps an acknowledged live stream and closes it when a later heartbeat is unanswered", async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const closed: [number | undefined, string | undefined][] = [];
    let activeSocket: HeartbeatWebSocket | undefined;
    class HeartbeatWebSocket {
      static OPEN = 1;
      readyState = HeartbeatWebSocket.OPEN;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      constructor(_url: string) {
        activeSocket = this;
        window.setTimeout(() => this.onopen?.(new Event("open")), 0);
      }
      send(value: string) { sent.push(value); }
      close(code?: number, reason?: string) { closed.push([code, reason]); }
    }
    vi.stubGlobal("WebSocket", HeartbeatWebSocket);

    render(<App />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    act(() => {
      activeSocket?.onmessage?.(new MessageEvent("message", {
        data: JSON.stringify({ type: "connection", status: "connected" }),
      }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(25_000); });
    expect(sent).toEqual(["ping"]);
    await act(async () => {
      activeSocket?.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "pong" }) }));
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(closed).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(sent).toEqual(["ping", "ping"]);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(closed).toContainEqual([4000, "heartbeat timeout"]);
  });

  it("installs a restored bearer session before child reads and live authentication", async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    sessionStorage.setItem("iot-ids-auth-session", JSON.stringify({
      access_token: "restored-token",
      token_type: "bearer",
      expires_in: 60,
      expires_at: expiresAt,
      username: "admin",
    }));
    const requests: { path: string; authorization: string | null }[] = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      requests.push({
        path,
        authorization: new Headers(init?.headers).get("Authorization"),
      });
      const body = path.endsWith("/auth/status") ? { enabled: true }
        : path.endsWith("/auth/me") ? { username: "admin", role: "admin" }
          : path.endsWith("/health") ? { status: "ok", model_version: "m1", schema_version: "v1", live_connections: 0 }
            : path.endsWith("/models") || path.endsWith("/alerts") ? []
              : {};
      return Promise.resolve(new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }));
    const sent: string[] = [];
    class RestoredSessionSocket {
      static OPEN = 1;
      readyState = RestoredSessionSocket.OPEN;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      constructor(_url: string) { setTimeout(() => this.onopen?.(new Event("open")), 0); }
      send(value: string) { sent.push(value); }
      close() {}
    }
    vi.stubGlobal("WebSocket", RestoredSessionSocket);

    render(<AuthProvider><App /></AuthProvider>);

    await waitFor(() => expect(requests.some(({ path }) => path.includes("/alerts"))).toBe(true));
    expect(
      requests.filter(({ path }) => !path.endsWith("/auth/status") && !path.endsWith("/health")),
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({ authorization: "Bearer restored-token" }),
    ]));
    await waitFor(() => expect(sent[0]).toBe(JSON.stringify({
      type: "authenticate",
      token: "restored-token",
    })));
  });

  it("refreshes the persisted summary when a live alert is delivered", async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    sessionStorage.setItem("iot-ids-auth-session", JSON.stringify({
      access_token: "restored-token",
      token_type: "bearer",
      expires_in: 60,
      expires_at: expiresAt,
      username: "admin",
    }));
    let summaryRequests = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      const body = path.endsWith("/auth/status") ? { enabled: true }
        : path.endsWith("/auth/me") ? { username: "admin", role: "admin" }
          : path.endsWith("/health") ? { status: "ok", model_version: "m1", schema_version: "v1", live_connections: 0 }
            : path.includes("/dashboard/summary") ? (summaryRequests += 1, connectedDashboardSummary)
              : path.includes("/sensors/status") ? { status: "online", checked_at: "2026-08-20T12:00:00Z", aggregate: { packets: 100, capture_drops: 0, events_seen: 0, alerts_accepted: 0 }, sensors: [] }
                : path.includes("/alerts/page") ? { items: [], total: 0, limit: 50, offset: 0, has_more: false, filters: {} }
                : path.endsWith("/alerts") || path.endsWith("/models") ? []
                  : {};
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
    }));
    let activeSocket: LiveSummarySocket | undefined;
    class LiveSummarySocket {
      static OPEN = 1;
      readyState = LiveSummarySocket.OPEN;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      constructor(_url: string) {
        activeSocket = this;
        setTimeout(() => this.onopen?.(new Event("open")), 0);
      }
      send() {}
      close() {}
    }
    vi.stubGlobal("WebSocket", LiveSummarySocket);

    render(<AuthProvider><App /></AuthProvider>);
    await waitFor(() => expect(summaryRequests).toBe(1));
    act(() => activeSocket?.onmessage?.(new MessageEvent("message", { data: JSON.stringify({
      type: "alert.created",
      data: {
        alert_id: "live-alert-1",
        event_id: null,
        severity: "critical",
        reasons: ["Live rule match"],
        top_features: [],
        status: "new",
        created_at: "2026-08-20T12:00:05Z",
      },
    }) })));

    await waitFor(() => expect(summaryRequests).toBe(2));
    expect(await screen.findByText("Live rule match")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "Triage alerts" }));
    await screen.findByRole("heading", { name: "Security alerts" });
    act(() => activeSocket?.onmessage?.(new MessageEvent("message", { data: JSON.stringify({
      type: "alert.created",
      data: {
        alert_id: "live-alert-2",
        event_id: null,
        severity: "high",
        reasons: ["Second live rule match"],
        top_features: [],
        status: "new",
        created_at: "2026-08-20T12:00:10Z",
      },
    }) })));
    expect(await screen.findByRole("button", { name: /1 new alert received/i })).toBeInTheDocument();
  });

  it("navigates between the investigation pages", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole("heading", { name: "Monitoring overview" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Triage alerts" }));
    expect(screen.getByRole("heading", { name: "Alert investigation" })).toBeInTheDocument();
    expect(document.title).toBe("Alert investigation · Sentinel");
    expect(screen.getByRole("main")).toHaveFocus();
    expect(await screen.findByRole("table", { name: "Security alerts" }, { timeout: 3_000 })).toBeInTheDocument();
  });

  it("opens and dismisses alert details without losing the alert list", async () => {
    history.replaceState(null, "", "/?fixture=true");
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("link", { name: "Triage alerts" }));
    const alertButtons = await screen.findAllByRole("button", { name: /^Open .* alert / });
    await user.click(alertButtons[0]);
    expect(await screen.findByRole("dialog", {}, { timeout: 2_000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close alert details" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Close alert details" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Security alerts" })).toBeInTheDocument();
  });

  it("exposes replay controls to keyboard and assistive technology", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes("/health")) return Promise.resolve(new Response(JSON.stringify({
        status: "ok", schema_version: "rt-iot2022-v1", model_version: "detector-v1", live_connections: 0,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }));
    }));
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Start replay" })).toBeEnabled());
    expect(screen.getByRole("spinbutton", { name: "Replay speed" })).toHaveValue(1);
    expect(screen.getByRole("combobox", { name: "Replay scenario" })).toHaveValue("attack");
    expect(screen.getByRole("spinbutton", { name: "Replay offset" })).toHaveValue(0);
    expect(screen.getByRole("spinbutton", { name: "Replay limit" })).toHaveValue(40);
  });

  it("never substitutes fixture alerts when the connected API is offline", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("link", { name: "Triage alerts" }));
    expect(await screen.findByText("No alerts recorded")).toBeInTheDocument();
    expect(screen.queryByText(/ALT-03048/)).not.toBeInTheDocument();
    expect(
      screen.getByText("Backend unavailable. No fixture records are mixed into this connected workspace."),
    ).toBeInTheDocument();
  });

  it("labels explicitly requested fixture data permanently", () => {
    history.replaceState(null, "", "/?fixture=true");
    render(<App />);
    expect(screen.getByText("Fixture data · not connected evidence")).toBeInTheDocument();
    expect(screen.getByText("Read-only preview")).toBeInTheDocument();
    expect(screen.getByText("Illustrative evidence")).toBeInTheDocument();
    expect(screen.getByText(/fixture alerts remain unresolved/i)).toBeInTheDocument();
    expect(screen.queryByText(/persisted workload summary/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Operator sign in" })).not.toBeInTheDocument();
  });

  it("keeps fixture observation validation local and read-only", async () => {
    history.replaceState(null, "", "/?fixture=true");
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("link", { name: "Test observations" }));
    await user.click(await screen.findByRole("button", { name: "Load verified normal example" }));

    expect(screen.getByText(/Fixture preview validates files locally/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyze 1 row" })).toBeDisabled();
  });

  it("keeps every primary destination directly navigable and marks the current route", async () => {
    history.replaceState(null, "", "/?fixture=true");
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getAllByRole("link", { name: /Monitor|Triage alerts|Map routes|Validate models|Test observations/ })).toHaveLength(5);
    await user.click(screen.getByRole("link", { name: "Validate models" }));

    expect(screen.getByRole("link", { name: "Validate models" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Model analysis" })).toBeInTheDocument();
  });
});
