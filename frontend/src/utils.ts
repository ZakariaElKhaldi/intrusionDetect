import type { Alert, Page, Severity } from "./types";

export const pageTitles: Record<Page, [string, string]> = {
  overview: ["Live overview", "Traffic posture across your monitored IoT fleet"],
  alerts: ["Alert investigation", "Prioritize, filter, and explain suspicious flows"],
  topology: ["Network topology", "Device relationships and risky communication paths"],
  models: ["Model analysis", "Version performance and deployment health"],
  testing: ["Observation lab", "Validate saved or uploaded traffic observations"],
};

export const severityIcon: Record<Severity, string> = {
  critical: "◆",
  high: "▲",
  medium: "●",
  low: "■",
  normal: "✓",
};

export function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function parseCsv(text: string): Record<string, string | number>[] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let quoteClosed = false;
  const finishField = () => {
    record.push(field.trim());
    field = "";
    quoteClosed = false;
  };
  const finishRecord = () => {
    finishField();
    if (record.some((value) => value !== "")) records.push(record);
    record = [];
  };

  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          quoteClosed = true;
        }
      } else field += character;
      continue;
    }
    if (quoteClosed) {
      if (character === ",") finishField();
      else if (character === "\n" || character === "\r") {
        finishRecord();
        if (character === "\r" && source[index + 1] === "\n") index += 1;
      } else if (!/\s/.test(character)) {
        throw new Error("CSV contains characters after a closing quote.");
      }
      continue;
    }
    if (character === '"') {
      if (field.trim()) throw new Error("CSV contains a quote inside an unquoted field.");
      field = "";
      quoted = true;
    } else if (character === ",") finishField();
    else if (character === "\n" || character === "\r") {
      finishRecord();
      if (character === "\r" && source[index + 1] === "\n") index += 1;
    } else field += character;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  if (field || record.length || quoteClosed) finishRecord();

  if (records.length < 2) throw new Error("CSV needs a header and at least one observation.");
  const headers = records[0];
  if (new Set(headers).size !== headers.length || headers.some((header) => !header)) {
    throw new Error("CSV headers must be unique and non-empty.");
  }
  return records.slice(1).map((values) => {
    if (values.length !== headers.length) throw new Error("Every row must match the header column count.");
    return Object.fromEntries(headers.map((header, i) => {
      const numeric = Number(values[i]);
      return [header, values[i] !== "" && Number.isFinite(numeric) ? numeric : values[i]];
    }));
  });
}

export function filterAlerts(alerts: Alert[], query: string, severity: string, status: string) {
  const needle = query.toLowerCase().trim();
  return alerts.filter((alert) =>
    (!needle || [alert.id, alert.attack_type, alert.source_ip, alert.destination_ip, alert.protocol]
      .some((value) => value.toLowerCase().includes(needle))) &&
    (severity === "all" || alert.severity === severity) &&
    (status === "all" || alert.status === status)
  );
}
