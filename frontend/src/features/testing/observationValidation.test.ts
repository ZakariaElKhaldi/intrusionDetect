import { describe, expect, it } from "vitest";
import { verifiedNormalObservationCsv } from "../../sampleObservation";
import { parseCsv } from "../../utils";
import {
  canonicalObservationHeaders,
  processingModeIssue,
  validateObservationRows,
} from "./observationValidation";

const validRow = () => ({ ...parseCsv(verifiedNormalObservationCsv)[0] });

describe("observation validation", () => {
  it("accepts a verified row with the canonical ordered feature contract", () => {
    const result = validateObservationRows([validRow()]);

    expect(result.valid).toBe(true);
    expect(result.orderMatches).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.extra).toEqual([]);
    expect(result.issueCount).toBe(0);
    expect(result.numericFeatureCount + result.categoricalFeatureCount).toBe(83);
  });

  it("reports corrective row and feature evidence for blank and non-finite values", () => {
    const row = validRow();
    row.proto = " ";
    row.flow_duration = Number.NaN;
    const result = validateObservationRows([row]);

    expect(result.valid).toBe(false);
    expect(result.issueCount).toBe(2);
    expect(result.issues).toEqual(expect.arrayContaining([
      { row: 1, feature: "proto", message: "must contain a non-blank text value" },
      { row: 1, feature: "flow_duration", message: "must contain a finite numeric value" },
    ]));
  });

  it("distinguishes missing, unexpected, and out-of-order columns", () => {
    const row = validRow();
    const missing = { ...row };
    delete missing.flow_duration;
    expect(validateObservationRows([missing]).missing).toContain("flow_duration");

    const extra = { ...row, unsupported_feature: 1 };
    expect(validateObservationRows([extra]).extra).toContain("unsupported_feature");

    const reordered = Object.fromEntries([...canonicalObservationHeaders].reverse().map((key) => [key, row[key]]));
    const reorderedResult = validateObservationRows([reordered]);
    expect(reorderedResult.missing).toEqual([]);
    expect(reorderedResult.extra).toEqual([]);
    expect(reorderedResult.orderMatches).toBe(false);
  });

  it("enforces each backend path limit with a corrective alternative", () => {
    expect(processingModeIssue("immediate", 10_000)).toBe("");
    expect(processingModeIssue("immediate", 10_001)).toMatch(/at most 10,000 observations/i);
    expect(processingModeIssue("durable", 1_001)).toMatch(/at most 1,000 observations/i);
    expect(processingModeIssue("replay", 100_001)).toMatch(/at most 100,000 observations/i);
  });
});
