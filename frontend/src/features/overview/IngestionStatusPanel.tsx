import { DatabaseZap } from "lucide-react";
import { PanelHeading } from "../../components/PanelHeading";
import type { IngestionPipelineState, IngestionStatus } from "../../types";

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

export interface IngestionStatusPanelProps {
  status: IngestionStatus | null;
  loading: boolean;
  error: string;
  fixtureMode: boolean;
  onRetry: () => void;
}

export function IngestionStatusPanel({ status, loading, error, fixtureMode, onRetry }: IngestionStatusPanelProps) {
  if (fixtureMode) {
    return <section className="panel ingestion-panel" aria-label="Ingestion pipeline"><PanelHeading title="Ingestion pipeline"/><div className="data-state" role="note">Fixture preview is read-only. No ingestion request was made.</div></section>;
  }
  if (loading && !status) {
    return <section className="panel ingestion-panel" aria-label="Ingestion pipeline"><PanelHeading title="Ingestion pipeline"/><div className="data-state" role="status">Loading ingestion status…</div></section>;
  }
  if (error && !status) {
    return <section className="panel ingestion-panel ingestion-panel--offline" aria-label="Ingestion pipeline"><PanelHeading title="Ingestion pipeline"/><div className="data-state data-state--error" role="alert"><span>Ingestion status is offline. {error}</span><button className="secondary-button" type="button" onClick={onRetry}>Retry ingestion status</button></div></section>;
  }
  if (!status) return null;
  const state = ingestionState(status);
  const heartbeat = status.worker.last_heartbeat_at ? new Date(status.worker.last_heartbeat_at).toLocaleString() : "Not reported";
  return (
    <section className={`panel ingestion-panel ingestion-panel--${state}`} aria-label="Ingestion pipeline" data-ingestion-state={state}>
      <PanelHeading title="Ingestion pipeline" action={<span className="ingestion-state"><i aria-hidden="true"/>{stateLabel(state)}</span>}/>
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
