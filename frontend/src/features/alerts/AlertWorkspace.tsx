import { ArrowRight, CheckCircle2, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { submitAlertFeedback } from "../../api";
import { EvidenceChart } from "../../components/charts";
import { PanelHeading } from "../../components/PanelHeading";
import { SeverityLabel } from "../../components/SeverityLabel";
import type { Alert, AlertStatus } from "../../types";
import { formatTime } from "../../utils";

const rangeMilliseconds: Record<string, number> = {
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
};

function filterByRange(alert: Alert, range: string) {
  if (range === "all") return true;
  const timestamp = new Date(alert.timestamp).valueOf();
  return Number.isFinite(timestamp) && timestamp >= Date.now() - rangeMilliseconds[range];
}

export function AlertWorkspace({
  alerts,
  pending,
  onSelect,
  applyPending,
}: {
  alerts: Alert[];
  pending: number;
  onSelect: (alert: Alert) => void;
  applyPending: () => void;
}) {
  const params = new URLSearchParams(location.search);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [severity, setSeverity] = useState(params.get("severity") ?? "all");
  const [status, setStatus] = useState(params.get("status") ?? "all");
  const [family, setFamily] = useState(params.get("family") ?? "all");
  const [range, setRange] = useState(params.get("range") ?? "all");
  const from = params.get("from");
  const to = params.get("to");
  const [scrollTop, setScrollTop] = useState(0);
  const families = useMemo(
    () => [...new Set(alerts.map((alert) => alert.attack_type))].sort(),
    [alerts],
  );
  const filtered = useMemo(() => {
    const needle = query.toLowerCase().trim();
    return alerts.filter((alert) =>
      (!needle || [
        alert.id,
        alert.attack_type,
        alert.source_ip,
        alert.destination_ip,
        alert.protocol,
      ].some((value) => value.toLowerCase().includes(needle)))
      && (severity === "all" || alert.severity === severity)
      && (status === "all" || alert.status === status)
      && (family === "all" || alert.attack_type === family)
      && filterByRange(alert, range)
      && (!from || Date.parse(alert.timestamp) >= Date.parse(from))
      && (!to || Date.parse(alert.timestamp) < Date.parse(to))
    );
  }, [alerts, family, from, query, range, severity, status, to]);
  const rowHeight = 62;
  const viewportHeight = 570;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 3);
  const end = Math.min(filtered.length, start + Math.ceil(viewportHeight / rowHeight) + 7);

  useEffect(() => {
    const next = new URLSearchParams(location.search);
    const values = { q: query, severity, status, family, range };
    Object.entries(values).forEach(([key, value]) => {
      if (value && value !== "all") next.set(key, value);
      else next.delete(key);
    });
    history.replaceState(null, "", `${location.pathname}?${next.toString()}`);
  }, [family, query, range, severity, status]);

  return (
    <section className="panel alerts-panel">
      <div className="filters">
        <label className="search-field">
          <Search aria-hidden="true" />
          <span className="sr-only">Search alerts</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Endpoint, detection, ID, protocol…"
          />
        </label>
        <label>
          <span className="sr-only">Time range</span>
          <select value={range} onChange={(event) => setRange(event.target.value)}>
            <option value="all">All time</option>
            <option value="15m">Last 15 minutes</option>
            <option value="1h">Last hour</option>
            <option value="24h">Last 24 hours</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Detection family</span>
          <select value={family} onChange={(event) => setFamily(event.target.value)}>
            <option value="all">All detections</option>
            {families.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Severity</span>
          <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
            <option value="all">All severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="new">New</option>
            <option value="investigating">Investigating</option>
            <option value="confirmed">Confirmed</option>
            <option value="false_positive">False positive</option>
            <option value="resolved">Resolved</option>
          </select>
        </label>
        <span className="result-count">{filtered.length} results</span>
      </div>

      {pending > 0 && (
        <button className="pending-banner" onClick={applyPending}>
          {pending} new alert{pending === 1 ? "" : "s"} received — show updates
        </button>
      )}

      <div className="table-head" aria-hidden="true">
        <span>Severity</span>
        <span>Detection</span>
        <span>Route</span>
        <span>Protocol</span>
        <span>Score</span>
        <span>Status</span>
        <span>Time</span>
      </div>
      <div
        className="virtual-table"
        role="table"
        aria-label="Security alerts"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div style={{ height: filtered.length * rowHeight, position: "relative" }}>
          {filtered.slice(start, end).map((alert, index) => (
            <button
              className={`alert-row ${alert.severity === "critical" ? "alert-row--critical" : ""}`}
              role="row"
              key={alert.id}
              style={{ transform: `translateY(${(start + index) * rowHeight}px)` }}
              onClick={() => onSelect(alert)}
            >
              <span role="cell"><SeverityLabel severity={alert.severity} /></span>
              <span role="cell"><b>{alert.attack_type}</b><small>{alert.id}</small></span>
              <span role="cell"><b>{alert.source_ip}</b><small>to {alert.destination_ip}</small></span>
              <span role="cell">{alert.protocol}</span>
              <span role="cell"><b>{(alert.confidence * 100).toFixed(1)}%</b></span>
              <span role="cell" className={`status-text status-text--${alert.status}`}>
                {alert.status.replace("_", " ")}
              </span>
              <time role="cell" dateTime={alert.timestamp}>{formatTime(alert.timestamp)}</time>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export function AlertDrawer({
  alert,
  onClose,
  onStatusChange,
}: {
  alert: Alert;
  onClose: () => void;
  onStatusChange: (id: string, status: AlertStatus) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [feedbackState, setFeedbackState] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    closeRef.current?.focus();
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    addEventListener("keydown", close);
    return () => removeEventListener("keydown", close);
  }, [onClose]);

  const updateStatus = async (status: AlertStatus) => {
    setSubmitting(true);
    setFeedbackState("");
    try {
      await submitAlertFeedback(alert.id, {
        analyst: "dashboard-analyst",
        status,
        notes: `Status changed to ${status.replace("_", " ")} from the dashboard.`,
      });
      onStatusChange(alert.id, status);
      setFeedbackState(`Saved as ${status.replace("_", " ")}.`);
    } catch (error) {
      setFeedbackState(error instanceof Error ? error.message : "Could not save analyst feedback.");
    } finally {
      setSubmitting(false);
    }
  };

  const contributionEvidence = alert.evidence_type === "model_contribution";
  return (
    <div
      className="drawer-layer"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <div className="drawer-header">
          <div>
            <SeverityLabel severity={alert.severity} />
            <h2 id="drawer-title">{alert.attack_type}</h2>
            <small>{alert.id} · {new Date(alert.timestamp).toLocaleString()}</small>
          </div>
          <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Close alert details">
            <X aria-hidden="true" />
          </button>
        </div>

        <section className="drawer-section">
          <h3>Detection summary</h3>
          <div className="summary-grid">
            <div><span>Score</span><b>{(alert.confidence * 100).toFixed(1)}%</b></div>
            <div><span>Status</span><b>{alert.status.replace("_", " ")}</b></div>
            <div><span>Model</span><b className="mono">{alert.model_version ?? "Not reported"}</b></div>
          </div>
        </section>

        <section className="drawer-section">
          <h3>Observed route</h3>
          <div className="route-card">
            <span><small>Source</small><b>{alert.source_ip}</b></span>
            <ArrowRight aria-hidden="true" />
            <span><small>Destination</small><b>{alert.destination_ip}</b></span>
          </div>
          {alert.identity_quality === "port_only" && (
            <p>Only transport ports are available in the current feature schema; these are not persistent device identities.</p>
          )}
        </section>

        <section className="drawer-section">
          <h3>{contributionEvidence ? "Model contribution" : "Highlighted feature values"}</h3>
          <p>
            {contributionEvidence
              ? "Signed values show relative model evidence. They do not establish causality."
              : "The API supplied ranked raw values, not SHAP contributions. They are shown without implying direction or causality."}
          </p>
          {contributionEvidence && alert.explanations?.length ? (
            <EvidenceChart evidence={alert.explanations} height={260} />
          ) : (
            <div className="evidence-list">
              {(alert.explanations ?? []).map((item) => (
                <div className="evidence-row" key={item.feature}>
                  <span>{item.feature}</span>
                  <b className="mono">{String(item.value ?? item.impact)}</b>
                </div>
              ))}
              {!alert.explanations?.length && <span className="panel-heading-meta">No feature evidence was returned.</span>}
            </div>
          )}
        </section>

        {!!alert.reasons?.length && (
          <section className="drawer-section">
            <h3>Detection reasons</h3>
            {alert.reasons.map((reason) => <p key={reason}>{reason}</p>)}
          </section>
        )}

        <section className="drawer-section">
          <h3>Raw flow features</h3>
          <dl className="feature-grid">
            {Object.entries(alert.features ?? {}).map(([key, value]) => (
              <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{value}</dd></div>
            ))}
          </dl>
        </section>

        <section className="drawer-section">
          <h3>Analyst action</h3>
          <div className="drawer-actions">
            <button className="primary-button" disabled={submitting} onClick={() => updateStatus("investigating")}>
              Start investigation
            </button>
            <button className="secondary-button" disabled={submitting} onClick={() => updateStatus("false_positive")}>
              Mark false positive
            </button>
            <button className="secondary-button" disabled={submitting} onClick={() => updateStatus("resolved")}>
              <CheckCircle2 aria-hidden="true" /> Resolve
            </button>
          </div>
          {feedbackState && <div className="feedback-state" role="status">{feedbackState}</div>}
        </section>
      </aside>
    </div>
  );
}
