import { ArrowRight, CheckCircle2, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getAlertExplanation, getAlertsPage, submitAlertFeedback } from "../../api";
import { SeverityLabel } from "../../components/SeverityLabel";
import type { Alert, AlertExplanationStage, AlertStatus } from "../../types";
import { formatTime } from "../../utils";

const rangeMilliseconds: Record<string, number> = { "15m": 900_000, "1h": 3_600_000, "24h": 86_400_000 };
const defaultFilters = { query: "", severity: "all", status: "all", family: "all", range: "all" };

function WaterfallChart({ base, output, evidence, units }: { base: number; output: number; evidence: { feature: string; impact: number }[]; units: string }) {
  const width=620, row=34, left=170, right=24, top=34, height=top+(evidence.length+2)*row;
  const cumulative=[base]; evidence.forEach((item)=>cumulative.push(cumulative[cumulative.length-1]+item.impact));
  const values=[...cumulative,output]; const min=Math.min(...values), max=Math.max(...values); const pad=Math.max((max-min)*.08,.01);
  const x=(value:number)=>left+(value-(min-pad))/(max-min+pad*2)*(width-left-right);
  return <figure className="waterfall-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="waterfall-title waterfall-desc"><title id="waterfall-title">Cumulative SHAP waterfall</title><desc id="waterfall-desc">The model base value is adjusted by each signed feature impact until the output value.</desc>
    <line x1={left} x2={width-right} y1={top-15} y2={top-15} className="waterfall-axis"/><text x={x(base)} y={15} textAnchor="middle">base {base.toFixed(3)}</text>
    {evidence.map((item,index)=>{const start=cumulative[index],end=cumulative[index+1],y=top+index*row;return <g key={`${item.feature}-${index}`}><text x={left-8} y={y+15} textAnchor="end">{item.feature}</text>{index>0?<line x1={x(start)} x2={x(start)} y1={y-row+20} y2={y+4} className="waterfall-connector"/>:null}<rect x={Math.min(x(start),x(end))} y={y+4} width={Math.max(2,Math.abs(x(end)-x(start)))} height={18} className={item.impact>=0?"waterfall-positive":"waterfall-negative"}/><text x={item.impact>=0?x(end)+5:x(end)-5} y={y+18} textAnchor={item.impact>=0?"start":"end"}>{item.impact>=0?"+":""}{item.impact.toFixed(3)}</text></g>})}
    <line x1={x(cumulative[cumulative.length-1])} x2={x(output)} y1={top+(evidence.length-1)*row+20} y2={top+evidence.length*row+4} className="waterfall-connector"/><text x={left-8} y={top+evidence.length*row+18} textAnchor="end">Model output</text><circle cx={x(output)} cy={top+evidence.length*row+13} r={6} className="waterfall-output"/><text x={x(output)+10} y={top+evidence.length*row+18}>{output.toFixed(3)} {units}</text>
  </svg></figure>;
}

