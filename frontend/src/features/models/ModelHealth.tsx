import { useEffect, useState } from "react";
import { getModelHealth, getModelHealthHistory } from "../../api";
import { PanelHeading } from "../../components/PanelHeading";
import type { ModelHealthHistory, ModelHealthSnapshot } from "../../types";

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not reported";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 5 });
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function EvidenceTable({ title, values }: { title: string; values: Record<string, unknown> | null }) {
  const rows = Object.entries(values ?? {});
  return <div className="preview-scroll"><table><caption>{title}</caption><thead><tr><th>Measure</th><th>Value</th></tr></thead><tbody>{rows.map(([key, value]) => <tr key={key}><th scope="row">{key.replaceAll("_", " ")}</th><td className="mono health-value">{display(value)}</td></tr>)}</tbody></table>{!rows.length ? <div className="chart-empty">No {title.toLowerCase()} was reported.</div> : null}</div>;
}

export function ModelHealth({ fixtureMode }: { fixtureMode: boolean }) {
  const [windowName, setWindowName] = useState<"fast" | "slow">("fast");
  const [source, setSource] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [applied, setApplied] = useState({ source: "", fingerprint: "" });
  const [snapshot, setSnapshot] = useState<ModelHealthSnapshot | null>(null);
  const [history, setHistory] = useState<ModelHealthHistory | null>(null);
  const [loading, setLoading] = useState(!fixtureMode);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (fixtureMode) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    const filters = { window: windowName, source: applied.source, extractor_fingerprint: applied.fingerprint };
    let timer: number | undefined;
    void Promise.all([getModelHealth(filters), getModelHealthHistory({ ...filters, limit: 50 })]).then(([next, nextHistory]) => {
      if (!cancelled) { setSnapshot(next); setHistory(nextHistory); }
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Model-health evidence is unavailable.");
    }).finally(() => {
      if (!cancelled) {
        setLoading(false);
        timer = window.setTimeout(() => setRefresh((value) => value + 1), 30_000);
      }
    });
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [applied, fixtureMode, refresh, windowName]);

  if (fixtureMode) return <section className="panel model-health-panel" aria-label="Model health"><PanelHeading eyebrow="Serving evidence" title="Model health" description="Monitoring evidence is computed from connected observations, not fixtures."/><div className="data-state" role="note">Fixture preview contains no model-health cohort.</div></section>;

  return (
    <section className="panel model-health-panel" aria-label="Model health">
      <PanelHeading eyebrow="Serving evidence" title="Model health" description="Read-only cohort monitoring. Health evidence does not retrain, promote, or change serving thresholds."/>
      <div className="model-health-toolbar">
        <div className="stage-tabs" role="tablist" aria-label="Model-health window"><button role="tab" aria-selected={windowName === "fast"} onClick={() => setWindowName("fast")}>Fast window</button><button role="tab" aria-selected={windowName === "slow"} onClick={() => setWindowName("slow")}>Slow window</button></div>
        <form className="model-health-filters" onSubmit={(event) => { event.preventDefault(); setApplied({ source: source.trim(), fingerprint: fingerprint.trim() }); }}><label>Source<input value={source} onChange={(event) => setSource(event.target.value)} placeholder="All sources"/></label><label>Extractor fingerprint<input value={fingerprint} onChange={(event) => setFingerprint(event.target.value)} placeholder="All compatible extractors"/></label><button type="submit" className="secondary-button">Apply cohort</button></form>
      </div>
      {loading ? <div className="data-state" role="status">Loading {windowName} model-health evidence…</div> : null}
      {error ? <div className="data-state data-state--error" role="alert">{error}</div> : null}
      {!loading && !error && !snapshot ? <div className="data-state">No model-health snapshot was returned.</div> : null}
      {snapshot ? <>
        <div className={`model-health-status model-health-status--${snapshot.status}`} role="status"><div><span>Current state</span><strong>{snapshot.status.replaceAll("_", " ")}</strong></div><p>{snapshot.reason}</p></div>
        <dl className="model-health-summary"><div><dt>Window</dt><dd>{snapshot.window}</dd></div><div><dt>Observations</dt><dd>{snapshot.observation_count.toLocaleString()}</dd></div><div><dt>Checked</dt><dd>{new Date(snapshot.checked_at).toLocaleString()}</dd></div><div><dt>Shadow mode</dt><dd>{snapshot.shadow_mode ? "Enabled" : "Disabled"}</dd></div></dl>
        <div className="model-health-evidence-grid"><EvidenceTable title="Aggregate health evidence" values={snapshot.aggregate}/><EvidenceTable title="Cohort definition" values={snapshot.cohort}/><EvidenceTable title="Reference evidence" values={snapshot.reference}/><EvidenceTable title="Input quality evidence" values={snapshot.quality}/><EvidenceTable title="Output evidence" values={snapshot.outputs}/><EvidenceTable title="Performance evidence" values={snapshot.performance}/></div>
        <div className="preview-scroll"><table><caption>Per-feature model-health evidence</caption><thead><tr><th>Feature</th><th>Status</th><th>Score</th><th>Threshold</th><th>Evidence</th></tr></thead><tbody>{snapshot.features.map((feature, index) => <tr key={String(feature.feature ?? feature.name ?? index)}><th scope="row">{display(feature.feature ?? feature.name ?? `Feature ${index + 1}`)}</th><td>{display(feature.status)}</td><td>{display(feature.score)}</td><td>{display(feature.threshold)}</td><td className="mono health-value">{display(Object.fromEntries(Object.entries(feature).filter(([key]) => !["feature", "name", "status", "score", "threshold"].includes(key))))}</td></tr>)}</tbody></table></div>
        {!snapshot.features.length ? <div className="chart-empty">No per-feature evidence was returned for this cohort.</div> : null}
        <div className="preview-scroll"><table><caption>Unseen categorical values</caption><thead><tr><th>Item</th><th>Evidence</th></tr></thead><tbody>{snapshot.unseen_categories.map((item, index) => <tr key={index}><th scope="row">{index + 1}</th><td className="mono health-value">{display(item)}</td></tr>)}</tbody></table></div>
        {!snapshot.unseen_categories.length ? <div className="chart-empty">No unseen categories were observed.</div> : null}
        <div className="preview-scroll"><table><caption>Recent model-health history</caption><thead><tr><th>Checked</th><th>Status</th><th>Observations</th><th>Aggregate score</th><th>Threshold</th></tr></thead><tbody>{(history?.items ?? []).map((item) => <tr key={item.checked_at}><th scope="row">{new Date(item.checked_at).toLocaleString()}</th><td><span className={`ops-state ops-state--${item.status.replaceAll("_", "-")}`}>{item.status.replaceAll("_", " ")}</span></td><td>{item.observation_count.toLocaleString()}</td><td>{display(item.aggregate_score)}</td><td>{display(item.aggregate_threshold)}</td></tr>)}</tbody></table></div>
        {!history?.items.length ? <div className="chart-empty">No historical model-health snapshots are available.</div> : null}
      </> : null}
    </section>
  );
}
