import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ModelInfo } from "../../types";
import { ModelAnalysis } from "./ModelAnalysis";

const models: ModelInfo[] = [
  { name: "Isolation detector", version: "detector-7", role: "detector", status: "active", probability_calibrated: true, macro_f1: 0.94 },
  { name: "Forest classifier", version: "classifier-4", role: "classifier", status: "active", probability_calibrated: false, macro_f1: 0.88 },
];

describe("ModelAnalysis", () => {
  it("separates serving evidence from offline evaluation", async () => {
    render(<ModelAnalysis models={models} fixtureMode />);

    expect(screen.getByRole("heading", { name: "Serving bundle" })).toBeInTheDocument();
    expect(screen.getByText("detector-7")).toBeInTheDocument();
    expect(screen.queryByText(/random shared-split evidence/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Offline evaluation" }));
    expect(screen.getByText(/random shared-split evidence/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Isolation detector" })).toBeInTheDocument();
  });

  it("supports keyboard navigation between workspace views", async () => {
    render(<ModelAnalysis models={models} fixtureMode />);
    const operationsTab = screen.getByRole("tab", { name: "Serving & health" });
    operationsTab.focus();
    await userEvent.keyboard("{ArrowRight}{Enter}");
    expect(screen.getByRole("tab", { name: "Offline evaluation" })).toHaveAttribute("aria-selected", "true");
  });
});
