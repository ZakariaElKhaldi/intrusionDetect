import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "../auth";
import {
  getAuthenticationStatus,
  getCurrentUser,
  login,
  setApiAccessToken,
  setUnauthorizedHandler,
} from "../api";

vi.mock("../api", () => ({
  getAuthenticationStatus: vi.fn(),
  getCurrentUser: vi.fn(),
  login: vi.fn(),
  setApiAccessToken: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
}));

const STORAGE_KEY = "iot-ids-auth-session";

function Harness() {
  const auth = useAuth();
  return <><button type="button" onClick={auth.openLogin}>Open sign in</button><output>{auth.authenticated ? "authenticated" : "signed out"}</output></>;
}

describe("operator authentication experience", () => {
  beforeEach(() => {
    history.replaceState(null, "", "/");
    window.sessionStorage.clear();
    vi.mocked(getAuthenticationStatus).mockResolvedValue({ enabled: true });
    vi.mocked(getCurrentUser).mockResolvedValue({ username: "admin", role: "admin" });
  });

  it("does not contact authentication services in fixture preview", () => {
    history.replaceState(null, "", "/?fixture=true");
    render(<AuthProvider><Harness /></AuthProvider>);

    expect(getAuthenticationStatus).not.toHaveBeenCalled();
    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(setApiAccessToken).toHaveBeenCalledWith(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("contains modal focus, closes with Escape, and restores the invoking control", async () => {
    const user = userEvent.setup();
    render(<AuthProvider><Harness /></AuthProvider>);
    const opener = screen.getByRole("button", { name: "Open sign in" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Operator sign in" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toHaveValue("");
    const submit = screen.getByRole("button", { name: /^Sign in$/ });
    submit.focus();
    await user.tab();
    expect(screen.getByLabelText("Username")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("actively clears a session when its declared expiry is reached", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T12:00:00Z"));
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      access_token: "short-lived-token",
      token_type: "bearer",
      expires_in: 1,
      expires_at: "2026-08-10T12:00:01Z",
      username: "admin",
    }));

    render(<AuthProvider><Harness /></AuthProvider>);
    expect(screen.getByText("authenticated")).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1_001));

    expect(screen.getByText("signed out")).toBeInTheDocument();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(setApiAccessToken).toHaveBeenLastCalledWith(null);
    expect(setUnauthorizedHandler).toHaveBeenCalled();
  });

  it("shows and enforces the server-declared login retry time", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-11T10:00:00Z"));
    vi.mocked(login).mockRejectedValue(Object.assign(
      new Error("Too many failed login attempts"),
      { status: 429, retryAfterSeconds: 60 },
    ));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AuthProvider><Harness /></AuthProvider>);

    await user.click(screen.getByRole("button", { name: "Open sign in" }));
    await user.type(screen.getByLabelText("Username"), "admin");
    await user.type(screen.getByLabelText("Password"), "incorrect");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Too many failed login attempts");
    expect(
      screen.getByText(/Try again after/).querySelector("time")?.getAttribute("datetime"),
    ).toMatch(/^2026-08-11T10:01:00\.\d{3}Z$/);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();

    await act(async () => vi.advanceTimersByTimeAsync(60_001));
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });
});
