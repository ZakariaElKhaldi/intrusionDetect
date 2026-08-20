import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getAlertsPage } from "../../api";
import { useAuth } from "../../auth";
import { SeverityLabel } from "../../components/SeverityLabel";
import type { Alert } from "../../types";
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
  const auth = useAuth();
  const connected = !fixtureMode && auth.authenticated;
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
  const [pageRefresh, setPageRefresh] = useState(0);
  const pageLimit = 50;
  const alertRevision = useMemo(
    () => alerts.map((alert) => `${alert.id}:${alert.status}`).join("|"),
    [alerts],
  );
  const sourceAlerts = fixtureMode ? alerts : pageItems ?? alerts;
  const initialLoading = (loading || pageLoading) && sourceAlerts.length === 0;
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
    if (!connected) {
      setPageLoading(false);
      return;
    }
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
  },[alertRevision,connected,family,from,pageOffset,pageRefresh,query,range,severity,status,to]);

  useEffect(() => {
    const next = new URLSearchParams(location.search);
    Object.entries({ q: query, severity, status, family, range, from, to }).forEach(([key, value]) => {
      if (value && value !== "all") next.set(key, value); else next.delete(key);
    });
    history.replaceState(null, "", `${location.pathname}?${next.toString()}`);
  }, [family, from, query, range, severity, status, to]);

  const reset = () => { setQuery(""); setSeverity("all"); setStatus("all"); setFamily("all"); setRange("all"); setFrom(""); setTo(""); };
  const hasFilters = query || severity !== "all" || status !== "all" || family !== "all" || range !== "all" || from || to;
  const visibleError = pageError || error;
  const retry = () => pageError ? setPageRefresh((value) => value + 1) : onRetry?.();
  const quickView = severity === "critical" && status === "all" ? "critical"
    : severity === "all" && status === "new" ? "new"
      : severity === "all" && status === "investigating" ? "investigating"
        : severity === "all" && status === "all" ? "all" : "custom";
  const resultTotal = fixtureMode || pageItems === null ? filtered.length : pageTotal;
  const setQuickView = (view: "all" | "new" | "critical" | "investigating") => {
    setSeverity(view === "critical" ? "critical" : "all");
    setStatus(view === "new" ? "new" : view === "investigating" ? "investigating" : "all");
  };

  return <section className="panel alerts-panel" aria-labelledby="alerts-heading" aria-busy={pageLoading || loading}>
    <header className="queue-header">
      <div><span className="eyebrow">Analyst work queue</span><h2 id="alerts-heading">Security alerts</h2><p>Inspect packet-signature evidence and model detections without mixing their provenance.</p></div>
      <div className="queue-order"><b>{resultTotal.toLocaleString()}</b><span>matching {resultTotal === 1 ? "alert" : "alerts"} · newest first</span></div>
    </header>
    {!fixtureMode && !auth.authenticated ? <div className="data-state" role="note"><span>Sign in to inspect the protected alert queue.</span><button type="button" className="secondary-button" onClick={auth.openLogin}>Operator sign in</button></div> : null}
    <nav className="queue-views" aria-label="Alert queue views">
      <span>Quick views</span>
      {([
        ["all", "All alerts"],
        ["new", "Needs review"],
        ["critical", "Critical"],
        ["investigating", "In progress"],
      ] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={quickView === value} onClick={() => setQuickView(value)}>{label}</button>)}
      {quickView === "custom" ? <span className="queue-view-custom">Custom filters</span> : null}
    </nav>
    <div className="filters">
      <label className="filter-field filter-field--search"><span className="filter-label">Search</span><span className="search-field"><Search aria-hidden="true"/><input aria-label="Search alerts" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Endpoint, detection, ID, protocol…" /></span></label>
      <label className="filter-field"><span className="filter-label">Time</span><select value={range} onChange={(e) => { setRange(e.target.value); setFrom(""); setTo(""); }}><option value="all">All time</option><option value="15m">Last 15 minutes</option><option value="1h">Last hour</option><option value="24h">Last 24 hours</option></select></label>
      <label className="filter-field"><span className="filter-label">Detection</span><select value={family} onChange={(e) => setFamily(e.target.value)}><option value="all">All detections</option>{families.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="filter-field"><span className="filter-label">Severity</span><select value={severity} onChange={(e) => setSeverity(e.target.value)}><option value="all">All severities</option>{["critical","high","medium","low","normal"].map((v)=><option key={v}>{v[0].toUpperCase()+v.slice(1)}</option>)}</select></label>
      <label className="filter-field"><span className="filter-label">Status</span><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option>{["new","investigating","confirmed","false_positive","resolved"].map((v)=><option key={v} value={v}>{v.replace("_"," ")}</option>)}</select></label>
      {hasFilters ? <button type="button" className="secondary-button filter-reset" onClick={reset}>Reset filters</button> : null}
    </div>
    {(from || to) ? <div className="active-filter">Timeline interval: {from ? new Date(from).toLocaleString() : "start"} – {to ? new Date(to).toLocaleString() : "now"}<button type="button" onClick={() => { setFrom(""); setTo(""); }}>Clear interval</button></div> : null}
    {pending > 0 ? <button type="button" className="pending-banner" onClick={applyPending}>{pending} new alert{pending === 1 ? "" : "s"} received — show updates</button> : null}
    {visibleError && sourceAlerts.length > 0 ? <div className="data-state data-state--error" role="alert" data-state="stale"><span>The latest alert refresh failed; showing the last successful results. {visibleError}</span><button className="secondary-button" onClick={retry}>Retry alerts</button></div> : null}
    {initialLoading ? <div className="data-state" role="status" data-state="loading">Loading alerts…</div> : visibleError && sourceAlerts.length === 0 ? <div className="data-state data-state--error" role="alert" data-state="error"><span>{visibleError}</span>{(pageError || onRetry) ? <button className="secondary-button" onClick={retry}>Retry alerts</button> : null}</div> : !filtered.length ? <div className="alert-empty" data-state="empty"><b>{alerts.length ? "No alerts match these filters" : "No alerts recorded"}</b><span>{alerts.length ? "Reset filters to widen the investigation window." : "Run an attack replay to create real alert records."}</span>{hasFilters ? <button className="secondary-button" onClick={reset}>Clear all filters</button> : null}</div> : <>
      <div className="alert-table-wrap"><table className="alert-table" aria-label="Security alerts"><thead><tr><th scope="col">Severity</th><th scope="col">Detection</th><th scope="col">Route</th><th scope="col">Protocol</th><th scope="col">Evidence</th><th scope="col">Status</th><th scope="col">Time</th></tr></thead><tbody>{filtered.map((alert) => <tr key={alert.id}><td><SeverityLabel severity={alert.severity}/></td><td><button type="button" className="alert-open" data-alert-id={alert.id} onClick={() => onSelect(alert)} aria-label={`Open ${alert.attack_type} alert ${alert.id}`}><b>{alert.attack_type}</b><small>{alert.id}</small></button></td><td><b>{alert.source_ip}</b><small>to {alert.destination_ip}</small></td><td>{alert.protocol}</td><td>{alert.detection_source === "suricata" ? `Rule ${alert.sensor_evidence?.signature_id ?? "match"}` : `${(alert.confidence*100).toFixed(1)}% model`}</td><td className={`status-text status-text--${alert.status}`}>{alert.status.replace("_"," ")}</td><td><time dateTime={alert.timestamp}>{formatTime(alert.timestamp)}</time></td></tr>)}</tbody></table></div>
      <div className="alert-cards" aria-label="Security alerts">{filtered.map((alert)=><article className="alert-card" key={alert.id}><div><SeverityLabel severity={alert.severity}/><span className={`status-text status-text--${alert.status}`}>{alert.status.replace("_"," ")}</span></div><h3>{alert.attack_type}</h3><p>{alert.source_ip} → {alert.destination_ip}</p><dl><div><dt>Protocol</dt><dd>{alert.protocol}</dd></div><div><dt>Evidence</dt><dd>{alert.detection_source === "suricata" ? `Suricata rule ${alert.sensor_evidence?.signature_id ?? "match"}` : `${(alert.confidence*100).toFixed(1)}% model score`}</dd></div><div><dt>Observed</dt><dd>{formatTime(alert.timestamp)}</dd></div></dl><button type="button" className="secondary-button" data-alert-card-id={alert.id} onClick={() => onSelect(alert)} aria-label={`Open ${alert.attack_type} alert ${alert.id}`}>Inspect alert</button></article>)}</div>
    </>}
    {!loading && !pageLoading && !filtered.length ? <table className="sr-only" aria-label="Security alerts"><tbody><tr><td>No alerts recorded</td></tr></tbody></table> : null}
    {!fixtureMode && pageTotal > pageLimit ? <nav className="pagination" aria-label="Alert pages"><button className="secondary-button" disabled={pageOffset===0||pageLoading} onClick={()=>setPageOffset((value)=>Math.max(0,value-pageLimit))}>Previous</button><span>{pageOffset+1}–{Math.min(pageTotal,pageOffset+pageLimit)} of {pageTotal}</span><button className="secondary-button" disabled={!pageHasMore||pageLoading} onClick={()=>setPageOffset((value)=>value+pageLimit)}>Next</button></nav> : null}
    {alerts.length >= 500 ? <p className="window-note">Showing the latest 500 alert records returned by the API.</p> : null}
  </section>;
}
