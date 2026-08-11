import type { DashboardSummary } from "../../types";

export const connectedDashboardSummary: DashboardSummary = {
  range: "24h",
  checked_at: "2026-08-11T14:00:00Z",
  generated_at: "2026-08-11T14:00:00Z",
  window: { from: "2026-08-10T14:00:00Z", to: "2026-08-11T14:00:00Z" },
  scope: {
    source: "persisted_database_records",
    time_field: "created_at",
    range: "24h",
    from: "2026-08-10T14:00:00Z",
    to: "2026-08-11T14:00:00Z",
    bucket_minutes: 60,
    includes: ["predictions", "alerts"],
    aggregation: "database_grouped",
  },
  persisted_totals: { predictions: 128, alerts: 42, unresolved_alerts: 26 },
  predictions: { total: 128, attack: 42, normal: 86 },
  alerts: { total: 42, open: 26, unresolved: 26, critical_open: 5, resolved: 13, false_positive: 3 },
  median_detection_score: 0.873,
  status_counts: { new: 12, in_review: 10, escalated: 4, resolved: 13, false_positive: 3 },
  severity_counts: { critical: 8, high: 14, medium: 13, low: 7 },
  family_counts: { DOS_SYN_Hping: 13, NMAP_TCP_scan: 9, ARP_poisioning: 8, DDOS_Slowloris: 7, Metasploit_Brute_Force_SSH: 5 },
  protocol_counts: { tcp: 27, udp: 12, icmp: 3 },
  severity_timeline: [
    { bucket_start: "2026-08-11T06:00:00Z", total: 2, critical: 0, high: 1, medium: 1, low: 0 },
    { bucket_start: "2026-08-11T07:00:00Z", total: 4, critical: 1, high: 1, medium: 1, low: 1 },
    { bucket_start: "2026-08-11T08:00:00Z", total: 3, critical: 0, high: 1, medium: 1, low: 1 },
    { bucket_start: "2026-08-11T09:00:00Z", total: 7, critical: 2, high: 2, medium: 2, low: 1 },
    { bucket_start: "2026-08-11T10:00:00Z", total: 5, critical: 1, high: 2, medium: 1, low: 1 },
    { bucket_start: "2026-08-11T11:00:00Z", total: 8, critical: 2, high: 3, medium: 2, low: 1 },
    { bucket_start: "2026-08-11T12:00:00Z", total: 6, critical: 1, high: 2, medium: 2, low: 1 },
    { bucket_start: "2026-08-11T13:00:00Z", total: 7, critical: 1, high: 2, medium: 3, low: 1 },
  ],
};

export const emptyDashboardSummary: DashboardSummary = {
  ...connectedDashboardSummary,
  persisted_totals: { predictions: 0, alerts: 0, unresolved_alerts: 0 },
  predictions: { total: 0, attack: 0, normal: 0 },
  alerts: { total: 0, open: 0, unresolved: 0, critical_open: 0, resolved: 0, false_positive: 0 },
  median_detection_score: null,
  status_counts: {}, severity_counts: {}, family_counts: {}, protocol_counts: {},
  severity_timeline: connectedDashboardSummary.severity_timeline.map((row) => ({ ...row, total: 0, critical: 0, high: 0, medium: 0, low: 0 })),
};
