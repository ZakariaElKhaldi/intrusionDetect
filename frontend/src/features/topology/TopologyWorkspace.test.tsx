import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Alert } from "../../types";

const mocks = vi.hoisted(() => {
  const collection = {
    length: 1,
    remove: vi.fn(),
    data: vi.fn(),
    addClass: vi.fn(),
    removeClass: vi.fn(),
    neighborhood: vi.fn(),
    connectedNodes: vi.fn(),
  };
  collection.removeClass.mockReturnValue(collection);
  collection.addClass.mockReturnValue(collection);
  collection.neighborhood.mockReturnValue(collection);
  collection.connectedNodes.mockReturnValue(collection);
  const core = {
    on: vi.fn(),
    batch: vi.fn((callback: () => void) => callback()),
    elements: vi.fn(() => collection),
    add: vi.fn(),
    getElementById: vi.fn(() => collection),
    layout: vi.fn(() => ({ run: vi.fn() })),
    animate: vi.fn(),
    zoom: vi.fn(() => 1),
    fit: vi.fn(),
    removeAllListeners: vi.fn(),
    destroy: vi.fn(),
  };
  return { collection, core, use: vi.fn(), factory: vi.fn(() => core) };
});

vi.mock("cytoscape", () => ({
  default: Object.assign(mocks.factory, { use: mocks.use }),
}));
vi.mock("cytoscape-fcose", () => ({ default: vi.fn() }));

import { TopologyWorkspace } from "./TopologyWorkspace";

const alerts: Alert[] = [
  {
    id: "a-1",
    timestamp: new Date().toISOString(),
    attack_type: "Port scan",
    confidence: 0.98,
    severity: "critical",
    source_ip: "port:443",
    destination_ip: "10.0.0.3",
    protocol: "TCP",
    status: "new",
  },
];

describe("TopologyWorkspace", () => {
  it("provides an accessible endpoint and directed-route investigation surface", () => {
    render(<TopologyWorkspace alerts={alerts} onViewAlerts={vi.fn()} />);

    expect(screen.getByRole("note")).toHaveTextContent("limited observations");
    expect(screen.getByText("port:443 → 10.0.0.3")).toBeInTheDocument();
    expect(screen.getByLabelText(/Directed network map with 2 endpoints and 1 routes/)).toBeInTheDocument();
  });

  it("opens related alerts from the selected endpoint", () => {
    const onViewAlerts = vi.fn();
    render(<TopologyWorkspace alerts={alerts} onViewAlerts={onViewAlerts} />);

    fireEvent.click(screen.getByRole("button", { name: /port:443 critical/i }));
    fireEvent.click(screen.getByRole("button", { name: "View related alerts" }));
    expect(onViewAlerts).toHaveBeenCalledWith("port:443");
  });

  it("filters by protocol and elevated unresolved activity", () => {
    render(<TopologyWorkspace alerts={[
      ...alerts,
      { ...alerts[0], id: "a-2", source_ip: "host-a", destination_ip: "host-b", protocol: "UDP", severity: "low" },
    ]} onViewAlerts={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Protocol"), { target: { value: "UDP" } });
    expect(screen.getByText("2 endpoints · 1 directed routes · 1 alerts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All activity" }));
    expect(screen.getByText("0 endpoints · 0 directed routes · 0 alerts")).toBeInTheDocument();
  });

  it("does not rerun fCoSE when a live update only changes aggregate values", () => {
    mocks.core.layout.mockClear();
    const { rerender, unmount } = render(<TopologyWorkspace alerts={alerts} onViewAlerts={vi.fn()} />);
    const layoutCalls = mocks.core.layout.mock.calls.length;

    rerender(<TopologyWorkspace alerts={[
      ...alerts,
      { ...alerts[0], id: "a-2", severity: "high" },
    ]} onViewAlerts={vi.fn()} />);

    expect(mocks.core.layout).toHaveBeenCalledTimes(layoutCalls);
    unmount();
    expect(mocks.core.destroy).toHaveBeenCalled();
  });
});
