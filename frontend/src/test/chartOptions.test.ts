import { describe, expect, it } from "vitest";
import {
  confusionMatrixOption,
  evidenceOption,
  modelComparisonOption,
  protocolDistributionOption,
  severityTimelineOption,
} from "../components/charts/chartOptions";

describe("analytical chart options", () => {
  it("enables ARIA and labels timeline axes with data meaning", () => {
    const option = severityTimelineOption([{
      start: "2026-07-23T10:00:00.000Z",
      timestamp: Date.parse("2026-07-23T10:00:00.000Z"),
      total: 1,
      counts: { critical: 1, high: 0, medium: 0, low: 0, normal: 0 },
    }]) as Record<string, any>;
    expect(option.aria.enabled).toBe(true);
    expect(option.xAxis.name).toBe("Time");
    expect(option.yAxis.name).toBe("Alerts");
    expect(option.series).toHaveLength(5);
  });

  it("labels protocol charts as alert counts and retains percentages", () => {
    const option = protocolDistributionOption([
      { protocol: "TCP", count: 4, percentage: 80 },
    ]) as Record<string, any>;
    expect(option.xAxis.name).toBe("Alert count");
    expect(option.series[0].label.formatter({ dataIndex: 0 })).toBe("80.0%");
  });

  it("uses separate, direction-labelled model axes", () => {
    const option = modelComparisonOption([{
      name: "Forest",
      version: "2",
      status: "active",
      macro_f1: 0.94,
      weighted_f1: 0.97,
      false_positive_rate: 0.02,
      inference_ms: 3.5,
    }]) as Record<string, any>;
    expect(option.xAxis).toHaveLength(4);
    expect(option.xAxis[0].name).toContain("higher is better");
    expect(option.xAxis[2].name).toContain("lower is better");
  });

  it("annotates confusion matrix cells with count and row percentage", () => {
    const option = confusionMatrixOption([[8, 2], [1, 9]], ["Normal", "Attack"]) as Record<string, any>;
    expect(option.xAxis.name).toBe("Predicted class");
    expect(option.yAxis.name).toBe("Actual class");
    expect(option.series[0].data[1]).toEqual([1, 0, 20, 2]);
    expect(option.series[0].label.formatter({ value: [1, 0, 20, 2] })).toBe("2\n20.0%");
  });

  it("builds a signed evidence domain around zero", () => {
    const option = evidenceOption([
      { feature: "packet_rate", impact: 0.3 },
      { feature: "duration", impact: -0.2 },
    ]) as Record<string, any>;
    expect(option.xAxis.min).toBe(-0.3);
    expect(option.xAxis.max).toBe(0.3);
    expect(option.series[0].data.map((item: any) => item.value)).toEqual([0.3, -0.2]);
  });
});
