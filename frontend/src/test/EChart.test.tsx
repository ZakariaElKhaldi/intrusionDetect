import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setOption: vi.fn(),
  resize: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  dispose: vi.fn(),
  observe: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("echarts/core", () => ({
  use: vi.fn(),
  init: vi.fn(() => ({
    setOption: mocks.setOption,
    resize: mocks.resize,
    on: mocks.on,
    off: mocks.off,
    dispose: mocks.dispose,
  })),
}));
vi.mock("echarts/charts", () => ({ BarChart: {}, HeatmapChart: {} }));
vi.mock("echarts/components", () => ({
  AriaComponent: {},
  GridComponent: {},
  LegendComponent: {},
  TooltipComponent: {},
  VisualMapComponent: {},
}));
vi.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

import { EChart } from "../components/charts/EChart";

describe("EChart lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class {
        observe = mocks.observe;
        disconnect = mocks.disconnect;
      },
    });
    Object.defineProperty(globalThis, "matchMedia", {
      configurable: true,
      value: () => ({ matches: true }),
    });
  });

  it("updates options without animation and cleans up observers, events, and canvas", () => {
    const click = vi.fn();
    const { unmount } = render(
      <EChart
        option={{ animation: true, aria: { enabled: true } }}
        ariaLabel="Test analytical chart"
        onEvents={{ click }}
      />,
    );

    expect(mocks.observe).toHaveBeenCalledOnce();
    expect(mocks.setOption).toHaveBeenCalledWith(
      expect.objectContaining({ animation: false }),
      { notMerge: true },
    );
    expect(mocks.on).toHaveBeenCalledWith("click", click);

    unmount();
    expect(mocks.off).toHaveBeenCalledWith("click", click);
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
});
