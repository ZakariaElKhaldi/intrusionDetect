import { PanelHeading } from "../../components/PanelHeading";
import type { HealthInfo } from "../../types";
import { formatTime } from "../../utils";

type SocketState = "connecting" | "live" | "offline";

const acceptableStates = new Set(["ready", "healthy", "ok", "idle"]);

function normalizedState(value: string | undefined) {
  return (value ?? "not_reported").toLowerCase();
}

function stateLabel(value: string | undefined) {
  return (value ?? "not reported").replaceAll("_", " ");
}

function coreState(value: string | undefined) {
  const normalized = normalizedState(value);
  if (["ready", "healthy", "ok", "live"].includes(normalized)) return "healthy";
  if (["degraded", "warning", "connecting", "idle"].includes(normalized)) return "warning";
  return ["blocked", "offline", "failed", "invalid", "unavailable"].includes(normalized) ? "critical" : "neutral";
}

function StatusFact({ label, value }: { label: string; value: string }) {
  return <div className="system-health-fact"><dt>{label}</dt><dd>{stateLabel(value)}</dd></div>;
}

export function SystemHealthPanel({ health, socketState, lastUpdate, fixtureMode }: { health: HealthInfo | null; socketState: SocketState; lastUpdate: Date | null; fixtureMode: boolean }) {
  const components = Object.entries(health?.components ?? {});
  const concerns = components.filter(([, component]) => !acceptableStates.has(normalizedState(component.status)));
  const readiness = fixtureMode ? "fixture" : health?.readiness ?? (health ? "ready" : "unavailable");
  const bundleStatus = String(health?.components?.bundle?.status ?? health?.components?.models?.status ?? (health?.production_bundle_valid === true ? "ready" : health?.production_bundle_valid === false ? "blocked" : "not_reported"));
  const datasetStatus = String(health?.components?.dataset?.status ?? (health?.dataset_ready === true ? "ready" : health?.dataset_ready === false ? "blocked" : "not_reported"));

  return (
    <section className="panel system-health-panel" aria-label="System health">
      <PanelHeading title="System health" action={<span className={`ops-state ops-state--${coreState(readiness)}`} role="status">{stateLabel(readiness)}</span>} />
      {!fixtureMode && concerns.length ? (
        <div className="system-health-attention" role="note">
          <strong>{concerns.length} reported {concerns.length === 1 ? "component needs" : "components need"} review</strong>
          <ul>{concerns.slice(0, 4).map(([name, component]) => <li key={name}><b>{name.replaceAll("_", " ")}</b><span>{stateLabel(component.status)}{component.reason ? ` · ${component.reason}` : ""}</span></li>)}</ul>
        </div>
      ) : null}
      <dl className="system-health-core">
        <StatusFact label="API" value={String(health?.components?.api?.status ?? health?.status ?? (fixtureMode ? "fixture" : "unavailable"))} />
        <StatusFact label="Live stream" value={fixtureMode ? "fixture" : socketState} />
        <StatusFact label="Model bundle" value={bundleStatus} />
        <StatusFact label="Replay dataset" value={datasetStatus} />
      </dl>
      <details className="system-health-disclosure">
        <summary>Component and artifact evidence</summary>
        <div className="system-health-evidence">
          <dl className="system-health-artifacts">
            <div><dt>Instance</dt><dd className="mono">{health?.instance_id ?? "Not reported"}</dd></div>
            <div><dt>Schema</dt><dd className="mono">{health?.schema_version ?? "Not reported"}</dd></div>
            <div><dt>Detector</dt><dd className="mono">{health?.detector_model_version ?? health?.model_version ?? "Not reported"}</dd></div>
            <div><dt>Detector score</dt><dd>{health?.detector_probability_calibrated === undefined ? "Not reported" : health.detector_probability_calibrated ? "Calibrated probability" : "Model score only"}</dd></div>
            <div><dt>Classifier</dt><dd className="mono">{health?.classifier_model_version ?? "Not reported"}</dd></div>
            <div><dt>Classifier score</dt><dd>{health?.classifier_probability_calibrated === undefined ? "Not reported" : health.classifier_probability_calibrated ? "Calibrated probability" : "Model score only"}</dd></div>
            <div><dt>Dataset SHA-256</dt><dd className="mono">{health?.dataset_checksum ?? "Not reported"}</dd></div>
            <div><dt>Fallback inference</dt><dd>{(health?.fallback_active ?? health?.fallback) === undefined ? "Not reported" : (health?.fallback_active ?? health?.fallback) ? "Active" : "Inactive"}</dd></div>
            <div><dt>Last live event</dt><dd>{lastUpdate ? formatTime(lastUpdate.toISOString()) : "Not received"}</dd></div>
          </dl>
          <div className="preview-scroll" role="region" aria-label="Runtime component evidence" tabIndex={0}><table><caption>Runtime component evidence</caption><thead><tr><th>Component</th><th>Status</th><th>Reason</th></tr></thead><tbody>{components.map(([name, component]) => <tr key={name}><th scope="row">{name.replaceAll("_", " ")}</th><td><span className={`ops-state ops-state--${coreState(component.status)}`}>{stateLabel(component.status)}</span></td><td>{component.reason ?? "Not reported"}</td></tr>)}</tbody></table></div>
          {!components.length ? <div className="chart-empty">No runtime component inventory was reported.</div> : null}
        </div>
      </details>
    </section>
  );
}
