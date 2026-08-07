import {
  ArrowRight,
  Boxes,
  CircleAlert,
  Clock3,
  Crosshair,
  DatabaseZap,
  Radio,
} from "lucide-react";
import { useMemo } from "react";
import {
  DetectionRankingChart,
  ProtocolDistributionChart,
} from "../../components/charts";
import { PanelHeading } from "../../components/PanelHeading";
import { SeverityLabel } from "../../components/SeverityLabel";
import type { Alert, DashboardSummary, HealthInfo, IngestionPipelineState, IngestionStatus } from "../../types";
import { formatTime } from "../../utils";
import { IngestionOperations } from "./IngestionOperations";

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function Metric({
  label,
  value,
  detail,
  icon: Icon,
  attention = false,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof CircleAlert;
  attention?: boolean;
}) {
  return (
    <article className={`metric ${attention ? "metric--attention" : ""}`}>
      <span className="metric-label">{label}<Icon aria-hidden="true" /></span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function CountBars({ values, label }: { values: Record<string, number>; label: string }) {
  const rows=Object.entries(values).sort((a,b)=>b[1]-a[1]); const max=Math.max(...rows.map(([,value])=>value),1);
  return <div className="count-bars" aria-label={label}>{rows.length?rows.map(([name,value])=><div key={name}><span>{name}</span><i style={{width:`${value/max*100}%`}} aria-hidden="true"/><b>{value}</b></div>):<div className="chart-empty">No persisted records in this range.</div>}</div>;
}

function PersistedTimeline({ summary, onSelect }: { summary: DashboardSummary; onSelect: (start:string, bucketMinutes?:number)=>void }) {
  const max=Math.max(...summary.severity_timeline.map((row)=>row.total),1);
  return <div className="summary-timeline" aria-label="Persisted alerts by severity and time"><div className="timeline-bars">{summary.severity_timeline.map((row)=><button key={row.bucket_start} onClick={()=>onSelect(row.bucket_start,summary.scope.bucket_minutes)} aria-label={`${row.total} alerts at ${new Date(row.bucket_start).toLocaleString()}`} style={{height:`${Math.max(2,row.total/max*100)}%`}}><span className="sr-only">{row.total}</span></button>)}</div><div className="preview-scroll"><table><caption>Exact persisted alert buckets · {summary.scope.bucket_minutes}-minute intervals</caption><thead><tr><th>Bucket</th><th>Total</th><th>Critical</th><th>High</th><th>Medium</th><th>Low</th></tr></thead><tbody>{summary.severity_timeline.map((row)=><tr key={row.bucket_start}><td><button className="text-button" onClick={()=>onSelect(row.bucket_start,summary.scope.bucket_minutes)}>{new Date(row.bucket_start).toLocaleString()}</button></td><td>{row.total}</td><td>{row.critical}</td><td>{row.high}</td><td>{row.medium}</td><td>{row.low}</td></tr>)}</tbody></table></div></div>;
}

function formatDuration(seconds: number | null) {
  if (seconds == null) return "None pending";
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
}

function ingestionState(status: IngestionStatus): IngestionPipelineState {
  if (status.dead_letter > 0) return "dead_letter";
  if (status.worker.status === "blocked") return "offline";
  if (status.retrying > 0) return "retrying";
  if (status.queue_depth > 0 || status.worker.status === "degraded" || status.outbox.status === "degraded") return "backlogged";
  return status.processing > 0 ? "healthy" : "idle";
}

function stateLabel(state: IngestionPipelineState) {
  return state === "dead_letter" ? "Dead-letter jobs need attention" : state === "backlogged" ? "Queue backlog" : state === "retrying" ? "Jobs retrying" : state === "offline" ? "Worker offline" : state === "idle" ? "Idle and ready" : "Processing normally";
}

export function IngestionStatusPanel({ status, loading, error, fixtureMode, onRetry }: { status: IngestionStatus | null; loading: boolean; error: string; fixtureMode: boolean; onRetry: () => void }) {
  if (fixtureMode) {
    return <section className="panel ingestion-panel" aria-label="Ingestion pipeline"><PanelHeading eyebrow="Live input" title="Ingestion pipeline" description="Queue and worker evidence is available only from a connected API."/><div className="data-state" role="note">Fixture preview is read-only. No ingestion request was made.</div></section>;
  }
  if (loading && !status) {
    return <section className="panel ingestion-panel" aria-label="Ingestion pipeline"><PanelHeading eyebrow="Live input" title="Ingestion pipeline" description="Durable queue and worker activity."/><div className="data-state" role="status">Loading ingestion status…</div></section>;
  }
  if (error && !status) {
    return <section className="panel ingestion-panel ingestion-panel--offline" aria-label="Ingestion pipeline"><PanelHeading eyebrow="Live input" title="Ingestion pipeline" description="Durable queue and worker activity."/><div className="data-state data-state--error" role="alert"><span>Ingestion status is offline. {error}</span><button className="secondary-button" type="button" onClick={onRetry}>Retry ingestion status</button></div></section>;
  }
  if (!status) return null;
  const state = ingestionState(status);
  const heartbeat = status.worker.last_heartbeat_at ? new Date(status.worker.last_heartbeat_at).toLocaleString() : "Not reported";
  return (
    <section className={`panel ingestion-panel ingestion-panel--${state}`} aria-label="Ingestion pipeline" data-ingestion-state={state}>
      <PanelHeading eyebrow="Live input" title="Ingestion pipeline" description="Durable intake, worker progress, and delivery pressure." action={<span className="ingestion-state"><i aria-hidden="true"/>{stateLabel(state)}</span>}/>
      {error ? <div className="ingestion-stale" role="alert">The latest refresh failed; showing the last successful snapshot. <button className="text-button" type="button" onClick={onRetry}>Retry</button></div> : null}
      <dl className="ingestion-metrics">
        <div><dt>Queued</dt><dd><span>{status.queue_depth.toLocaleString()}</span><small>events waiting</small></dd></div>
        <div><dt>Oldest pending</dt><dd><span>{formatDuration(status.oldest_pending_age_seconds)}</span><small>queue wait age</small></dd></div>
        <div><dt>Throughput</dt><dd><span>{status.throughput_per_minute.toLocaleString(undefined, { maximumFractionDigits: 1 })}/min</span><small>processed events</small></dd></div>
        <div><dt>Retrying</dt><dd><span>{status.retrying.toLocaleString()}</span><small>{status.retries.toLocaleString()} total retries</small></dd></div>
        <div><dt>Dead letter</dt><dd><span>{status.dead_letter.toLocaleString()}</span><small>{status.failures.toLocaleString()} failures</small></dd></div>
        <div><dt>Worker</dt><dd><span>{status.worker.status}</span><small title={heartbeat}>Heartbeat {heartbeat}</small></dd></div>
      </dl>
      <p className="ingestion-outbox"><DatabaseZap aria-hidden="true"/> {status.outbox.pending.toLocaleString()} committed events await publication; {status.outbox.published.toLocaleString()} published.</p>
    </section>
  );
}

export function Overview({
  alerts,
  health,
  ingestion,
  ingestionLoading,
  ingestionError,
  fixtureMode,
  onRetryIngestion,
  socketState,
  lastUpdate,
  livePredictionCount,
  alertsLoading,
  alertsError,
  onRetry,
  summary,
  summaryError,
  summaryRange,
  onSummaryRange,
  onOpenAlert,
  onTimeBucket,
}: {
  alerts: Alert[];
  health: HealthInfo | null;
  ingestion: IngestionStatus | null;
  ingestionLoading: boolean;
  ingestionError: string;
  fixtureMode: boolean;
  onRetryIngestion: () => void;
  socketState: "connecting" | "live" | "offline";
  lastUpdate: Date | null;
  livePredictionCount: number;
  alertsLoading?: boolean;
  alertsError?: string;
  onRetry?: () => void;
  summary?: DashboardSummary | null;
  summaryError?: string;
  summaryRange?: DashboardSummary["range"];
  onSummaryRange?: (range: DashboardSummary["range"]) => void;
  onOpenAlert: (alert: Alert) => void;
  onTimeBucket: (start: string, bucketMinutes?: number) => void;
}) {
  const openAlerts = alerts.filter((alert) => !["resolved", "false_positive"].includes(alert.status));
  const critical = openAlerts.filter((alert) => alert.severity === "critical");
  const endpoints = new Set(alerts.flatMap((alert) => [alert.source_ip, alert.destination_ip]));
  const medianConfidence = median(alerts.map((alert) => alert.confidence));
  const recent = useMemo(
    () => openAlerts
      .filter((alert) => alert.severity !== "normal")
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
      .slice(0, 6),
    [openAlerts],
  );

  return (
    <div className="overview-grid">
      <div className="summary-scope"><span>Persisted database evidence</span><label>Evidence window <select value={summaryRange ?? "24h"} onChange={(event)=>onSummaryRange?.(event.target.value as DashboardSummary["range"])}><option value="15m">15 minutes</option><option value="1h">1 hour</option><option value="24h">24 hours</option><option value="7d">7 days</option><option value="all">All persisted</option></select></label>{summary ? <small>Generated {new Date(summary.generated_at).toLocaleString()} · {summary.scope.bucket_minutes}-minute buckets · time field {summary.scope.time_field}</small> : null}</div>
      <section className="metrics-grid" aria-label="Current alert posture">
        <Metric
          label={summary ? "Persisted predictions" : "Live predictions"}
          value={String(summary?.predictions.total ?? livePredictionCount)}
          detail={summary ? `${summary.range} window: ${summary.predictions.attack} attack / ${summary.predictions.normal} normal · ${livePredictionCount} live this session` : "Live events received since this page opened"}
          icon={Radio}
        />
        <Metric
          label="Open critical"
          value={String(summary?.alerts.critical_open ?? critical.length)}
          detail={`${summary?.alerts.unresolved ?? openAlerts.length} persisted unresolved across all severities`}
          icon={CircleAlert}
          attention={critical.length > 0}
        />
        <Metric
          label="Observed endpoints"
          value={String(endpoints.size)}
          detail="Distinct route labels present in alerts"
          icon={Boxes}
        />
        <Metric
          label="Median detector score"
          value={summary?.median_detection_score == null ? `${(medianConfidence * 100).toFixed(1)}%` : `${(summary.median_detection_score * 100).toFixed(1)}%`}
          detail="Detector output; not a calibrated probability"
          icon={Crosshair}
        />
      </section>

      <IngestionStatusPanel status={ingestion} loading={ingestionLoading} error={ingestionError} fixtureMode={fixtureMode} onRetry={onRetryIngestion}/>
      <IngestionOperations fixtureMode={fixtureMode}/>

      <section className="panel timeline-panel">
        <PanelHeading
          eyebrow="Investigation timeline"
          title="Alerts by severity"
          description={`${summary?.scope.bucket_minutes ?? 5}-minute buckets. Select a bar to inspect alerts from that interval.`}
          action={<span className="panel-heading-meta">{summary?.alerts.total ?? alerts.length} alerts</span>}
        />
        {summary ? <PersistedTimeline summary={summary} onSelect={onTimeBucket}/> : alertsLoading ? <div className="data-state" role="status">Loading persisted timeline…</div> : (summaryError || alertsError) ? <div className="data-state data-state--error" role="alert"><span>{summaryError || alertsError}</span>{onRetry ? <button className="secondary-button" onClick={onRetry}>Retry summary</button> : null}</div> : <div className="chart-empty">No persisted summary is available.</div>}
      </section>

      <div className="overview-side">
        <section className="panel">
          <PanelHeading
            eyebrow="Composition"
            title="Protocols among alerts"
            description="Distribution within alert records, not all network traffic."
          />
          {summary ? <CountBars values={summary.protocol_counts} label="Persisted alert protocols"/> : alerts.length ? <ProtocolDistributionChart alerts={alerts} height={225} /> : <div className="chart-empty">No alert protocols recorded.</div>}
        </section>
        <section className="panel">
          <PanelHeading
            eyebrow="Pipeline facts"
            title="Current serving path"
            description="Values reported by the active API."
          />
          <div className="pipeline-facts">
            <div><span>API</span><b>{health ? health.status : "Unavailable"}</b></div>
            <div><span>Readiness</span><b>{health?.readiness ?? "Not reported"}</b></div>
            <div><span>Instance</span><b className="mono">{health?.instance_id ?? "Not reported"}</b></div>
            <div><span>Stream</span><b>{socketState}</b></div>
            <div><span>Schema</span><b className="mono">{health?.schema_version ?? "Not reported"}</b></div>
            <div><span>Detector</span><b className="mono">{health?.detector_model_version ?? health?.model_version ?? "Not reported"}</b></div>
            <div><span>Classifier</span><b className="mono">{health?.classifier_model_version ?? "Not reported"}</b></div>
            <div><span>Dataset</span><b>{health?.dataset_ready === undefined ? "Not reported" : health.dataset_ready ? "Ready" : "Unavailable"}</b></div>
            <div><span>Dataset SHA-256</span><b className="mono checksum">{health?.dataset_checksum ?? "Not reported"}</b></div>
            <div><span>Production bundle</span><b>{health?.production_bundle_valid === undefined ? "Not reported" : health.production_bundle_valid ? "Verified" : "Invalid"}</b></div>
            <div><span>Fallback</span><b>{(health?.fallback_active ?? health?.fallback) === undefined ? "Not reported" : (health?.fallback_active ?? health?.fallback) ? "Active" : "Inactive"}</b></div>
            {Object.entries(health?.components ?? {}).map(([name,component])=><div key={name}><span>{name}</span><b title={component.reason}>{component.status}{component.reason ? ` · ${component.reason}` : ""}</b></div>)}
            <div><span>Last live event</span><b>{lastUpdate ? formatTime(lastUpdate.toISOString()) : "Not received"}</b></div>
          </div>
        </section>
      </div>

      <section className="panel">
        <PanelHeading
          eyebrow="Detection workload"
          title="Detection families"
          description="Total alerts split into resolved and unresolved work."
        />
        {summary ? <CountBars values={summary.family_counts} label="Persisted detection families"/> : alerts.length ? <DetectionRankingChart alerts={alerts} height={340} /> : <div className="chart-empty">No detection families recorded.</div>}
      </section>

      <section className="panel">
        <PanelHeading
          eyebrow="Investigation queue"
          title="Recent unresolved alerts"
          description="Ordered by observation time; selecting a row preserves the surrounding list."
          action={<Clock3 aria-hidden="true" size={15} />}
        />
        <div className="recent-list">
          {recent.map((alert) => (
            <button key={alert.id} className="recent-alert" onClick={() => onOpenAlert(alert)}>
              <span className={`recent-icon recent-icon--${alert.severity}`} aria-hidden="true">!</span>
              <span><b>{alert.attack_type}</b><small>{alert.source_ip} to {alert.destination_ip}</small></span>
              <SeverityLabel severity={alert.severity} />
              <time dateTime={alert.timestamp}>{formatTime(alert.timestamp)}</time>
              <ArrowRight aria-hidden="true" size={13} />
            </button>
          ))}
          {!recent.length && <div className="chart-empty">No unresolved alerts in the current dataset.</div>}
        </div>
      </section>
    </div>
  );
}
