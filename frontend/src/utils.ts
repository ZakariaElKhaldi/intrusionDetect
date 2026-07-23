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
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("CSV needs a header and at least one observation.");
  const split = (line: string) => line.split(",").map((part) => part.trim().replace(/^"|"$/g, ""));
  const headers = split(lines[0]);
  if (new Set(headers).size !== headers.length || headers.some((header) => !header)) {
    throw new Error("CSV headers must be unique and non-empty.");
  }
  return lines.slice(1).map((line) => {
    const values = split(line);
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
