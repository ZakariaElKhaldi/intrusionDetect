import type { EChartsCoreOption } from "echarts/core";
import type { Alert, ModelInfo } from "../../types";
import {
  MODEL_METRICS,
  SEVERITY_ORDER,
  aggregateDetections,
  aggregateProtocols,
  aggregateSeverityTimeline,
  buildModelMetricSeries,
  type DetectionAggregate,
  type ProtocolAggregate,
  type SeverityTimeBucket,
} from "../../lib/analytics";
import { chartPalette as color } from "./palette";

export type ChartOption = EChartsCoreOption;

const axis = {
  axisLine: { lineStyle: { color: color.border } },
  axisTick: { show: false },
  axisLabel: { color: color.inkMuted },
  splitLine: { lineStyle: { color: color.surfaceMuted } },
};

const base = {
  backgroundColor: "transparent",
  animationDuration: 240,
  textStyle: { color: color.ink, fontFamily: "system-ui, sans-serif" },
  aria: { enabled: true, decal: { show: true } },
  tooltip: {
    trigger: "axis",
    backgroundColor: color.surface,
    borderColor: color.border,
    textStyle: { color: color.ink },
  },
} as const;

export function severityTimelineOption(
  buckets: SeverityTimeBucket[],
): ChartOption {
  return {
    ...base,
    aria: {
      ...base.aria,
      description: "Stacked alert counts over time, grouped by severity.",
    },
    grid: { top: 46, right: 16, bottom: 52, left: 52 },
    legend: {
      top: 0,
      textStyle: { color: color.inkMuted },
      data: SEVERITY_ORDER.map((severity) => severity[0].toUpperCase() + severity.slice(1)),
    },
    xAxis: {
      ...axis,
      type: "category",
      name: "Time",
      nameLocation: "middle",
      nameGap: 34,
      data: buckets.map((bucket) => bucket.start),
      axisLabel: {
        ...axis.axisLabel,
        formatter: (value: string) => new Date(value).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
    },
    yAxis: {
      ...axis,
      type: "value",
      name: "Alerts",
      minInterval: 1,
    },
    series: SEVERITY_ORDER.map((severity) => ({
      name: severity[0].toUpperCase() + severity.slice(1),
      type: "bar",
      stack: "severity",
      emphasis: { focus: "series" },
      itemStyle: { color: color.severity[severity] },
      data: buckets.map((bucket) => bucket.counts[severity]),
    })),
  };
}

export function protocolDistributionOption(
  data: ProtocolAggregate[],
): ChartOption {
  return {
    ...base,
    aria: { ...base.aria, description: "Protocols represented among alerts, ranked by count." },
    grid: { top: 12, right: 72, bottom: 34, left: 86, containLabel: true },
    tooltip: {
      ...base.tooltip,
      formatter: (params: unknown) => {
        const item = Array.isArray(params) ? params[0] as { dataIndex: number } : params as { dataIndex: number };
        const row = data[item?.dataIndex];
        return row ? `${row.protocol}<br/>${row.count} alerts · ${row.percentage.toFixed(1)}%` : "";
      },
    },
    xAxis: { ...axis, type: "value", name: "Alert count", minInterval: 1 },
    yAxis: {
      ...axis,
      type: "category",
      inverse: true,
      data: data.map((item) => item.protocol),
    },
    series: [{
      type: "bar",
      name: "Alerts",
      data: data.map((item) => item.count),
      itemStyle: { color: color.ink },
      label: {
        show: true,
        position: "right",
        color: color.inkMuted,
        formatter: (params: { dataIndex: number }) => `${data[params.dataIndex]?.percentage.toFixed(1)}%`,
      },
    }],
  };
}

export function detectionRankingOption(
  data: DetectionAggregate[],
): ChartOption {
  const shown = data.slice(0, 10);
  return {
    ...base,
    aria: {
      ...base.aria,
      description: "Detection families ranked by total and unresolved alert counts.",
    },
    grid: { top: 44, right: 44, bottom: 36, left: 110, containLabel: true },
    legend: {
      top: 0,
      textStyle: { color: color.inkMuted },
      data: ["Resolved", "Unresolved"],
    },
    xAxis: { ...axis, type: "value", name: "Alert count", minInterval: 1 },
    yAxis: {
      ...axis,
      type: "category",
      inverse: true,
      data: shown.map((item) => item.detection),
    },
    tooltip: {
      ...base.tooltip,
      formatter: (params: unknown) => {
        const items = (Array.isArray(params) ? params : [params]) as { dataIndex: number }[];
        const row = shown[items[0]?.dataIndex];
        if (!row) return "";
        return `${row.detection}<br/>${row.count} total · ${row.unresolvedCount} unresolved` +
          `<br/>Median score ${(row.medianConfidence * 100).toFixed(1)}%`;
      },
    },
    series: [
      {
        name: "Resolved",
        type: "bar",
        stack: "status",
        data: shown.map((item) => item.count - item.unresolvedCount),
        itemStyle: { color: color.border },
      },
      {
        name: "Unresolved",
        type: "bar",
        stack: "status",
        data: shown.map((item) => item.unresolvedCount),
        itemStyle: { color: color.accent },
      },
    ],
  };
}

export function modelComparisonOption(models: ModelInfo[]): ChartOption {
  const points = buildModelMetricSeries(models);
  const modelNames = models.map((model) => model.name);
  const grids = MODEL_METRICS.map((_, index) => ({
    left: index % 2 === 0 ? "7%" : "57%",
    top: index < 2 ? 42 : 232,
    width: "36%",
    height: 108,
    containLabel: true,
  }));
  const xAxes = MODEL_METRICS.map((metric, index) => ({
    ...axis,
    gridIndex: index,
    type: "value",
    name: `${metric.label} (${metric.unit}) · ${metric.direction} is better`,
    nameLocation: "middle",
    nameGap: 28,
    min: 0,
  }));
  const yAxes = MODEL_METRICS.map((_, index) => ({
    ...axis,
    gridIndex: index,
    type: "category",
    inverse: true,
    data: modelNames,
  }));

  return {
    ...base,
    aria: {
      ...base.aria,
      description: "Model comparison across quality, false-positive rate, and median latency.",
    },
    grid: grids,
    xAxis: xAxes,
    yAxis: yAxes,
    tooltip: {
      ...base.tooltip,
      trigger: "item",
      formatter: (params: { data: { point?: typeof points[number] } }) => {
        const point = params.data.point;
        if (!point) return "Metric unavailable";
        return `${point.model} v${point.version}<br/>${point.label}: ` +
          `${point.displayValue.toFixed(point.unit === "%" ? 2 : 1)}${point.unit}` +
          `<br/>${point.direction === "higher" ? "Higher" : "Lower"} is better`;
      },
    },
    series: MODEL_METRICS.map((metric, index) => ({
      name: metric.label,
      type: "bar",
      xAxisIndex: index,
      yAxisIndex: index,
      data: modelNames.map((model) => {
        const point = points.find((item) => item.model === model && item.metric === metric.key);
        return {
          value: point?.displayValue ?? null,
          point,
          itemStyle: {
            color: point?.status === "active" ? color.accent : color.ink,
          },
        };
      }),
      label: {
        show: true,
        position: "right",
        color: color.ink,
        formatter: (params: { value: number | null }) =>
          params.value === null ? "—" : `${Number(params.value).toFixed(metric.unit === "%" ? 1 : 1)}${metric.unit}`,
      },
    })),
  };
}

export function confusionMatrixOption(
  matrix: number[][],
  classes: string[],
): ChartOption {
  const labels = classes.length === matrix.length
    ? classes
    : matrix.map((_, index) => `Class ${index + 1}`);
  const values = matrix.flatMap((row, actual) => {
    const rowTotal = row.reduce((sum, count) => sum + (Number.isFinite(count) ? count : 0), 0);
    return row.map((raw, predicted) => [
      predicted,
      actual,
      rowTotal ? (raw / rowTotal) * 100 : 0,
      raw,
    ]);
  });

  return {
    ...base,
    aria: {
      ...base.aria,
      description: "Confusion matrix with actual classes on rows and predicted classes on columns.",
    },
    grid: { top: 18, right: 32, bottom: 78, left: 90, containLabel: true },
    tooltip: {
      ...base.tooltip,
      trigger: "item",
      formatter: (params: { value: number[] }) => {
        const [predicted, actual, percentage, raw] = params.value;
        return `Actual: ${labels[actual]}<br/>Predicted: ${labels[predicted]}` +
          `<br/>${raw} observations · ${percentage.toFixed(1)}% of actual class`;
      },
    },
    xAxis: {
      ...axis,
      type: "category",
      name: "Predicted class",
      nameLocation: "middle",
      nameGap: 48,
      data: labels,
    },
    yAxis: {
      ...axis,
      type: "category",
      name: "Actual class",
      nameLocation: "middle",
      nameGap: 68,
      inverse: true,
      data: labels,
    },
    visualMap: {
      min: 0,
      max: 100,
      show: false,
      inRange: { color: [color.surfaceMuted, "#E6B08F", color.accentDark] },
    },
    series: [{
      type: "heatmap",
      data: values,
      label: {
        show: true,
        color: color.ink,
        formatter: (params: { value: number[] }) =>
          `${params.value[3]}\n${params.value[2].toFixed(1)}%`,
      },
      emphasis: { itemStyle: { borderColor: color.ink, borderWidth: 2 } },
      itemStyle: { borderColor: color.surface, borderWidth: 2 },
    }],
  };
}

export function evidenceOption(
  evidence: NonNullable<Alert["explanations"]>,
): ChartOption {
  const sorted = [...evidence]
    .filter((item) => Number.isFinite(item.impact))
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
    .slice(0, 12);
  const extent = Math.max(...sorted.map((item) => Math.abs(item.impact)), 0.1);

  return {
    ...base,
    aria: {
      ...base.aria,
      description: "Signed model evidence. Positive and negative impacts extend from a zero baseline.",
    },
    grid: { top: 12, right: 42, bottom: 42, left: 120, containLabel: true },
    tooltip: {
      ...base.tooltip,
      trigger: "item",
      formatter: (params: { name: string; value: number }) =>
        `${params.name}<br/>Signed impact: ${Number(params.value).toFixed(3)}`,
    },
    xAxis: {
      ...axis,
      type: "value",
      name: "Signed impact",
      min: -extent,
      max: extent,
      axisLine: { show: true, onZero: true, lineStyle: { color: color.ink } },
    },
    yAxis: {
      ...axis,
      type: "category",
      inverse: true,
      data: sorted.map((item) => item.feature),
    },
    series: [{
      type: "bar",
      data: sorted.map((item) => ({
        value: item.impact,
        itemStyle: { color: item.impact >= 0 ? color.accent : color.inkMuted },
      })),
      label: {
        show: true,
        color: color.ink,
        position: "outside",
        formatter: (params: { value: number }) => Number(params.value).toFixed(3),
      },
    }],
  };
}

export function severityTimelineFromAlerts(alerts: Alert[], bucketMinutes = 5): ChartOption {
  return severityTimelineOption(aggregateSeverityTimeline(alerts, bucketMinutes));
}

export function protocolDistributionFromAlerts(alerts: Alert[]): ChartOption {
  return protocolDistributionOption(aggregateProtocols(alerts));
}

export function detectionRankingFromAlerts(alerts: Alert[]): ChartOption {
  return detectionRankingOption(aggregateDetections(alerts));
}
