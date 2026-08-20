import {
  ArrowRight,
  Boxes,
  CircleAlert,
  Clock3,
  Crosshair,
  Database,
  Radio,
  ShieldCheck,
} from "lucide-react";
import { useId, useMemo } from "react";
import { PanelHeading } from "../../components/PanelHeading";
import { SeverityLabel } from "../../components/SeverityLabel";
import type { Alert, DashboardSummary, SensorStatus } from "../../types";
import { formatTime } from "../../utils";
import { SensorStatusPanel } from "./SensorStatusPanel";

const terminalStatuses = new Set(["resolved", "false_positive"]);
const rangeLabels: Record<DashboardSummary["range"], string> = {
  "15m": "Last 15 minutes", "1h": "Last hour", "24h": "Last 24 hours", "7d": "Last 7 days", all: "All persisted records",
};

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function countBy(alerts: Alert[], value: (alert: Alert) => string) {
  return alerts.reduce<Record<string, number>>((counts, alert) => {
    const key = value(alert) || "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}

function OverviewMetric({ label, value, detail, icon: Icon, attention = false }: { label: string; value: string; detail: string; icon: typeof CircleAlert; attention?: boolean }) {
  return <article className={`briefing-metric ${attention ? "briefing-metric--attention" : ""}`}><span>{label}<Icon aria-hidden="true" /></span><strong>{value}</strong><small>{detail}</small></article>;
}

function DistributionList({ values, label, order = [] }: { values: Record<string, number>; label: string; order?: string[] }) {
  const entries = Object.entries(values).sort((left, right) => {
    const leftOrder = order.indexOf(left[0]);
    const rightOrder = order.indexOf(right[0]);
    if (leftOrder >= 0 || rightOrder >= 0) return (leftOrder < 0 ? order.length : leftOrder) - (rightOrder < 0 ? order.length : rightOrder);
    return right[1] - left[1] || left[0].localeCompare(right[0]);
  });
  const max = Math.max(...entries.map(([, value]) => value), 1);
  if (!entries.length) return <div className="overview-empty-inline">No records in this evidence window.</div>;
  return <ol className="overview-distribution" aria-label={label}>{entries.map(([name, value]) => <li key={name}><span>{humanize(name)}</span><i aria-hidden="true"><b className={`distribution-fill distribution-fill--${name}`} style={{ width: `${value / max * 100}%` }} /></i><strong>{value.toLocaleString()}</strong></li>)}</ol>;
}

function DistributionPanel({ eyebrow, title, description, values, order }: { eyebrow: string; title: string; description: string; values: Record<string, number>; order?: string[] }) {
  return <section className="panel overview-distribution-panel"><PanelHeading eyebrow={eyebrow} title={title} description={description}/><DistributionList values={values} label={`${title} exact counts`} order={order}/></section>;
}

function PersistedTimeline({ summary, onSelect }: { summary: DashboardSummary; onSelect: (start: string, bucketMinutes?: number) => void }) {
  const detailsId = useId();
  const rows = summary.severity_timeline;
  const max = Math.max(...rows.map((row) => row.total), 1);
  const peak = rows.reduce<(typeof rows)[number] | null>((current, row) => !current || row.total > current.total ? row : current, null);
  const criticalTotal = rows.reduce((total, row) => total + row.critical, 0);
  const plotLabel = rows.length
    ? `${rows.length} alert intervals. Peak ${peak?.total ?? 0} alerts at ${peak ? new Date(peak.bucket_start).toLocaleString() : "none"}. ${criticalTotal} critical alerts. Exact interval table follows.`
    : "No persisted alert intervals in this evidence window. Exact interval table follows.";
  return <figure className="overview-timeline" aria-labelledby={detailsId}>
    <figcaption id={detailsId}><strong>Window pattern</strong><span>{peak?.total ? `Peak ${peak.total.toLocaleString()} at ${new Date(peak.bucket_start).toLocaleString()} · ${criticalTotal.toLocaleString()} critical across the window` : "No alert activity in this window"}</span></figcaption>
    <div className="overview-timeline-legend" aria-hidden="true"><span className="critical">Critical</span><span className="high">High</span><span className="medium">Medium</span><span className="low">Low</span></div>
    <div className="overview-timeline-plot" role="img" aria-label={plotLabel}>{rows.map((row) => <span className="overview-timeline-column" key={row.bucket_start} style={{ height: row.total ? `${Math.max(3, row.total / max * 100)}%` : 0 }} aria-hidden="true">{(["critical", "high", "medium", "low"] as const).map((severity) => row[severity] ? <i className={`timeline-segment timeline-segment--${severity}`} style={{ height: `${row[severity] / row.total * 100}%` }} key={severity}/> : null)}</span>)}</div>
    <details className="overview-timeline-details"><summary>Inspect and open exact intervals <small>{rows.length.toLocaleString()} buckets · {summary.scope.bucket_minutes}-minute resolution</small></summary><div className="overview-table-scroll" role="region" aria-label="Exact persisted alert intervals" tabIndex={0}><table><caption>Persisted alert counts by {summary.scope.bucket_minutes}-minute interval</caption><thead><tr><th scope="col">Interval start</th><th scope="col">Total</th><th scope="col">Critical</th><th scope="col">High</th><th scope="col">Medium</th><th scope="col">Low</th></tr></thead><tbody>{rows.map((row) => <tr key={row.bucket_start}><th scope="row">{row.total ? <button className="text-button" type="button" onClick={() => onSelect(row.bucket_start, summary.scope.bucket_minutes)}>Open {new Date(row.bucket_start).toLocaleString()}</button> : new Date(row.bucket_start).toLocaleString()}</th><td>{row.total}</td><td>{row.critical}</td><td>{row.high}</td><td>{row.medium}</td><td>{row.low}</td></tr>)}</tbody></table></div></details>
  </figure>;
}

function EvidenceScope({ summary, requestedRange, loading, error, fixtureMode, onRange, onRetry }: { summary: DashboardSummary | null; requestedRange: DashboardSummary["range"]; loading: boolean; error: string; fixtureMode: boolean; onRange?: (range: DashboardSummary["range"]) => void; onRetry?: () => void }) {
  const showingPrevious = Boolean(summary && summary.range !== requestedRange);
  return <section className={`panel monitoring-scope ${fixtureMode ? "monitoring-scope--fixture" : ""}`} aria-labelledby="situation-briefing-title">
    <div className="monitoring-scope-heading"><div><span className="eyebrow">{fixtureMode ? "Illustrative evidence" : "Persisted situation evidence"}</span><h2 id="situation-briefing-title">Situation briefing</h2><p>{fixtureMode ? "Generated alert records demonstrate layout and interaction only; they are not a database query." : "Understand the persisted detection workload first, then move into exact alert and operations evidence."}</p></div>{!fixtureMode ? <label>Evidence window<select value={requestedRange} onChange={(event) => onRange?.(event.target.value as DashboardSummary["range"])}><option value="15m">Last 15 minutes</option><option value="1h">Last hour</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="all">All persisted records</option></select></label> : null}</div>
    {loading ? <div className="monitoring-refresh" role="status">{showingPrevious ? `Loading ${rangeLabels[requestedRange]}; the previous ${rangeLabels[summary!.range].toLocaleLowerCase()} snapshot remains visible.` : "Loading persisted summary…"}</div> : null}
    {error ? <div className="monitoring-refresh monitoring-refresh--error" role="alert"><span><strong>{summary ? "Showing the last successful summary" : "Persisted summary is unavailable"}</strong>{error}</span>{onRetry ? <button type="button" className="secondary-button" onClick={onRetry}>Retry summary</button> : null}</div> : null}
    {summary ? <><dl className="monitoring-scope-facts"><div><dt>Displayed window</dt><dd>{rangeLabels[summary.range]}<small>{new Date(summary.window.from ?? summary.window.to).toLocaleString()} to {new Date(summary.window.to).toLocaleString()}</small></dd></div><div><dt>Persisted totals</dt><dd>{summary.persisted_totals.predictions.toLocaleString()} predictions · {summary.persisted_totals.alerts.toLocaleString()} alerts<small>{summary.persisted_totals.unresolved_alerts.toLocaleString()} unresolved alert records</small></dd></div><div><dt>Aggregation</dt><dd>{humanize(summary.scope.aggregation)}<small>{summary.scope.bucket_minutes}-minute buckets on {summary.scope.time_field}</small></dd></div></dl><details className="monitoring-scope-details"><summary>Exact summary provenance</summary><dl><div><dt>Source</dt><dd className="mono">{summary.scope.source}</dd></div><div><dt>Includes</dt><dd>{summary.scope.includes.join(" · ")}</dd></div><div><dt>Requested range</dt><dd>{summary.scope.range}</dd></div><div><dt>Scope from</dt><dd>{summary.scope.from ? new Date(summary.scope.from).toLocaleString() : "Beginning of persisted records"}</dd></div><div><dt>Scope to</dt><dd>{new Date(summary.scope.to).toLocaleString()}</dd></div><div><dt>Checked</dt><dd>{new Date(summary.checked_at).toLocaleString()}</dd></div><div><dt>Generated</dt><dd>{new Date(summary.generated_at).toLocaleString()}</dd></div></dl></details></> : !loading && !error && !fixtureMode ? <div className="monitoring-refresh" role="status">No persisted summary has been loaded.</div> : null}
  </section>;
}

export interface OverviewProps {
  alerts: Alert[];
  fixtureMode: boolean;
  socketState: "connecting" | "live" | "offline";
  lastUpdate: Date | null;
  livePredictionCount: number;
  alertsLoading?: boolean;
  alertsError?: string;
  onRetry?: () => void;
  summary?: DashboardSummary | null;
  summaryLoading?: boolean;
  summaryError?: string;
  summaryRange?: DashboardSummary["range"];
  onSummaryRange?: (range: DashboardSummary["range"]) => void;
  onRetrySummary?: () => void;
  onOpenAlert: (alert: Alert) => void;
  onTimeBucket: (start: string, bucketMinutes?: number) => void;
  onViewAlertQueue?: () => void;
  sensorStatus?: SensorStatus | null;
  sensorLoading?: boolean;
  sensorError?: string;
  onRetrySensor?: () => void;
}

export function Overview({ alerts, fixtureMode, socketState, lastUpdate, livePredictionCount, alertsLoading = false, alertsError = "", onRetry, summary = null, summaryLoading = false, summaryError = "", summaryRange = "24h", onSummaryRange, onRetrySummary, onOpenAlert, onTimeBucket, onViewAlertQueue, sensorStatus = null, sensorLoading = false, sensorError = "", onRetrySensor }: OverviewProps) {
  const openAlerts = alerts.filter((alert) => !terminalStatuses.has(alert.status));
  const critical = openAlerts.filter((alert) => alert.severity === "critical");
  const endpoints = new Set(alerts.flatMap((alert) => [alert.source_ip, alert.destination_ip]).filter(Boolean));
  const fixtureMedian = median(alerts.map((alert) => alert.confidence));
  const recent = useMemo(() => [...openAlerts].filter((alert) => alert.severity !== "normal").sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp)).slice(0, 6), [openAlerts]);
  const fixtureSeverity = useMemo(() => countBy(alerts, (alert) => alert.severity), [alerts]);
  const fixtureStatus = useMemo(() => countBy(alerts, (alert) => alert.status), [alerts]);
  const fixtureFamilies = useMemo(() => countBy(alerts, (alert) => alert.attack_type), [alerts]);
  const fixtureProtocols = useMemo(() => countBy(alerts, (alert) => alert.protocol), [alerts]);
  const topFamily = Object.entries(summary?.family_counts ?? fixtureFamilies).sort((left, right) => right[1] - left[1])[0];

  return <div className="overview-workspace">
    <SensorStatusPanel status={sensorStatus} loading={sensorLoading} error={sensorError} fixtureMode={fixtureMode} onRetry={() => onRetrySensor?.()}/>
    <EvidenceScope summary={summary} requestedRange={summaryRange} loading={summaryLoading} error={summaryError} fixtureMode={fixtureMode} onRange={onSummaryRange} onRetry={onRetrySummary}/>

    {summary ? <section className="briefing-metrics" aria-label="Persisted workload summary"><OverviewMetric label="Predictions" value={summary.predictions.total.toLocaleString()} detail={`${summary.predictions.attack.toLocaleString()} attack · ${summary.predictions.normal.toLocaleString()} normal`} icon={Radio}/><OverviewMetric label="Alert records" value={summary.alerts.total.toLocaleString()} detail={`${summary.alerts.resolved.toLocaleString()} resolved · ${summary.alerts.false_positive.toLocaleString()} false positive`} icon={ShieldCheck}/><OverviewMetric label="Unresolved work" value={summary.alerts.unresolved.toLocaleString()} detail={`${summary.alerts.open.toLocaleString()} open under the backend terminal-state contract`} icon={CircleAlert} attention={summary.alerts.unresolved > 0}/><OverviewMetric label="Open critical" value={summary.alerts.critical_open.toLocaleString()} detail="Critical alerts not resolved or false positive" icon={CircleAlert} attention={summary.alerts.critical_open > 0}/><OverviewMetric label="Median detector score" value={summary.median_detection_score == null ? "Not reported" : `${(summary.median_detection_score * 100).toFixed(1)}%`} detail="Persisted model output; probability meaning follows each artifact" icon={Crosshair}/></section> : fixtureMode ? <section className="briefing-metrics briefing-metrics--fixture" aria-label="Fixture workload summary"><OverviewMetric label="Fixture alerts" value={alerts.length.toLocaleString()} detail="Generated records, not persisted totals" icon={ShieldCheck}/><OverviewMetric label="Fixture unresolved" value={openAlerts.length.toLocaleString()} detail="Illustrative open workload" icon={CircleAlert}/><OverviewMetric label="Fixture critical" value={critical.length.toLocaleString()} detail="Illustrative high-attention records" icon={CircleAlert}/><OverviewMetric label="Median fixture score" value={`${(fixtureMedian * 100).toFixed(1)}%`} detail="Generated model scores, not measured performance" icon={Crosshair}/></section> : null}

    <section className="panel overview-attention" aria-label="Situation interpretation"><div><span className="eyebrow">Attention brief</span><strong>{summary ? summary.alerts.critical_open ? `${summary.alerts.critical_open.toLocaleString()} critical alerts remain open` : summary.alerts.unresolved ? `${summary.alerts.unresolved.toLocaleString()} alerts remain unresolved` : "No unresolved alerts in this persisted window" : fixtureMode ? `${openAlerts.length.toLocaleString()} fixture alerts remain unresolved` : "Persisted workload not available"}</strong><p>{topFamily ? `${humanize(topFamily[0])} is the most represented family with ${topFamily[1].toLocaleString()} alert${topFamily[1] === 1 ? "" : "s"}.` : "No detection family is represented in the available evidence."}</p></div><dl aria-label="Browser session and loaded-cache context"><div><dt>Live predictions</dt><dd>{livePredictionCount.toLocaleString()}<small>this browser session</small></dd></div><div><dt>Loaded alerts</dt><dd>{alerts.length.toLocaleString()}<small>cache, not full corpus</small></dd></div><div><dt>Route labels</dt><dd>{endpoints.size.toLocaleString()}<small>within loaded alerts</small></dd></div><div><dt>Live stream</dt><dd>{fixtureMode ? "Fixture" : humanize(socketState)}<small>{lastUpdate ? `Last event ${formatTime(lastUpdate.toISOString())}` : "No event received"}</small></dd></div></dl></section>

    <div className="overview-decision-grid">
      <section className="panel overview-timeline-panel"><PanelHeading eyebrow="Persisted chronology" title="Alert activity by severity" description={summary ? `${summary.scope.bucket_minutes}-minute database buckets. Open the exact table to investigate an interval.` : "A connected persisted summary is required for a time-window chronology."} action={summary ? <span className="panel-heading-meta">{summary.alerts.total.toLocaleString()} alerts</span> : undefined}/>{summary ? <PersistedTimeline summary={summary} onSelect={onTimeBucket}/> : summaryLoading ? <div className="data-state" role="status">Loading persisted chronology…</div> : summaryError ? <div className="data-state data-state--error" role="alert"><span>{summaryError}</span>{onRetrySummary ? <button type="button" className="secondary-button" onClick={onRetrySummary}>Retry summary</button> : null}</div> : <div className="data-state" role={fixtureMode ? "note" : "status"}>{fixtureMode ? "Fixture alerts are not projected onto a fabricated persisted timeline." : "No persisted chronology is available."}</div>}</section>

      <section className="panel overview-queue-preview"><PanelHeading eyebrow="Loaded-cache handoff" title="Recent unresolved alerts" description="The complete persisted search and ordering contract lives in the alert queue." action={onViewAlertQueue ? <button className="text-button" type="button" onClick={onViewAlertQueue}>Open full queue <ArrowRight aria-hidden="true"/></button> : <Clock3 aria-hidden="true" size={15}/>}/>{alertsError ? <div className="overview-inline-error" role="alert"><span>Loaded alert cache may be stale. {alertsError}</span>{onRetry ? <button type="button" className="text-button" onClick={onRetry}>Retry alerts</button> : null}</div> : null}{alertsLoading && !alerts.length ? <div className="data-state" role="status">Loading recent alerts…</div> : <div className="recent-list">{recent.map((alert) => <button key={alert.id} className="recent-alert" type="button" aria-label={`Open ${alert.severity} ${alert.attack_type} alert ${alert.id}`} onClick={() => onOpenAlert(alert)}><span className={`recent-icon recent-icon--${alert.severity}`} aria-hidden="true">!</span><span><b>{humanize(alert.attack_type)}</b><small>{alert.source_ip} to {alert.destination_ip}</small><small className="mono">{alert.id}</small></span><span className="recent-alert-state"><SeverityLabel severity={alert.severity}/><small>{humanize(alert.status)}</small></span><time dateTime={alert.timestamp}>{formatTime(alert.timestamp)}</time><ArrowRight aria-hidden="true" size={13}/></button>)}{!recent.length ? <div className="data-state">No unresolved alerts in the loaded cache.</div> : null}</div>}</section>
    </div>

    <section className="overview-composition" aria-labelledby="overview-composition-title"><div className="overview-composition-heading"><span className="eyebrow">Exact workload composition</span><h2 id="overview-composition-title">What makes up this alert set</h2><p>{summary ? `Every count comes from the ${rangeLabels[summary.range].toLocaleLowerCase()} persisted summary.` : "Fixture counts are derived only from the visible generated records."}</p></div><div className="overview-composition-grid"><DistributionPanel eyebrow="Urgency" title="Severity" description="Alert records by assigned severity." values={summary?.severity_counts ?? fixtureSeverity} order={["critical", "high", "medium", "low", "normal"]}/><DistributionPanel eyebrow="Workflow" title="Disposition" description="Alert records by investigation state." values={summary?.status_counts ?? fixtureStatus} order={["new", "in_review", "escalated", "resolved", "false_positive"]}/><DistributionPanel eyebrow="Detection" title="Families" description="Alert records by predicted attack family." values={summary?.family_counts ?? fixtureFamilies}/><DistributionPanel eyebrow="Network context" title="Protocols" description="Protocols represented among alert records, not all traffic." values={summary?.protocol_counts ?? fixtureProtocols}/></div></section>

  </div>;
}
