import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SensorStatus } from "../../types";
import { connectedDashboardSummary } from "./overviewFixtures";
import { LivePacketLoadChart, SeverityTimelineChart } from "./LiveEvidenceCharts";

function sensor(checkedAt: string, packets: number, captureDrops = 0): SensorStatus {
  return {
    status: "online",
    checked_at: checkedAt,
    aggregate: { packets, capture_drops: captureDrops, events_seen: 0, alerts_accepted: 0 },
    sensors: [{
      sensor_id: "presentation-lab",
      status: "online",
      interface: "iotlab0",
      engine_version: "8.0.4",
      rule_count: 3,
      packets,
      capture_drops: captureDrops,
      events_seen: 0,
      alerts_accepted: 0,
      last_event_at: checkedAt,
      last_heartbeat_at: checkedAt,
    }],
  };
}

describe("live D3 evidence charts", () => {
  beforeEach(() => sessionStorage.clear());

  it("exposes exact stacked interval values and supports keyboard investigation", () => {
    const onSelect = vi.fn();
    render(<SeverityTimelineChart rows={connectedDashboardSummary.severity_timeline} bucketMinutes={60} onSelect={onSelect}/>);

    const interval = screen.getByRole("button", { name: /2 alerts; 0 critical, 1 high, 1 medium, 0 low/i });
    fireEvent.focus(interval);
    expect(screen.getByText("2 total · 0 critical · 1 high · 1 medium · 0 low")).toBeInTheDocument();
    fireEvent.keyDown(interval, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("2026-08-11T06:00:00Z", 60);
  });

  it("derives packet rate from consecutive authoritative counters", () => {
    const view = render(<LivePacketLoadChart status={sensor("2026-08-20T12:00:00Z", 100)}/>);
    expect(screen.getByText("Collecting…")).toBeInTheDocument();

    view.rerender(<LivePacketLoadChart status={sensor("2026-08-20T12:00:05Z", 150, 1)}/>);
    expect(screen.getAllByText("10.0 pkt/s")).toHaveLength(2);
    expect(screen.getByRole("img", { name: /current 10.0 packets per second.*1 total capture drops/i })).toBeInTheDocument();
  });

  it("restores the rolling packet history after a page refresh", () => {
    const first = render(<LivePacketLoadChart status={sensor("2026-08-20T12:00:00Z", 100)}/>);
    first.rerender(<LivePacketLoadChart status={sensor("2026-08-20T12:00:05Z", 150, 1)}/>);
    expect(screen.getAllByText("10.0 pkt/s")).toHaveLength(2);
    first.unmount();

    render(<LivePacketLoadChart status={sensor("2026-08-20T12:00:10Z", 225, 1)}/>);

    expect(screen.getAllByText("15.0 pkt/s")).toHaveLength(2);
    expect(screen.getByText("Samples").parentElement).toHaveTextContent("2");
  });
});
