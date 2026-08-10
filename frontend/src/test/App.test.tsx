import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

describe("dashboard", () => {
  beforeEach(() => {
    history.replaceState(null, "", "/");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("navigates between the investigation pages", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole("heading", { name: "Live overview" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Alerts/i }));
    expect(screen.getByRole("heading", { name: "Alert investigation" })).toBeInTheDocument();
    expect(document.title).toBe("Alert investigation · Sentinel");
    expect(screen.getByRole("main")).toHaveFocus();
    expect(await screen.findByRole("table", { name: "Security alerts" }, { timeout: 3_000 })).toBeInTheDocument();
  });

  it("opens and dismisses alert details without losing the alert list", async () => {
    history.replaceState(null, "", "/?fixture=true");
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /Alerts/i }));
    const alertButtons = await screen.findAllByRole("button", { name: /^Open .* alert / });
    await user.click(alertButtons[0]);
    expect(await screen.findByRole("dialog", {}, { timeout: 2_000 })).toBeInTheDocument();
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
    expect(screen.getByRole("combobox", { name: "Replay speed" })).toHaveValue("1");
    expect(screen.getByRole("combobox", { name: "Replay scenario" })).toHaveValue("attack");
    expect(screen.getByRole("spinbutton", { name: "Replay limit" })).toHaveValue(40);
  });

  it("never substitutes fixture alerts when the connected API is offline", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /Alerts/i }));
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
    expect(screen.queryByRole("button", { name: "Operator sign in" })).not.toBeInTheDocument();
  });

  it("keeps fixture observation validation local and read-only", async () => {
    history.replaceState(null, "", "/?fixture=true");
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getAllByRole("button", { name: "Test observations" })[0]);
    await user.click(await screen.findByRole("button", { name: "Load verified normal example" }));

    expect(screen.getByText(/Fixture preview validates files locally/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Predict 1 row" })).toBeDisabled();
  });

  it("closes the mobile navigation disclosure after choosing a destination", async () => {
    history.replaceState(null, "", "/?fixture=true");
    const user = userEvent.setup();
    render(<App />);
    const summary = screen.getByText("More").closest("summary");
    const disclosure = summary?.closest("details");
    expect(summary).not.toBeNull();
    expect(disclosure).not.toBeNull();

    await user.click(summary!);
    expect(disclosure).toHaveAttribute("open");
    await user.click(within(disclosure!).getByRole("button", { name: "Validate models" }));

    expect(disclosure).not.toHaveAttribute("open");
    expect(within(disclosure!).getByRole("button", { name: "Validate models" })).toHaveAttribute("aria-current", "page");
    expect(summary).toHaveAccessibleName("More navigation, current page Model analysis");
    expect(screen.getByRole("heading", { name: "Model evidence" })).toBeInTheDocument();
  });
});
