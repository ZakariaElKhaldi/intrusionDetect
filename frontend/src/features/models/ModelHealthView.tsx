import { AlertTriangle, CheckCircle2, CircleDashed, ShieldX } from "lucide-react";
import { useMemo, useState } from "react";
import { PanelHeading } from "../../components/PanelHeading";
import { TabList, tabId } from "../../components/TabList";
import type { ModelHealthCohort, ModelHealthHistory, ModelHealthSnapshot } from "../../types";

export type ModelHealthWindow = "fast" | "slow";

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not reported";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 5 });
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function numeric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nestedNumber(value: Record<string, unknown>, path: string[]) {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[key];
  }
  return numeric(current);
}

function evidenceState(snapshot: ModelHealthSnapshot) {
  if (snapshot.status === "healthy") return { icon: CheckCircle2, label: "No active alarm", tone: "healthy" };
  if (snapshot.status === "collecting") return { icon: CircleDashed, label: "Evidence collecting", tone: "collecting" };
  if (["blocked", "incompatible_source"].includes(snapshot.status)) return { icon: ShieldX, label: "Monitoring blocked", tone: "critical" };
  return { icon: AlertTriangle, label: snapshot.status === "critical" ? "Persistent alarms" : "Change detected", tone: snapshot.status };
}

function EvidenceTable({ title, values }: { title: string; values: Record<string, unknown> | null }) {
  const rows = Object.entries(values ?? {});
  return (
    <div className="preview-scroll" role="region" aria-label={title} tabIndex={0}>
      <table>
        <caption>{title}</caption>
        <thead><tr><th>Measure</th><th>Value</th></tr></thead>
        <tbody>{rows.map(([key, value]) => <tr key={key}><th scope="row">{key.replaceAll("_", " ")}</th><td className="mono health-value">{display(value)}</td></tr>)}</tbody>
      </table>
      {!rows.length ? <div className="chart-empty">No {title.toLowerCase()} was reported.</div> : null}
    </div>
  );
}

function HistoryChart({ history }: { history: ModelHealthHistory }) {
  const items = [...history.items].reverse();
  const width = 720, height = 220, left = 48, right = 18, top = 18, bottom = 40;
  const scores = items.map((item) => item.aggregate_score ?? 0);
  const thresholds = items.map((item) => item.aggregate_threshold ?? 0);
  const ceiling = Math.max(0.00001, ...scores, ...thresholds);
  const x = (index: number) => left + (items.length <= 1 ? 0 : index / (items.length - 1)) * (width - left - right);
  const y = (score: number) => top + (1 - score / ceiling) * (height - top - bottom);
  const latest = history.items.reduce((current, item) => Date.parse(item.checked_at) > Date.parse(current.checked_at) ? item : current, history.items[0]);

  return (
    <figure className="model-health-history-chart">
      <figcaption><strong>Calibrated signal history</strong><span>{items.length} check{items.length === 1 ? "" : "s"} · latest {display(latest.aggregate_score)} against threshold {display(latest.aggregate_threshold)}</span></figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="health-history-title health-history-desc">
        <title id="health-history-title">Model-health aggregate score history</title>
        <desc id="health-history-desc">{items.length} aggregate calibrated drift checks. The latest score is {display(latest.aggregate_score)} and its alarm threshold is {display(latest.aggregate_threshold)}.</desc>
        <polyline points={items.map((item, index) => `${x(index)},${y(item.aggregate_threshold ?? 0)}`).join(" ")} className="health-threshold" />
        <text x={left + 4} y={y(thresholds.at(-1) ?? 0) - 5}>Alarm threshold</text>
        <polyline points={items.map((item, index) => `${x(index)},${y(item.aggregate_score ?? 0)}`).join(" ")} className="health-history-line" />
        {items.map((item, index) => <circle key={`${item.checked_at}-${index}`} cx={x(index)} cy={y(item.aggregate_score ?? 0)} r="5" className={`health-history-point health-history-point--${item.status}`}><title>{new Date(item.checked_at).toLocaleString()}: {display(item.aggregate_score)} · {item.status}</title></circle>)}
      </svg>
    </figure>
  );
}

