import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SensorStatus } from "../../types";
import { SensorStatusPanel } from "./SensorStatusPanel";

const status: SensorStatus = {
  status: "online",
  sensors: [{
    sensor_id: "presentation-lab", status: "online", interface: "iotlab0",
    engine_version: "8.0.4", rule_count: 3, packets: 321, capture_drops: 0,
    events_seen: 10, alerts_accepted: 2, last_event_at: "2026-08-20T20:00:00Z",
    last_heartbeat_at: "2026-08-20T20:00:01Z",
  }],
  aggregate: { packets: 321, capture_drops: 0, events_seen: 10, alerts_accepted: 2 },
  checked_at: "2026-08-20T20:00:01Z",
};

describe("SensorStatusPanel", () => {
  it("shows packet capture evidence instead of inferring sensor health from the API", () => {
    render(<SensorStatusPanel status={status} loading={false} error="" fixtureMode={false} onRetry={vi.fn()}/>);
    expect(screen.getByRole("status")).toHaveTextContent("Online");
    expect(screen.getByText("iotlab0")).toBeInTheDocument();
    expect(screen.getByText("321")).toBeInTheDocument();
    expect(screen.getByText(/Suricata 8\.0\.4/)).toBeInTheDocument();
  });
});
