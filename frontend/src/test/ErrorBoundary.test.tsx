import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../components/ErrorBoundary";

function BrokenView({ secret = "private observation payload" }: { secret?: string }): ReactNode {
  throw new Error(secret);
}

describe("ErrorBoundary", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("contains render failures without exposing thrown details", () => {
    render(
      <ErrorBoundary>
        <BrokenView />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("This workspace could not be displayed");
    expect(screen.getByRole("alert")).not.toHaveTextContent("private observation payload");
    expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus();
    expect(consoleError).toHaveBeenCalledWith(
      "Frontend render failure",
      expect.objectContaining({ errorName: "Error" }),
    );
  });

  it("lets an operator retry after the underlying failure clears", async () => {
    let broken = true;
    function RecoverableView() {
      if (broken) throw new Error("temporary failure");
      return <p>Recovered workspace</p>;
    }
    render(
      <ErrorBoundary>
        <RecoverableView />
      </ErrorBoundary>,
    );

    broken = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Recovered workspace")).toBeInTheDocument();
  });

  it("resets a contained failure when navigation changes the reset key", async () => {
    function RoutedHarness() {
      const [route, setRoute] = useState("broken");
      return (
        <>
          <button type="button" onClick={() => setRoute("healthy")}>Open healthy route</button>
          <ErrorBoundary resetKey={route}>
            {route === "broken" ? <BrokenView /> : <p>Healthy route</p>}
          </ErrorBoundary>
        </>
      );
    }
    render(<RoutedHarness />);

    await userEvent.click(screen.getByRole("button", { name: "Open healthy route" }));
    expect(screen.getByText("Healthy route")).toBeInTheDocument();
  });
});
