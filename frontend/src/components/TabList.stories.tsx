import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { TabList, tabId } from "./TabList";

function InteractiveTabs() {
  const [selected, setSelected] = useState<"queue" | "history">("queue");
  return <><TabList baseId="storybook-tabs" label="Alert evidence" options={[{ value: "queue", label: "Open queue" }, { value: "history", label: "Decision history" }]} panelId="storybook-tab-panel" selected={selected} onSelect={setSelected} /><section className="panel" id="storybook-tab-panel" role="tabpanel" aria-labelledby={tabId("storybook-tabs", selected)} style={{ marginTop: 12, padding: 18 }}>Showing {selected === "queue" ? "open alerts" : "analyst decisions"}.</section></>;
}

const meta = {
  title: "Components/Tab list",
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Arrow keys, Home, and End move focus. Enter or Space activates the focused tab." } } },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Interactive: Story = {
  render: () => <InteractiveTabs />,
  play: async ({ canvas, userEvent }) => {
    const queueTab = canvas.getByRole("tab", { name: "Open queue" });
    const historyTab = canvas.getByRole("tab", { name: "Decision history" });

    await expect(queueTab).toHaveAttribute("aria-selected", "true");
    queueTab.focus();
    await userEvent.keyboard("{ArrowRight}{Enter}");
    await expect(historyTab).toHaveFocus();
    await expect(historyTab).toHaveAttribute("aria-selected", "true");
    await expect(canvas.getByRole("tabpanel")).toHaveTextContent("Showing analyst decisions");
  },
};
