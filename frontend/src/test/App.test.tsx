import { render, screen } from "@testing-library/react";
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
    expect(screen.getByRole("table", { name: "Security alerts" })).toBeInTheDocument();
  });

  it("opens and dismisses alert details without losing the alert list", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /Alerts/i }));
    const rows = screen.getAllByRole("row");
    await user.click(rows[0]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close alert details" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Security alerts" })).toBeInTheDocument();
  });

  it("exposes replay controls to keyboard and assistive technology", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "Start replay" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "Replay speed" })).toHaveValue("1");
  });
});
