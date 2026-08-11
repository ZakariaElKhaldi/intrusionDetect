import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { emptyJobFilters, emptyOutboxFilters, JobOperationsFilters, OutboxOperationsFilters, type JobFilterValues, type OutboxFilterValues } from "./IngestionOperationsFilters";

function JobFiltersStory({ initial = emptyJobFilters }: { initial?: JobFilterValues }) {
  const [applied, setApplied] = useState(initial);
  return <JobOperationsFilters applied={applied} onApply={setApplied} />;
}

function OutboxFiltersStory({ initial = emptyOutboxFilters }: { initial?: OutboxFilterValues }) {
  const [applied, setApplied] = useState(initial);
  return <OutboxOperationsFilters applied={applied} onApply={setApplied} />;
}

const meta = {
  title: "Workspaces/Overview/Operations filters",
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Draft filters do not change server evidence until Apply filters is activated. Active scope always describes the applied query." } } },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const AllJobs: Story = { render: () => <JobFiltersStory /> };
export const TimeBoundFailures: Story = { render: () => <JobFiltersStory initial={{ state: "dead_letter", error: "schema_rejected", source: "sensor-a", createdFrom: "2026-08-07T09:00", createdTo: "2026-08-07T11:00" }} /> };
export const PublicationEvents: Story = { render: () => <OutboxFiltersStory /> };
export const AlertPublications: Story = { render: () => <OutboxFiltersStory initial={{ status: "pending", eventType: "alert.created" }} /> };
