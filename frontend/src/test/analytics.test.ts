import { describe, expect, it } from "vitest";
import type { Alert, ModelInfo } from "../types";
import {
  aggregateDetections,
  aggregateProtocols,
  aggregateSeverityTimeline,
  buildModelMetricSeries,
} from "../lib/analytics";

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "A-1",
    timestamp: "2026-07-23T10:01:00.000Z",
    attack_type: "Port scan",
    confidence: 0.8,
    severity: "high",
    source_ip: "10.0.0.1",
    destination_ip: "10.0.0.2",
    protocol: "TCP",
    status: "new",
    ...overrides,
  };
}

describe("alert analytics", () => {
  it("creates ordered time buckets, fills gaps, and ignores malformed dates", () => {
    const result = aggregateSeverityTimeline([
      alert(),
      alert({ id: "A-2", timestamp: "2026-07-23T10:11:00.000Z", severity: "critical" }),
      alert({ id: "A-3", timestamp: "not-a-date" }),
    ], 5);

    expect(result).toHaveLength(3);
    expect(result[0].counts.high).toBe(1);
    expect(result[1].total).toBe(0);
    expect(result[2].counts.critical).toBe(1);
  });

  it("rejects invalid bucket widths", () => {
    expect(() => aggregateSeverityTimeline([], 0)).toThrow(/positive/);
  });

  it("ranks protocols with honest percentages and normalizes blank labels", () => {
    const result = aggregateProtocols([
      alert(),
      alert({ id: "A-2", protocol: "UDP" }),
      alert({ id: "A-3", protocol: "TCP" }),
      alert({ id: "A-4", protocol: " " }),
    ]);

    expect(result[0]).toEqual({ protocol: "TCP", count: 2, percentage: 50 });
    expect(result.find((item) => item.protocol === "Unknown")?.count).toBe(1);
  });

  it("reports unresolved counts and median confidence by detection family", () => {
    const result = aggregateDetections([
      alert({ confidence: 0.9 }),
      alert({ id: "A-2", confidence: 0.5, status: "resolved" }),
      alert({ id: "A-3", attack_type: "DDoS", confidence: 0.99 }),
    ]);

    expect(result[0]).toMatchObject({
      detection: "Port scan",
      count: 2,
      unresolvedCount: 1,
      medianConfidence: 0.7,
    });
  });
});

describe("model analytics", () => {
  it("preserves metric units and direction while excluding absent values", () => {
    const models: ModelInfo[] = [{
      name: "Forest",
      version: "2",
      status: "active",
      macro_f1: 0.94,
      false_positive_rate: 0.02,
      inference_ms: 3.5,
    }];
    const result = buildModelMetricSeries(models);

    expect(result).toHaveLength(3);
    expect(result.find((point) => point.metric === "macro_f1")).toMatchObject({
      displayValue: 94,
      unit: "%",
      direction: "higher",
    });
    expect(result.find((point) => point.metric === "inference_ms")).toMatchObject({
      displayValue: 3.5,
      unit: "ms",
      direction: "lower",
    });
  });
});
