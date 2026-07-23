import { describe, expect, it } from "vitest";
import { filterAlerts, parseCsv } from "../utils";
import { sampleAlerts } from "../data";
import { savedObservationCsv } from "../sampleObservation";

describe("parseCsv", () => {
  it("parses numeric and categorical feature values", () => {
    const rows = parseCsv("duration_ms,protocol,src_bytes\n1200,TCP,42");
    expect(rows).toEqual([{ duration_ms: 1200, protocol: "TCP", src_bytes: 42 }]);
  });

  it("rejects rows with a mismatched column count", () => {
    expect(() => parseCsv("duration_ms,protocol\n1200,TCP,extra")).toThrow(/column count/i);
  });

  it("requires unique headers", () => {
    expect(() => parseCsv("protocol,protocol\nTCP,UDP")).toThrow(/unique/i);
  });

  it("loads the saved scenario at the canonical 83-feature boundary", () => {
    const [row] = parseCsv(savedObservationCsv);
    expect(Object.keys(row)).toHaveLength(84);
    expect(row.Attack_type).toBe("MQTT");
  });
});

describe("filterAlerts", () => {
  it("combines text, severity, and status filters", () => {
    const subject = sampleAlerts[0];
    const matches = filterAlerts(sampleAlerts, subject.source_ip, subject.severity, subject.status);
    expect(matches).toContainEqual(subject);
    expect(matches.every((alert) => alert.severity === subject.severity)).toBe(true);
  });
});
