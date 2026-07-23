import {
  ArrowRight,
  Boxes,
  CircleAlert,
  Clock3,
  Crosshair,
  Radio,
} from "lucide-react";
import { useMemo } from "react";
import {
  DetectionRankingChart,
  ProtocolDistributionChart,
  SeverityTimelineChart,
} from "../../components/charts";
import { PanelHeading } from "../../components/PanelHeading";
import { SeverityLabel } from "../../components/SeverityLabel";
import type { Alert, HealthInfo } from "../../types";
import { formatTime } from "../../utils";

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

export function Overview({
  alerts,
  health,
  socketState,
  lastUpdate,
  onOpenAlert,
  onTimeBucket,
}: {
  alerts: Alert[];
  health: HealthInfo | null;
  socketState: "connecting" | "live" | "offline";
  lastUpdate: Date;
  onOpenAlert: (alert: Alert) => void;
  onTimeBucket: (start: string) => void;
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
      <section className="metrics-grid" aria-label="Current alert posture">
        <Metric
          label="Alerts loaded"
          value={String(alerts.length)}
          detail="Current client investigation window"
          icon={Radio}
        />
        <Metric
          label="Open critical"
          value={String(critical.length)}
          detail={`${openAlerts.length} unresolved across all severities`}
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
          label="Median score"
          value={`${(medianConfidence * 100).toFixed(1)}%`}
          detail="Classifier score; not a calibrated probability"
          icon={Crosshair}
        />
      </section>

      <section className="panel timeline-panel">
        <PanelHeading
          eyebrow="Investigation timeline"
          title="Alerts by severity"
          description="Five-minute buckets. Select a bar to inspect alerts from that interval."
          action={<span className="panel-heading-meta">{alerts.length} observations</span>}
        />
        <SeverityTimelineChart alerts={alerts} bucketMinutes={5} height={290} onBucketSelect={onTimeBucket} />
      </section>

      <div className="overview-side">
        <section className="panel">
          <PanelHeading
            eyebrow="Composition"
            title="Protocols among alerts"
            description="Distribution within alert records, not all network traffic."
          />
          <ProtocolDistributionChart alerts={alerts} height={225} />
        </section>
        <section className="panel">
          <PanelHeading
            eyebrow="Pipeline facts"
            title="Current serving path"
            description="Values reported by the active API."
          />
          <div className="pipeline-facts">
            <div><span>API</span><b>{health ? health.status : "Unavailable"}</b></div>
            <div><span>Stream</span><b>{socketState}</b></div>
            <div><span>Schema</span><b className="mono">{health?.schema_version ?? "Not reported"}</b></div>
            <div><span>Model</span><b className="mono">{health?.model_version ?? "Not reported"}</b></div>
            <div><span>Last update</span><b>{formatTime(lastUpdate.toISOString())}</b></div>
          </div>
        </section>
      </div>

      <section className="panel">
        <PanelHeading
          eyebrow="Detection workload"
          title="Detection families"
          description="Total alerts split into resolved and unresolved work."
        />
        <DetectionRankingChart alerts={alerts} height={340} />
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

