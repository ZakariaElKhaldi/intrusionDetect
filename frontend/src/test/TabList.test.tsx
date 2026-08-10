import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TabList, tabId } from "../components/TabList";

function Harness() {
  const [selected, setSelected] = useState<"first" | "second" | "third">("first");
  return <>
    <TabList
      baseId="test-tabs"
      label="Test views"
      options={[
        { value: "first", label: "First" },
        { value: "second", label: "Second" },
        { value: "third", label: "Third" },
      ]}
      panelId="test-panel"
      selected={selected}
      onSelect={setSelected}
    />
    <div id="test-panel" role="tabpanel" aria-labelledby={tabId("test-tabs", selected)}>{selected}</div>
  </>;
}

describe("TabList", () => {
  it("uses one tab stop and requires activation after arrow-key focus movement", async () => {
    const user = userEvent.setup();
    render(<Harness/>);
    const first = screen.getByRole("tab", { name: "First" });
    const second = screen.getByRole("tab", { name: "Second" });

    expect(first).toHaveAttribute("tabindex", "0");
    expect(second).toHaveAttribute("tabindex", "-1");
    expect(first).toHaveAttribute("aria-controls", "test-panel");

    first.focus();
    await user.keyboard("{ArrowRight}");
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute("tabindex", "0");
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("first");

    await user.keyboard("{Enter}");
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "test-tabs-second-tab");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("second");
  });

  it("wraps arrow focus and supports Home and End", async () => {
    const user = userEvent.setup();
    render(<Harness/>);
    const first = screen.getByRole("tab", { name: "First" });
    const third = screen.getByRole("tab", { name: "Third" });

    first.focus();
    await user.keyboard("{ArrowLeft}");
    expect(third).toHaveFocus();
    await user.keyboard("{Home}");
    expect(first).toHaveFocus();
    await user.keyboard("{End}");
    expect(third).toHaveFocus();
  });
});
