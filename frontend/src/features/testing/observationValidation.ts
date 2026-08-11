import { parseCsv } from "../../utils";
import { verifiedNormalObservationCsv } from "../../sampleObservation";
import type { ProcessingMode } from "./ObservationResults";

const canonicalRow = parseCsv(verifiedNormalObservationCsv)[0];

export const canonicalObservationHeaders = Object.keys(canonicalRow).filter((header) => header !== "Attack_type");
export const categoricalObservationHeaders = canonicalObservationHeaders.filter((header) => typeof canonicalRow[header] === "string");
const categorical = new Set(categoricalObservationHeaders);

export interface ObservationValidationIssue {
  row: number;
  feature: string;
  message: string;
}

export interface ObservationValidation {
  valid: boolean;
  missing: string[];
  extra: string[];
  orderMatches: boolean;
  issueCount: number;
  issues: ObservationValidationIssue[];
  numericFeatureCount: number;
  categoricalFeatureCount: number;
}

export const processingModeLimits: Record<ProcessingMode, number> = {
  immediate: 10_000,
  durable: 1_000,
  replay: 100_000,
};

export function validateObservationRows(rows: Record<string, string | number>[]): ObservationValidation {
  if (!rows.length) {
    return {
      valid: false,
      missing: [],
      extra: [],
      orderMatches: false,
      issueCount: 0,
      issues: [],
      numericFeatureCount: canonicalObservationHeaders.length - categorical.size,
      categoricalFeatureCount: categorical.size,
    };
  }

  const headers = Object.keys(rows[0]).filter((header) => header !== "Attack_type");
  const missing = canonicalObservationHeaders.filter((header) => !headers.includes(header));
  const extra = headers.filter((header) => !canonicalObservationHeaders.includes(header));
  const orderMatches = headers.length === canonicalObservationHeaders.length
    && canonicalObservationHeaders.every((header, index) => headers[index] === header);
  const issues: ObservationValidationIssue[] = [];
  let issueCount = 0;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    for (const feature of canonicalObservationHeaders) {
      const value = row[feature];
      const invalid = categorical.has(feature)
        ? typeof value !== "string" || !value.trim()
        : typeof value !== "number" || !Number.isFinite(value);
      if (!invalid) continue;
      issueCount += 1;
      if (issues.length < 50) {
        issues.push({
          row: rowIndex + 1,
          feature,
          message: categorical.has(feature)
            ? "must contain a non-blank text value"
            : "must contain a finite numeric value",
        });
      }
    }
  }

  return {
    valid: !missing.length && !extra.length && orderMatches && issueCount === 0,
    missing,
    extra,
    orderMatches,
    issueCount,
    issues,
    numericFeatureCount: canonicalObservationHeaders.length - categorical.size,
    categoricalFeatureCount: categorical.size,
  };
}

export function processingModeIssue(mode: ProcessingMode, rowCount: number): string {
  if (rowCount <= processingModeLimits[mode]) return "";
  const labels: Record<ProcessingMode, string> = {
    immediate: "Immediate analysis",
    durable: "Durable ingestion",
    replay: "Custom replay",
  };
  return `${labels[mode]} accepts at most ${processingModeLimits[mode].toLocaleString()} observations. Split the file or choose a compatible processing path.`;
}