export function AlertWorkspace({ alerts, pending, onSelect, applyPending, loading = false, error = "", onRetry, fixtureMode = false }: {
  alerts: Alert[]; pending: number; onSelect: (alert: Alert) => void; applyPending: () => void;
  loading?: boolean; error?: string; onRetry?: () => void; fixtureMode?: boolean;
}) {
  const params = new URLSearchParams(location.search);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [severity, setSeverity] = useState(params.get("severity") ?? "all");
  const [status, setStatus] = useState(params.get("status") ?? "all");
  const [family, setFamily] = useState(params.get("family") ?? "all");
  const [range, setRange] = useState(params.get("range") ?? "all");
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");
  const [pageOffset, setPageOffset] = useState(0);
  const [pageItems, setPageItems] = useState<Alert[] | null>(null);
  const [pageTotal, setPageTotal] = useState(0);
  const [pageHasMore, setPageHasMore] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const pageLimit = 50;
  const sourceAlerts = fixtureMode ? alerts : pageItems ?? alerts;
  const families = useMemo(() => [...new Set(alerts.map((alert) => alert.attack_type))].sort(), [alerts]);
  const filtered = useMemo(() => {
    const needle = query.toLowerCase().trim();
    return sourceAlerts.filter((alert) => {
      const timestamp = Date.parse(alert.timestamp);
      const inRange = range === "all" || (Number.isFinite(timestamp) && timestamp >= Date.now() - rangeMilliseconds[range]);
      return (!needle || [alert.id, alert.attack_type, alert.source_ip, alert.destination_ip, alert.protocol].some((value) => value.toLowerCase().includes(needle)))
        && (severity === "all" || alert.severity === severity)
        && (status === "all" || alert.status === status)
        && (family === "all" || alert.attack_type === family)
        && inRange && (!from || timestamp >= Date.parse(from)) && (!to || timestamp < Date.parse(to));
    });
  }, [family, from, query, range, severity, sourceAlerts, status, to]);

  useEffect(() => { setPageOffset(0); }, [family, from, query, range, severity, status, to]);

  useEffect(() => {
    if (fixtureMode) return;
    let cancelled=false;
    const timer=window.setTimeout(() => {
      setPageLoading(true); setPageError("");
      const relativeFrom = range === "all" ? from : new Date(Date.now()-rangeMilliseconds[range]).toISOString();
      void getAlertsPage({ q: query, severity, status, family, from: relativeFrom || undefined, to: to || undefined, limit: pageLimit, offset: pageOffset })
        .then((result)=>{if(!cancelled){setPageItems(result.items);setPageTotal(result.total);setPageHasMore(result.has_more);}})
        .catch((reason)=>{if(!cancelled)setPageError(reason instanceof Error?reason.message:"Alert page could not be loaded.");})
        .finally(()=>{if(!cancelled)setPageLoading(false);});
    },200);
    return ()=>{cancelled=true;window.clearTimeout(timer);};
  },[alerts[0]?.id,family,fixtureMode,from,pageOffset,query,range,severity,status,to]);

  useEffect(() => {
    const next = new URLSearchParams(location.search);
    Object.entries({ q: query, severity, status, family, range, from, to }).forEach(([key, value]) => {
      if (value && value !== "all") next.set(key, value); else next.delete(key);
    });
    history.replaceState(null, "", `${location.pathname}?${next.toString()}`);
  }, [family, from, query, range, severity, status, to]);

  const reset = () => { setQuery(""); setSeverity("all"); setStatus("all"); setFamily("all"); setRange("all"); setFrom(""); setTo(""); };
  const hasFilters = query || severity !== "all" || status !== "all" || family !== "all" || range !== "all" || from || to;

  return <section className="panel alerts-panel" aria-labelledby="alerts-heading">
    <h2 className="sr-only" id="alerts-heading">Security alerts</h2>
    <div className="filters">
      <label className="search-field"><Search aria-hidden="true"/><span className="sr-only">Search alerts</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Endpoint, detection, ID, protocol…" /></label>
      <label><span className="sr-only">Time range</span><select value={range} onChange={(e) => { setRange(e.target.value); setFrom(""); setTo(""); }}><option value="all">All time</option><option value="15m">Last 15 minutes</option><option value="1h">Last hour</option><option value="24h">Last 24 hours</option></select></label>
      <label><span className="sr-only">Detection family</span><select value={family} onChange={(e) => setFamily(e.target.value)}><option value="all">All detections</option>{families.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><span className="sr-only">Severity</span><select value={severity} onChange={(e) => setSeverity(e.target.value)}><option value="all">All severities</option>{["critical","high","medium","low","normal"].map((v)=><option key={v}>{v[0].toUpperCase()+v.slice(1)}</option>)}</select></label>
      <label><span className="sr-only">Status</span><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option>{["new","investigating","confirmed","false_positive","resolved"].map((v)=><option key={v} value={v}>{v.replace("_"," ")}</option>)}</select></label>
      {hasFilters ? <button type="button" className="secondary-button filter-reset" onClick={reset}>Reset filters</button> : null}
      <span className="result-count">{fixtureMode ? filtered.length : pageTotal} results</span>
    </div>
    {(from || to) ? <div className="active-filter">Timeline interval: {from ? new Date(from).toLocaleString() : "start"} – {to ? new Date(to).toLocaleString() : "now"}<button type="button" onClick={() => { setFrom(""); setTo(""); }}>Clear interval</button></div> : null}
    {pending > 0 ? <button className="pending-banner" onClick={applyPending}>{pending} new alert{pending === 1 ? "" : "s"} received — show updates</button> : null}
    {(loading || pageLoading) ? <div className="data-state" role="status" data-state="loading">Loading alerts…</div> : (pageError || error) ? <div className="data-state data-state--error" role="status" data-state="error"><span>{pageError || error}</span>{onRetry ? <button className="secondary-button" onClick={onRetry}>Retry alerts</button> : null}</div> : !filtered.length ? <div className="alert-empty" data-state="empty"><b>{alerts.length ? "No alerts match these filters" : "No alerts recorded"}</b><span>{alerts.length ? "Reset filters to widen the investigation window." : "Run an attack replay to create real alert records."}</span>{hasFilters ? <button className="secondary-button" onClick={reset}>Clear all filters</button> : null}</div> : <>
      <div className="alert-table-wrap"><table className="alert-table" aria-label="Security alerts"><thead><tr role="presentation"><th>Severity</th><th>Detection</th><th>Route</th><th>Protocol</th><th>Detector score</th><th>Status</th><th>Time</th></tr></thead><tbody>{filtered.map((alert) => <tr key={alert.id} data-alert-id={alert.id} onClick={() => onSelect(alert)} tabIndex={0} aria-label={`Open ${alert.attack_type} alert ${alert.id}`} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(alert); } }}><td><SeverityLabel severity={alert.severity}/></td><td><span className="alert-open"><b>{alert.attack_type}</b><small>{alert.id}</small></span></td><td><b>{alert.source_ip}</b><small>to {alert.destination_ip}</small></td><td>{alert.protocol}</td><td>{(alert.confidence*100).toFixed(1)}%</td><td className={`status-text status-text--${alert.status}`}>{alert.status.replace("_"," ")}</td><td><time dateTime={alert.timestamp}>{formatTime(alert.timestamp)}</time></td></tr>)}</tbody></table></div>
      <div className="alert-cards" aria-label="Security alerts">{filtered.map((alert)=><article className="alert-card" key={alert.id}><div><SeverityLabel severity={alert.severity}/><span className={`status-text status-text--${alert.status}`}>{alert.status.replace("_"," ")}</span></div><h3>{alert.attack_type}</h3><p>{alert.source_ip} → {alert.destination_ip}</p><dl><div><dt>Protocol</dt><dd>{alert.protocol}</dd></div><div><dt>Detector score</dt><dd>{(alert.confidence*100).toFixed(1)}%</dd></div><div><dt>Observed</dt><dd>{formatTime(alert.timestamp)}</dd></div></dl><button className="secondary-button" onClick={() => onSelect(alert)} aria-label={`Open ${alert.attack_type} alert ${alert.id}`}>Inspect alert</button></article>)}</div>
    </>}
    {!loading && !pageLoading && !filtered.length ? <table className="sr-only" aria-label="Security alerts"><tbody><tr><td>No alerts recorded</td></tr></tbody></table> : null}
    {!fixtureMode && pageTotal > pageLimit ? <nav className="pagination" aria-label="Alert pages"><button className="secondary-button" disabled={pageOffset===0||pageLoading} onClick={()=>setPageOffset((value)=>Math.max(0,value-pageLimit))}>Previous</button><span>{pageOffset+1}–{Math.min(pageTotal,pageOffset+pageLimit)} of {pageTotal}</span><button className="secondary-button" disabled={!pageHasMore||pageLoading} onClick={()=>setPageOffset((value)=>value+pageLimit)}>Next</button></nav> : null}
    {alerts.length >= 500 ? <p className="window-note">Showing the latest 500 alert records returned by the API.</p> : null}
  </section>;
}

