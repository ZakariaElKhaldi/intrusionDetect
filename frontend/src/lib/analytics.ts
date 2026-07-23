import type { Alert, ModelInfo, Severity } from "../types";

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "normal"];

export interface SeverityTimeBucket {
  start: string;
  timestamp: number;
  total: number;
  counts: Record<Severity, number>;
}

export interface ProtocolAggregate {
  protocol: string;
  count: number;
  percentage: number;
}

export interface DetectionAggregate {
  detection: string;
  count: number;
  unresolvedCount: number;
  medianConfidence: number;
}

export type ModelMetricKey = "macro_f1" | "weighted_f1" | "false_positive_rate" | "inference_ms";

export interface ModelMetricDefinition {
  key: ModelMetricKey;
  label: string;
  unit: "%" | "ms";
  direction: "higher" | "lower";
}

export interface ModelMetricPoint {
  model: string;
  version: string;
  status: string;
  metric: ModelMetricKey;
  label: string;
  value: number;
  displayValue: number;
  unit: "%" | "ms";
  direction: "higher" | "lower";
}

export const MODEL_METRICS: ModelMetricDefinition[] = [
  { key: "macro_f1", label: "Macro F1", unit: "%", direction: "higher" },
  { key: "weighted_f1", label: "Weighted F1", unit: "%", direction: "higher" },
  { key: "false_positive_rate", label: "False-positive rate", unit: "%", direction: "lower" },
  { key: "inference_ms", label: "Median latency", unit: "ms", direction: "lower" },
];

function emptySeverityCounts(): Record<Severity, number> {
  return { critical: 0, high: 0, medium: 0, low: 0, normal: 0 };
}

function cleanLabel(value: string | undefined, fallback: string): string {
  const label = value?.trim();
  return label || fallback;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[midpoint]
    : (ordered[midpoint - 1] + ordered[midpoint]) / 2;
}

export function aggregateSeverityTimeline(
  alerts: Alert[],
  bucketMinutes = 5,
): SeverityTimeBucket[] {
  if (!Number.isFinite(bucketMinutes) || bucketMinutes <= 0) {
    throw new RangeError("bucketMinutes must be a positive finite number");
  }

  const bucketMs = bucketMinutes * 60_000;
  const buckets = new Map<number, SeverityTimeBucket>();

  for (const alert of alerts) {
    const timestamp = Date.parse(alert.timestamp);
    if (!Number.isFinite(timestamp)) continue;
    const bucketStart = Math.floor(timestamp / bucketMs) * bucketMs;
    const bucket = buckets.get(bucketStart) ?? {
      start: new Date(bucketStart).toISOString(),
      timestamp: bucketStart,
      total: 0,
      counts: emptySeverityCounts(),
    };
    bucket.counts[alert.severity] += 1;
    bucket.total += 1;
    buckets.set(bucketStart, bucket);
  }

  if (!buckets.size) return [];
  const starts = [...buckets.keys()];
  const first = Math.min(...starts);
  const last = Math.max(...starts);
  const result: SeverityTimeBucket[] = [];

  for (let timestamp = first; timestamp <= last; timestamp += bucketMs) {
    result.push(buckets.get(timestamp) ?? {
      start: new Date(timestamp).toISOString(),
      timestamp,
      total: 0,
      counts: emptySeverityCounts(),
    });
  }
  return result;
}

export function aggregateProtocols(alerts: Alert[]): ProtocolAggregate[] {
  const counts = new Map<string, number>();
  for (const alert of alerts) {
    const protocol = cleanLabel(alert.protocol, "Unknown");
    counts.set(protocol, (counts.get(protocol) ?? 0) + 1);
  }

  const total = alerts.length;
  return [...counts.entries()]
    .map(([protocol, count]) => ({
      protocol,
      count,
      percentage: total ? (count / total) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count || a.protocol.localeCompare(b.protocol));
}

export function aggregateDetections(alerts: Alert[]): DetectionAggregate[] {
  const groups = new Map<string, { count: number; unresolvedCount: number; confidence: number[] }>();
  for (const alert of alerts) {
    const detection = cleanLabel(alert.attack_type, "Unclassified");
    const group = groups.get(detection) ?? { count: 0, unresolvedCount: 0, confidence: [] };
    group.count += 1;
    if (alert.status !== "resolved") group.unresolvedCount += 1;
    if (Number.isFinite(alert.confidence)) group.confidence.push(alert.confidence);
    groups.set(detection, group);
  }

  return [...groups.entries()]
    .map(([detection, group]) => ({
      detection,
      count: group.count,
      unresolvedCount: group.unresolvedCount,
      medianConfidence: median(group.confidence),
    }))
    .sort((a, b) => b.count - a.count || b.unresolvedCount - a.unresolvedCount ||
      a.detection.localeCompare(b.detection));
}

export function buildModelMetricSeries(models: ModelInfo[]): ModelMetricPoint[] {
  return models.flatMap((model) => MODEL_METRICS.flatMap((metric) => {
    const value = model[metric.key];
    if (typeof value !== "number" || !Number.isFinite(value)) return [];
    return [{
      model: model.name,
      version: model.version,
      status: model.status ?? "unspecified",
      metric: metric.key,
      label: metric.label,
      value,
      displayValue: metric.unit === "%" ? value * 100 : value,
      unit: metric.unit,
      direction: metric.direction,
    }];
  }));
}
