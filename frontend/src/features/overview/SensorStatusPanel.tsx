import { Activity, RadioTower, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import type { SensorStatus } from "../../types";

function lastSeen(value: string | null | undefined) {
  if (!value) return "No event received";
  return new Date(value).toLocaleString();
}

export function SensorStatusPanel({ status, loading, error, fixtureMode, onRetry }: {
  status: SensorStatus | null;
  loading: boolean;
  error: string;
  fixtureMode: boolean;
  onRetry: () => void;
}) {
  const online = status?.status === "online";
  const primary = status?.sensors[0];
  return <section className={`panel sensor-status sensor-status--${online ? "online" : "offline"}`} aria-labelledby="sensor-status-title">
    <header className="sensor-status-header">
      <h2 id="sensor-status-title">Passive network sensor</h2>
      <span className={`sensor-state sensor-state--${online ? "online" : "offline"}`} role="status"><i aria-hidden="true" />{fixtureMode ? "Preview" : online ? "Online" : loading ? "Checking" : "Offline"}</span>
    </header>
    {error ? <div className="sensor-status-error" role="alert"><TriangleAlert aria-hidden="true"/><span><strong>Sensor status is unavailable</strong>{error}</span><button className="secondary-button" type="button" onClick={onRetry}><RefreshCw aria-hidden="true"/>Retry</button></div> : null}
    <div className="sensor-status-grid">
      <div className="sensor-live-reading"><RadioTower aria-hidden="true"/><span><small>Capture interface</small><strong>{fixtureMode ? "iotlab0" : primary?.interface ?? "No sensor reporting"}</strong><em>{primary ? `${primary.sensor_id} · Suricata ${primary.engine_version ?? "version not reported"}` : "Start the cyber range to observe live packets."}</em></span></div>
      <dl>
        <div><dt><Activity aria-hidden="true"/>Packets captured</dt><dd>{(status?.aggregate.packets ?? 0).toLocaleString()}</dd></div>
        <div><dt><TriangleAlert aria-hidden="true"/>Capture drops</dt><dd>{(status?.aggregate.capture_drops ?? 0).toLocaleString()}</dd></div>
        <div><dt><ShieldCheck aria-hidden="true"/>Sensor alerts</dt><dd>{(status?.aggregate.alerts_accepted ?? 0).toLocaleString()}</dd></div>
        <div><dt>Rules loaded</dt><dd>{primary?.rule_count?.toLocaleString() ?? "—"}</dd></div>
      </dl>
    </div>
    <footer><span>Last packet event</span><strong>{lastSeen(primary?.last_event_at)}</strong><span>Last heartbeat</span><strong>{lastSeen(primary?.last_heartbeat_at)}</strong></footer>
  </section>;
}