export function AlertDrawer({ alert, onClose, onStatusChange, loadExplanation = true, readOnly = false }: {
  alert: Alert; onClose: () => void; onStatusChange: (id: string, status: AlertStatus) => void; loadExplanation?: boolean; readOnly?: boolean;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const [feedbackState, setFeedbackState] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [explanations, setExplanations] = useState<AlertExplanationStage[]>([]);
  const [explanationState, setExplanationState] = useState<"loading"|"ready"|"empty"|"error">("loading");
  const [activeStage, setActiveStage] = useState(0);

  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    addEventListener("keydown", keydown);
    return () => { removeEventListener("keydown", keydown); restoreRef.current?.focus(); };
  }, [onClose]);

  useEffect(() => {
    if (!loadExplanation) { setExplanationState("empty"); setExplanations([]); return; }
    let cancelled=false; setExplanationState("loading"); setExplanations([]);
    void getAlertExplanation(alert.id).then((items)=>{ if(!cancelled){setExplanations(items);setExplanationState(items.length?"ready":"empty");setActiveStage(0);}}).catch(()=>{if(!cancelled)setExplanationState("error")});
    return ()=>{cancelled=true};
  },[alert.id,loadExplanation]);

  const updateStatus = async (status: AlertStatus) => {
    if (readOnly) return; setSubmitting(true); setFeedbackState("");
    try { await submitAlertFeedback(alert.id,{analyst:"dashboard-analyst",status,notes:`Status changed to ${status.replace("_"," ")} from the dashboard.`}); onStatusChange(alert.id,status); setFeedbackState(`Saved as ${status.replace("_"," ")}.`); }
    catch(error){setFeedbackState(error instanceof Error?error.message:"Could not save analyst feedback.");} finally{setSubmitting(false);}
  };
  const current = explanations[activeStage];
  const shown = current ? [...current.contributions].sort((a,b)=>Math.abs(b.impact)-Math.abs(a.impact)).slice(0,10) : [];
  const remaining = current ? current.contributions.slice(10).reduce((sum,item)=>sum+item.impact,0) : 0;
  const evidence = current ? [...shown.map(item=>({feature:item.feature,impact:item.impact,value:item.raw_value??undefined,evidence_type:"model_contribution" as const})), ...(current.contributions.length>10?[{feature:`Other ${current.contributions.length-10} features`,impact:remaining,evidence_type:"model_contribution" as const}]:[])] : [];

  return <div className="drawer-layer" role="presentation" onMouseDown={(e)=>e.target===e.currentTarget&&onClose()}><aside ref={dialogRef} className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
    <div className="drawer-header"><div><SeverityLabel severity={alert.severity}/><h2 id="drawer-title">{alert.attack_type}</h2><small>{alert.id} · {new Date(alert.timestamp).toLocaleString()}</small></div><button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Close alert details"><X/></button></div>
    <section className="drawer-section"><h3>Detection summary</h3><div className="summary-grid"><div><span>Detector score</span><b>{(alert.confidence*100).toFixed(1)}%</b></div><div><span>Status</span><b>{alert.status.replace("_"," ")}</b></div><div><span>Detector</span><b className="mono">{alert.detector_model_version??alert.model_version??"Not reported"}</b></div>{alert.classifier_model_version?<div><span>Classifier</span><b className="mono">{alert.classifier_model_version}</b></div>:null}{alert.attack_class_score!=null?<div><span>Class score</span><b>{(alert.attack_class_score*100).toFixed(1)}%</b></div>:null}<div><span>Detector latency</span><b>{alert.detector_latency_ms == null ? "Not reported" : `${alert.detector_latency_ms.toFixed(2)} ms`}</b></div>{alert.classifier_latency_ms!=null?<div><span>Classifier latency</span><b>{alert.classifier_latency_ms.toFixed(2)} ms</b></div>:null}<div><span>Total inference latency</span><b>{alert.total_latency_ms == null ? "Not reported" : `${alert.total_latency_ms.toFixed(2)} ms`}</b></div></div></section>
    <section className="drawer-section"><h3>Observed route</h3><div className="route-card"><span><small>Source</small><b>{alert.source_ip}</b></span><ArrowRight/><span><small>Destination</small><b>{alert.destination_ip}</b></span></div>{alert.identity_quality==="port_only"?<p>Only transport ports are available; they are not persistent device identities.</p>:null}</section>
    <section className="drawer-section"><h3>Model explanation</h3><p>Signed SHAP impacts explain this model output relative to its base value. They are associations inside the model, not causal proof.</p>
      {explanationState==="loading"?<div className="explanation-state" role="status">Computing explanation…</div>:null}{explanationState==="error"?<div className="explanation-state" role="alert">On-demand explanation is unavailable.</div>:null}
      {explanations.length>1?<div className="stage-tabs" role="tablist" aria-label="Explanation stage">{explanations.map((item,index)=><button key={`${item.stage}-${item.model_version}`} role="tab" aria-selected={activeStage===index} onClick={()=>setActiveStage(index)}>{item.stage==="binary"||item.stage==="detector"?"Detector":"Classifier"}</button>)}</div>:null}
      {current?<article className="explanation-stage"><div className="explanation-meta"><div><span>Explained class</span><b>{current.explained_class}</b></div><div><span>Model version</span><b>{current.model_version}</b></div><div><span>Base → output</span><b>{current.base_value.toFixed(4)} → {current.output_value.toFixed(4)}</b></div><div><span>Units / method</span><b>{current.output_units??"model output"} · {current.method}</b></div></div><WaterfallChart base={current.base_value} output={current.output_value} evidence={evidence} units={current.output_units??"model output"}/><div className="preview-scroll"><table className="evidence-table"><caption>Exact signed feature impacts</caption><thead><tr><th>Transformed feature</th><th>Raw feature</th><th>Raw value</th><th>Transformed value</th><th>Impact</th></tr></thead><tbody>{shown.map((item)=><tr key={item.feature}><td>{item.feature}</td><td>{item.raw_feature??"—"}</td><td>{String(item.raw_value??"—")}</td><td>{String(item.transformed_value??"—")}</td><td>{item.impact.toFixed(6)}</td></tr>)}{current.contributions.length>10?<tr><td colSpan={4}>Other {current.contributions.length-10} features</td><td>{remaining.toFixed(6)}</td></tr>:null}</tbody></table></div></article>:null}
      {explanationState==="empty"?<div className="explanation-state">No SHAP explanation was returned for this alert.</div>:null}
    </section>
    {!!alert.reasons?.length?<section className="drawer-section"><h3>Severity reasons</h3>{alert.reasons.map(reason=><p key={reason}>{reason}</p>)}</section>:null}
    <section className="drawer-section"><h3>Raw flow features</h3><dl className="feature-grid">{Object.entries(alert.features??{}).map(([key,value])=><div key={key}><dt>{key.replaceAll("_"," ")}</dt><dd>{value}</dd></div>)}</dl></section>
    <section className="drawer-section"><h3>Analyst action</h3>{readOnly?<p className="readonly-note">Fixture data is read-only. Connect the API to persist analyst feedback.</p>:null}<div className="drawer-actions"><button className="primary-button" disabled={submitting||readOnly} onClick={()=>void updateStatus("investigating")}>Start investigation</button><button className="secondary-button" disabled={submitting||readOnly} onClick={()=>void updateStatus("confirmed")}>Confirm alert</button><button className="secondary-button" disabled={submitting||readOnly} onClick={()=>void updateStatus("false_positive")}>Mark false positive</button><button className="secondary-button" disabled={submitting||readOnly} onClick={()=>void updateStatus("resolved")}><CheckCircle2/>Resolve</button></div>{feedbackState?<div className="feedback-state" role="status">{feedbackState}</div>:null}</section>
  </aside></div>;
}
