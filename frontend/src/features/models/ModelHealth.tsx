import { useEffect, useMemo, useState } from "react";
import { getModelHealth, getModelHealthCohorts, getModelHealthHistory } from "../../api";
import { PanelHeading } from "../../components/PanelHeading";
import { TabList, tabId } from "../../components/TabList";
import type { ModelHealthCohort, ModelHealthHistory, ModelHealthSnapshot } from "../../types";

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not reported";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 5 });
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function EvidenceTable({ title, values }: { title: string; values: Record<string, unknown> | null }) {
  const rows = Object.entries(values ?? {});
  return (
    <div className="preview-scroll">
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
  const ceiling = Math.max(1, ...scores);
  const x = (index: number) => left + (items.length <= 1 ? 0 : index / (items.length - 1)) * (width - left - right);
  const y = (score: number) => top + (1 - score / ceiling) * (height - top - bottom);

  return (
    <figure className="model-health-history-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="health-history-title health-history-desc">
        <title id="health-history-title">Model-health aggregate score history</title>
        <desc id="health-history-desc">Aggregate calibrated drift score over time. The alarm threshold is one.</desc>
        <line x1={left} x2={width - right} y1={y(1)} y2={y(1)} className="health-threshold" />
        <text x={left + 4} y={y(1) - 5}>Alarm threshold 1.0</text>
        {items.length ? <polyline points={items.map((item, index) => `${x(index)},${y(item.aggregate_score ?? 0)}`).join(" ")} className="health-history-line" /> : null}
        {items.map((item, index) => <circle key={`${item.checked_at}-${index}`} cx={x(index)} cy={y(item.aggregate_score ?? 0)} r="5" className={`health-history-point health-history-point--${item.status}`}><title>{new Date(item.checked_at).toLocaleString()}: {display(item.aggregate_score)} · {item.status}</title></circle>)}
      </svg>
    </figure>
  );
}

function cohortLabel(cohort: ModelHealthCohort) {
  return `${cohort.ingestion_channel} · ${cohort.schema_version} · ${cohort.model_version}${cohort.deployment_eligible ? " · deployment" : ""}`;
}

export function ModelHealth({ fixtureMode }: { fixtureMode: boolean }) {
  const [windowName, setWindowName] = useState<"fast" | "slow">("fast");
  const [cohorts, setCohorts] = useState<ModelHealthCohort[]>([]);
  const [cohortIndex, setCohortIndex] = useState("");
  const [snapshot, setSnapshot] = useState<ModelHealthSnapshot | null>(null);
  const [history, setHistory] = useState<ModelHealthHistory | null>(null);
  const [loading, setLoading] = useState(!fixtureMode);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [featureSort, setFeatureSort] = useState<"alarm" | "name">("alarm");
  const selected = cohortIndex === "" ? null : cohorts[Number(cohortIndex)] ?? null;

  useEffect(() => {
    if (fixtureMode) return;
    void getModelHealthCohorts().then(setCohorts).catch(() => undefined);
  }, [fixtureMode]);

  useEffect(() => {
    if (fixtureMode) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    const filters = {
      window: windowName,
      source: selected?.ingestion_channel,
      extractor_fingerprint: selected?.extractor_fingerprint ?? undefined,
      schema_version: selected?.schema_version,
      model_version: selected?.model_version,
    };
    let timer: number | undefined;
    void Promise.all([getModelHealth(filters), getModelHealthHistory({ ...filters, limit: 50 })]).then(([next, nextHistory]) => {
      if (!cancelled) { setSnapshot(next); setHistory(nextHistory); }
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Model-health evidence is unavailable.");
    }).finally(() => {
      if (!cancelled) { setLoading(false); timer = window.setTimeout(() => setRefresh((value) => value + 1), 30_000); }
    });
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [cohortIndex, cohorts, fixtureMode, refresh, selected, windowName]);

  const features = useMemo(() => [...(snapshot?.features ?? [])].sort((left, right) => featureSort === "name"
    ? String(left.feature ?? left.name).localeCompare(String(right.feature ?? right.name))
    : Number(Boolean(right.drifted)) - Number(Boolean(left.drifted)) || Number(right.score ?? right.js_distance ?? 0) - Number(left.score ?? left.js_distance ?? 0)), [featureSort, snapshot?.features]);

  if (fixtureMode) {
    return <section className="panel model-health-panel" aria-label="Model health"><PanelHeading eyebrow="Serving evidence" title="Model health" description="Monitoring evidence is computed from connected observations, not fixtures." /><div className="data-state" role="note">Fixture preview contains no model-health cohort.</div></section>;
  }

  return (
    <section className="panel model-health-panel" aria-label="Model health">
      <PanelHeading eyebrow="Production monitoring" title="Model health" description="Read-only cohort monitoring. Health evidence does not retrain, promote, roll back, or change serving thresholds." />
      <div className="model-health-toolbar">
        <TabList baseId="model-health-window" label="Model-health window" options={[{ value: "fast", label: "Fast window" }, { value: "slow", label: "Slow window" }]} panelId="model-health-window-panel" selected={windowName} onSelect={setWindowName} />
        <label className="cohort-selector">Cohort<select value={cohortIndex} onChange={(event) => setCohortIndex(event.target.value)}><option value="">Current deployment cohort</option>{cohorts.map((cohort, index) => <option key={cohortLabel(cohort)} value={index}>{cohortLabel(cohort)}</option>)}</select></label>
      </div>
      <div id="model-health-window-panel" role="tabpanel" aria-labelledby={tabId("model-health-window", windowName)}>
        {loading ? <div className="data-state" role="status">Loading {windowName} model-health evidence…</div> : null}
        {error ? <div className="data-state data-state--error" role="alert">{error}</div> : null}
        {!loading && !error && !snapshot ? <div className="data-state">No model-health snapshot was returned.</div> : null}
        {snapshot ? <>
          <div className={`model-health-status model-health-status--${snapshot.status}`} role="status"><div><span>Current state</span><strong>{snapshot.status.replaceAll("_", " ")}</strong></div><p>{snapshot.reason}</p></div>
          <div className="research-warning" role="note">Distribution shift is evidence of changed traffic, not proof of accuracy loss. Labelled performance and analyst review are reported separately.</div>
          <dl className="model-health-summary"><div><dt>Window</dt><dd>{snapshot.window}</dd></div><div><dt>Observations</dt><dd>{snapshot.observation_count.toLocaleString()}</dd></div><div><dt>Checked</dt><dd>{new Date(snapshot.checked_at).toLocaleString()}</dd></div><div><dt>Shadow mode</dt><dd>{snapshot.shadow_mode ? "Enabled" : "Disabled"}</dd></div></dl>
          {history?.items.length ? <HistoryChart history={history} /> : <div className="chart-empty">No historical model-health snapshots are available.</div>}

          <details className="model-health-disclosure">
            <summary><span>Health evidence breakdown</span><small>6 evidence groups</small></summary>
            <div className="model-health-evidence-grid"><EvidenceTable title="Aggregate health evidence" values={snapshot.aggregate} /><EvidenceTable title="Cohort definition" values={snapshot.cohort} /><EvidenceTable title="Reference evidence" values={snapshot.reference} /><EvidenceTable title="Input quality evidence" values={snapshot.quality} /><EvidenceTable title="Output drift evidence" values={snapshot.outputs} /><EvidenceTable title="Labelled performance evidence" values={snapshot.performance} /></div>
          </details>

          <details className="model-health-disclosure">
            <summary><span>Per-feature evidence</span><small>{features.length} features · alarms first</small></summary>
            <div className="feature-table-heading"><h3>Per-feature model-health evidence</h3><label>Sort<select value={featureSort} onChange={(event) => setFeatureSort(event.target.value as "alarm" | "name")}><option value="alarm">Alarms first</option><option value="name">Feature name</option></select></label></div>
            <div className="preview-scroll"><table><caption>Per-feature model-health evidence</caption><thead><tr><th>Feature</th><th>Status</th><th>Score</th><th>Threshold</th><th>Evidence</th></tr></thead><tbody>{features.map((feature, index) => <tr key={String(feature.feature ?? feature.name ?? index)}><th scope="row">{display(feature.feature ?? feature.name ?? `Feature ${index + 1}`)}</th><td>{display(feature.status)}</td><td>{display(feature.score ?? feature.js_distance)}</td><td>{display(feature.threshold ?? feature.js_threshold)}</td><td className="mono health-value">{display(Object.fromEntries(Object.entries(feature).filter(([key]) => !["feature", "name", "status", "score", "threshold"].includes(key))))}</td></tr>)}</tbody></table></div>
            {!features.length ? <div className="chart-empty">No per-feature evidence was returned for this cohort.</div> : null}
          </details>

          <details className="model-health-disclosure">
            <summary><span>Unseen categorical values</span><small>{snapshot.unseen_categories.length} observed</small></summary>
            <div className="preview-scroll"><table><caption>Unseen categorical values</caption><thead><tr><th>Item</th><th>Evidence</th></tr></thead><tbody>{snapshot.unseen_categories.map((item, index) => <tr key={index}><th scope="row">{index + 1}</th><td className="mono health-value">{display(item)}</td></tr>)}</tbody></table></div>
            {!snapshot.unseen_categories.length ? <div className="chart-empty">No unseen categories were observed.</div> : null}
          </details>

          <details className="model-health-disclosure">
            <summary><span>Recent health records</span><small>{history?.items.length ?? 0} checks</small></summary>
            <div className="preview-scroll"><table><caption>Recent model-health history</caption><thead><tr><th>Checked</th><th>Status</th><th>Observations</th><th>Score</th><th>Feature alarms</th><th>Output alarms</th></tr></thead><tbody>{(history?.items ?? []).map((item) => <tr key={item.checked_at}><th scope="row">{new Date(item.checked_at).toLocaleString()}</th><td><span className={`ops-state ops-state--${item.status.replaceAll("_", "-")}`}>{item.status.replaceAll("_", " ")}</span></td><td>{item.observation_count.toLocaleString()}</td><td>{display(item.aggregate_score)}</td><td>{item.feature_alarm_count}</td><td>{item.output_alarm_count}</td></tr>)}</tbody></table></div>
          </details>
        </> : null}
      </div>
    </section>
  );
}
