import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { init, use, type EChartsType } from "echarts/core";
import { BarChart, HeatmapChart } from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ChartOption } from "./chartOptions";

use([
  BarChart,
  HeatmapChart,
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export type EChartEventHandler = (params: unknown) => void;

export interface EChartProps {
  option: ChartOption;
  className?: string;
  style?: CSSProperties;
  ariaLabel: string;
  onEvents?: Record<string, EChartEventHandler>;
  testId?: string;
}

export function EChart({
  option,
  className,
  style,
  ariaLabel,
  onEvents,
  testId,
}: EChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // jsdom has neither layout nor a canvas implementation. Keep the
    // accessible chart container in component tests without booting zrender.
    if (typeof ResizeObserver === "undefined" && navigator.userAgent.includes("jsdom")) return;
    const chart = init(host, undefined, { renderer: "canvas" });
    chartRef.current = chart;

    const resize = () => chart.resize();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(resize);
    observer?.observe(host);
    if (!observer) globalThis.addEventListener?.("resize", resize);

    return () => {
      observer?.disconnect();
      if (!observer) globalThis.removeEventListener?.("resize", resize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onEvents) return;
    for (const [eventName, handler] of Object.entries(onEvents)) {
      chart.on(eventName, handler);
    }
    return () => {
      for (const [eventName, handler] of Object.entries(onEvents)) {
        chart.off(eventName, handler);
      }
    };
  }, [onEvents]);

  useEffect(() => {
    const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    chartRef.current?.setOption({
      ...option,
      animation: reduceMotion ? false : option.animation,
    }, { notMerge: true });
  }, [option]);

  return (
    <div
      ref={hostRef}
      className={className}
      style={{ width: "100%", height: 320, ...style }}
      role="img"
      aria-label={ariaLabel}
      data-testid={testId}
    />
  );
}