export function cohortLabel(cohort: ModelHealthCohort) {
  return `${cohort.ingestion_channel} · ${cohort.schema_version} · ${cohort.model_version}${cohort.deployment_eligible ? " · deployment" : ""}`;
}

export interface ModelHealthViewProps {
  fixtureMode?: boolean;
  windowName: ModelHealthWindow;
  cohorts: ModelHealthCohort[];
  cohortIndex: string;
  snapshot: ModelHealthSnapshot | null;
  history: ModelHealthHistory | null;
  loading: boolean;
  error: string;
  onWindowName: (window: ModelHealthWindow) => void;
  onCohortIndex: (index: string) => void;
}

export function ModelHealthView({
  fixtureMode = false,
  windowName,
  cohorts,
  cohortIndex,
  snapshot,
  history,
  loading,
  error,
  onWindowName,
  onCohortIndex,
}: ModelHealthViewProps) {
  const [featureSort, setFeatureSort] = useState<"alarm" | "name">("alarm");
  const selected = cohortIndex === "" ? null : cohorts[Number(cohortIndex)] ?? null;
  const features = useMemo(() => [...(snapshot?.features ?? [])].sort((left, right) => featureSort === "name"
    ? String(left.feature ?? left.name).localeCompare(String(right.feature ?? right.name))
    : Number(Boolean(right.drifted) || ["warning", "critical"].includes(String(right.status))) - Number(Boolean(left.drifted) || ["warning", "critical"].includes(String(left.status))) || Number(right.score ?? right.js_distance ?? 0) - Number(left.score ?? left.js_distance ?? 0)), [featureSort, snapshot?.features]);

  if (fixtureMode) {
    return <section className="panel model-health-panel" aria-label="Model health"><PanelHeading title="Model health"/><div className="data-state" role="note">Fixture preview contains no model-health cohort.</div></section>;
  }

  const featureAlarms = snapshot ? numeric(snapshot.aggregate.feature_alarm_count) ?? features.filter((feature) => Boolean(feature.drifted) || ["warning", "critical"].includes(String(feature.status))).length : 0;
  const outputAlarms = snapshot ? numeric(snapshot.aggregate.output_alarm_count) ?? 0 : 0;
  const score = snapshot ? numeric(snapshot.aggregate.score) : null;
  const threshold = snapshot ? numeric(snapshot.aggregate.threshold) : null;
  const labelled = snapshot ? nestedNumber(snapshot.performance, ["ground_truth", "labelled_count"]) : null;
  const reviewed = snapshot ? nestedNumber(snapshot.performance, ["analyst_review", "reviewed_alert_count"]) : null;
  const alarmFeatures = features.filter((feature) => Boolean(feature.drifted) || ["warning", "critical"].includes(String(feature.status))).slice(0, 3);
  const scope: Record<string, unknown> = snapshot?.cohort ?? (selected ? { ...selected } : {});
  const state = snapshot ? evidenceState(snapshot) : null;
  const StateIcon = state?.icon;

  return (
    <section className="panel model-health-panel" aria-label="Model health">
      <PanelHeading title="Model health"/>
      <div className="model-health-toolbar">
        <TabList baseId="model-health-window" label="Model-health window" options={[{ value: "fast", label: "Fast · 24 hours" }, { value: "slow", label: "Slow · 7 days" }]} panelId="model-health-window-panel" selected={windowName} onSelect={onWindowName} />
        <label className="cohort-selector">Cohort<select value={cohortIndex} onChange={(event) => onCohortIndex(event.target.value)}><option value="">Current deployment cohort</option>{cohorts.map((cohort, index) => <option key={cohortLabel(cohort)} value={index}>{cohortLabel(cohort)}</option>)}</select></label>
      </div>
      <div id="model-health-window-panel" role="tabpanel" aria-labelledby={tabId("model-health-window", windowName)}>
        {loading ? <div className="data-state" role="status">Loading {windowName} model-health evidence…</div> : null}
        {error ? <div className="data-state data-state--error model-health-error" role="alert"><strong>Monitoring evidence unavailable</strong><span>{error}</span></div> : null}
        {!loading && !error && !snapshot ? <div className="data-state">No model-health snapshot was returned for this scope.</div> : null}
        {snapshot && state && StateIcon ? <>
          <div className={`model-health-status model-health-status--${snapshot.status}`} role="status">
            <div><span>Current assessment</span><strong>{snapshot.status.replaceAll("_", " ")}</strong></div>
            <p>{snapshot.reason}</p>
            <span className={`health-assessment-badge health-assessment-badge--${state.tone}`}><StateIcon aria-hidden="true" />{state.label}</span>
          </div>
          <dl className="model-health-scope" aria-label="Monitoring scope">
            <div><dt>Channel</dt><dd>{display(scope.ingestion_channel ?? scope.source)}</dd></div>
            <div><dt>Schema</dt><dd className="mono">{display(scope.schema_version)}</dd></div>
            <div><dt>Window</dt><dd>{snapshot.window === "fast" ? "24 hours" : "7 days"}</dd></div>
            <div><dt>Checked</dt><dd>{new Date(snapshot.checked_at).toLocaleString()}</dd></div>
            <div><dt>Mode</dt><dd>{snapshot.shadow_mode ? "Shadow · no automation" : "Operational policy"}</dd></div>
          </dl>
          <div className="model-health-decision-grid">
            <div><span>Observations</span><strong>{snapshot.observation_count.toLocaleString()}</strong><small>in this cohort and window</small></div>
            <div className={featureAlarms ? "model-health-decision--attention" : ""}><span>Feature alarms</span><strong>{featureAlarms}</strong><small>calibrated input signals</small></div>
            <div className={outputAlarms ? "model-health-decision--attention" : ""}><span>Output alarms</span><strong>{outputAlarms}</strong><small>verdict or score signals</small></div>
            <div><span>Aggregate signal</span><strong>{display(score)}</strong><small>threshold {display(threshold)} · not probability</small></div>
            <div><span>Labelled rows</span><strong>{display(labelled)}</strong><small>ground-truth evidence</small></div>
            <div><span>Reviewed alerts</span><strong>{display(reviewed)}</strong><small>analyst decisions only</small></div>
          </div>
          <div className={`model-health-drivers model-health-drivers--${snapshot.status}`}>
            <div><span className="eyebrow">Interpretation</span><h3>{featureAlarms || outputAlarms ? "What changed" : snapshot.status === "collecting" ? "Evidence is still accumulating" : snapshot.status === "healthy" ? "No calibrated alarm is active" : "Why monitoring is blocked"}</h3></div>
            <ul>
              {alarmFeatures.map((feature, index) => <li key={String(feature.feature ?? feature.name ?? index)}><strong>{display(feature.feature ?? feature.name)}</strong><span>signal {display(feature.score ?? feature.js_distance)} · threshold {display(feature.threshold ?? feature.js_threshold)}</span></li>)}
              {outputAlarms ? <li><strong>Output distribution</strong><span>{outputAlarms} active alarm{outputAlarms === 1 ? "" : "s"}</span></li> : null}
              {snapshot.unseen_categories.length ? <li><strong>Unseen categories</strong><span>{snapshot.unseen_categories.length} value{snapshot.unseen_categories.length === 1 ? "" : "s"} outside the reference</span></li> : null}
              {!featureAlarms && !outputAlarms && !snapshot.unseen_categories.length ? <li><strong>{snapshot.status === "collecting" ? "Minimum support not reached" : snapshot.status === "healthy" ? "Reference comparison is within limits" : "Structured alarm evidence unavailable"}</strong><span>{snapshot.reason}</span></li> : null}
            </ul>
          </div>
          <div className="research-warning" role="note">Distribution shift means traffic changed relative to the reference. It does not prove accuracy loss; labelled outcomes and analyst review remain separate evidence.</div>
          {history?.items.length ? <HistoryChart history={history} /> : <div className="chart-empty">No historical model-health snapshots are available.</div>}

          <details className="model-health-disclosure">
            <summary><span>Health evidence breakdown</span><small>6 evidence groups</small></summary>
            <div className="model-health-evidence-grid"><EvidenceTable title="Aggregate health evidence" values={snapshot.aggregate} /><EvidenceTable title="Cohort definition" values={snapshot.cohort} /><EvidenceTable title="Reference evidence" values={snapshot.reference} /><EvidenceTable title="Input quality evidence" values={snapshot.quality} /><EvidenceTable title="Output drift evidence" values={snapshot.outputs} /><EvidenceTable title="Labelled performance evidence" values={snapshot.performance} /></div>
          </details>

          <details className="model-health-disclosure">
            <summary><span>Per-feature evidence</span><small>{features.length} features · alarms first</small></summary>
            <div className="feature-table-heading"><h3>Per-feature model-health evidence</h3><label>Sort<select value={featureSort} onChange={(event) => setFeatureSort(event.target.value as "alarm" | "name")}><option value="alarm">Alarms first</option><option value="name">Feature name</option></select></label></div>
            <div className="preview-scroll" role="region" aria-label="Per-feature model-health evidence" tabIndex={0}><table><caption>Per-feature model-health evidence</caption><thead><tr><th>Feature</th><th>Status</th><th>Score</th><th>Threshold</th><th>Evidence</th></tr></thead><tbody>{features.map((feature, index) => <tr key={String(feature.feature ?? feature.name ?? index)}><th scope="row">{display(feature.feature ?? feature.name ?? `Feature ${index + 1}`)}</th><td>{display(feature.status)}</td><td>{display(feature.score ?? feature.js_distance)}</td><td>{display(feature.threshold ?? feature.js_threshold)}</td><td className="mono health-value">{display(Object.fromEntries(Object.entries(feature).filter(([key]) => !["feature", "name", "status", "score", "threshold"].includes(key))))}</td></tr>)}</tbody></table></div>
            {!features.length ? <div className="chart-empty">No per-feature evidence was returned for this cohort.</div> : null}
          </details>

          <details className="model-health-disclosure">
            <summary><span>Unseen categorical values</span><small>{snapshot.unseen_categories.length} observed</small></summary>
            <div className="preview-scroll" role="region" aria-label="Unseen categorical values" tabIndex={0}><table><caption>Unseen categorical values</caption><thead><tr><th>Item</th><th>Evidence</th></tr></thead><tbody>{snapshot.unseen_categories.map((item, index) => <tr key={index}><th scope="row">{index + 1}</th><td className="mono health-value">{display(item)}</td></tr>)}</tbody></table></div>
            {!snapshot.unseen_categories.length ? <div className="chart-empty">No unseen categories were observed.</div> : null}
          </details>

          <details className="model-health-disclosure">
            <summary><span>Recent health records</span><small>{history?.items.length ?? 0} checks</small></summary>
            <div className="preview-scroll" role="region" aria-label="Recent model-health history" tabIndex={0}><table><caption>Recent model-health history</caption><thead><tr><th>Checked</th><th>Status</th><th>Observations</th><th>Score</th><th>Feature alarms</th><th>Output alarms</th></tr></thead><tbody>{(history?.items ?? []).map((item) => <tr key={item.checked_at}><th scope="row">{new Date(item.checked_at).toLocaleString()}</th><td><span className={`ops-state ops-state--${item.status.replaceAll("_", "-")}`}>{item.status.replaceAll("_", " ")}</span></td><td>{item.observation_count.toLocaleString()}</td><td>{display(item.aggregate_score)}</td><td>{item.feature_alarm_count}</td><td>{item.output_alarm_count}</td></tr>)}</tbody></table></div>
          </details>
        </> : null}
      </div>
    </section>
  );
}
