import { ArrowRight, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { getAlertExplanation, submitAlertFeedback } from "../../api";
import { useAuth } from "../../auth";
import { SeverityLabel } from "../../components/SeverityLabel";
import { TabList, tabId } from "../../components/TabList";
import type { Alert, AlertExplanationStage, AlertStatus, AnalystFeedback } from "../../types";

type InvestigationView = "triage" | "model" | "record";
type ExplanationState = "loading" | "ready" | "empty" | "error";

const statusOptions: { value: AlertStatus; label: string }[] = [
  { value: "new", label: "Return to needs review" },
  { value: "investigating", label: "Start investigation" },
  { value: "confirmed", label: "Confirm alert" },
  { value: "false_positive", label: "Mark false positive" },
  { value: "resolved", label: "Resolve alert" },
];

function displayStatus(value: AlertStatus): string {
  return value.replace("_", " ");
}

function formatScore(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "Not reported" : value.toFixed(4);
}

function formatLatency(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "Not reported" : `${value.toFixed(2)} ms`;
}

export function chartContributions(contributions: AlertExplanationStage["contributions"], limit = 8) {
  const sorted = [...contributions].sort((left, right) => Math.abs(right.impact) - Math.abs(left.impact));
  const chart = sorted.slice(0, limit).map((item) => ({ feature: item.feature, impact: item.impact }));
  if (sorted.length > limit) {
    chart.push({
      feature: `Other ${sorted.length - limit} features`,
      impact: sorted.slice(limit).reduce((sum, item) => sum + item.impact, 0),
    });
  }
  return { sorted, chart };
}

function WaterfallChart({
  base,
  output,
  evidence,
  units,
  labelId,
}: {
  base: number;
  output: number;
  evidence: { feature: string; impact: number }[];
  units: string;
  labelId: string;
}) {
  const width = 660;
  const row = 36;
  const left = 190;
  const right = 80;
  const top = 42;
  const height = top + (evidence.length + 2) * row;
  const cumulative = [base];
  evidence.forEach((item) => cumulative.push(cumulative[cumulative.length - 1] + item.impact));
  const values = [...cumulative, output];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.08, 0.01);
  const x = (value: number) => left + (value - (min - pad)) / (max - min + pad * 2) * (width - left - right);

  return <figure className="waterfall-chart" aria-labelledby={labelId} tabIndex={0}>
    <figcaption id={labelId}>Largest signed contributions from base value to model output</figcaption>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Waterfall from base ${base.toFixed(4)} to output ${output.toFixed(4)} ${units}. Exact contributions follow in a table.`}>
      <line x1={left} x2={width - right} y1={top - 15} y2={top - 15} className="waterfall-axis" />
      <text x={x(base)} y={17} textAnchor="middle">base {base.toFixed(3)}</text>
      {evidence.map((item, index) => {
        const start = cumulative[index];
        const end = cumulative[index + 1];
        const y = top + index * row;
        return <g key={`${item.feature}-${index}`}>
          <text x={left - 8} y={y + 16} textAnchor="end">{item.feature}</text>
          {index > 0 ? <line x1={x(start)} x2={x(start)} y1={y - row + 22} y2={y + 4} className="waterfall-connector" /> : null}
          <rect x={Math.min(x(start), x(end))} y={y + 4} width={Math.max(2, Math.abs(x(end) - x(start)))} height={19} className={item.impact >= 0 ? "waterfall-positive" : "waterfall-negative"} />
          <text x={item.impact >= 0 ? x(end) + 5 : x(end) - 5} y={y + 19} textAnchor={item.impact >= 0 ? "start" : "end"}>{item.impact >= 0 ? "+" : ""}{item.impact.toFixed(3)}</text>
        </g>;
      })}
      <text x={left - 8} y={top + evidence.length * row + 19} textAnchor="end">Model output</text>
      <circle cx={x(output)} cy={top + evidence.length * row + 14} r={6} className="waterfall-output" />
      <text x={x(output) + 10} y={top + evidence.length * row + 19}>{output.toFixed(3)}</text>
    </svg>
  </figure>;
}

export interface AlertInvestigationViewProps {
  alert: Alert;
  onClose: () => void;
  onDisposition?: (status: AlertStatus, notes: string) => Promise<AnalystFeedback | null>;
  explanations?: AlertExplanationStage[];
  explanationState?: ExplanationState;
  explanationError?: string;
  onRetryExplanation?: () => void;
  readOnly?: boolean;
  initialView?: InvestigationView;
}

export function AlertInvestigationView({
  alert,
  onClose,
  onDisposition,
  explanations = [],
  explanationState = explanations.length ? "ready" : "empty",
  explanationError = "",
  onRetryExplanation,
  readOnly = false,
  initialView = "triage",
}: AlertInvestigationViewProps) {
  const instanceId = useId().replaceAll(":", "");
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const restoreFrameRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [view, setView] = useState<InvestigationView>(initialView);
  const [activeStage, setActiveStage] = useState(0);
  const [proposedStatus, setProposedStatus] = useState<AlertStatus>(alert.status === "new" ? "investigating" : "resolved");
  const [notes, setNotes] = useState("");
  const [pendingDisposition, setPendingDisposition] = useState<AlertStatus | null>(null);
  const [feedbackState, setFeedbackState] = useState("");
  const [feedbackError, setFeedbackError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedbackHistory, setFeedbackHistory] = useState(alert.feedback ?? []);
  const current = explanations[activeStage];
  const contributionEvidence = useMemo(
    () => chartContributions(current?.contributions ?? []),
    [current],
  );
  const sortedContributions = contributionEvidence.sorted;
  const chartEvidence = contributionEvidence.chart;
  const strongestIncrease = sortedContributions.find((item) => item.impact > 0);
  const strongestDecrease = sortedContributions.find((item) => item.impact < 0);
  const reconstructedOutput = current
    ? current.base_value + current.contributions.reduce((sum, item) => sum + item.impact, 0)
    : null;
  const requiresReason = ["confirmed", "false_positive", "resolved"].includes(proposedStatus);

  useEffect(() => {
    setFeedbackHistory(alert.feedback ?? []);
  }, [alert.feedback]);

  useEffect(() => {
    if (activeStage >= explanations.length) setActiveStage(0);
  }, [activeStage, explanations.length]);

  useEffect(() => {
    if (restoreFrameRef.current !== null) window.cancelAnimationFrame(restoreFrameRef.current);
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialogRef.current?.contains(activeElement)) restoreRef.current = activeElement;
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), summary, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    addEventListener("keydown", keydown);
    return () => {
      removeEventListener("keydown", keydown);
      const original = restoreRef.current;
      restoreFrameRef.current = window.requestAnimationFrame(() => {
        restoreFrameRef.current = null;
        if (original?.isConnected) original.focus();
        else [...document.querySelectorAll<HTMLElement>("[data-alert-id], [data-alert-card-id]")]
          .find((element) => element.dataset.alertId === alert.id || element.dataset.alertCardId === alert.id)?.focus();
      });
    };
  }, [alert.id]);

  const reviewDisposition = () => {
    setFeedbackError("");
    setFeedbackState("");
    if (requiresReason && notes.trim().length < 8) {
      setFeedbackError("Record at least 8 characters of investigation reasoning for this terminal disposition.");
      return;
    }
    setPendingDisposition(proposedStatus);
  };

  const saveDisposition = async () => {
    if (!pendingDisposition || !onDisposition) return;
    setSubmitting(true);
    setFeedbackError("");
    setFeedbackState("");
    try {
      const saved = await onDisposition(pendingDisposition, notes.trim());
      if (!saved) return;
      setFeedbackHistory((history) => [...history, saved]);
      setFeedbackState(`Saved as ${displayStatus(saved.status)}. The decision was added to immutable feedback history.`);
      setPendingDisposition(null);
      setNotes("");
    } catch (reason) {
      setFeedbackError(reason instanceof Error ? reason.message : "Could not save analyst feedback.");
    } finally {
      setSubmitting(false);
    }
  };

  const panelId = `alert-investigation-${instanceId}-panel`;
  const baseId = `alert-investigation-${instanceId}`;
  const stageBaseId = `alert-explanation-${instanceId}`;
  const stagePanelId = `${stageBaseId}-panel`;

  return <div className="drawer-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div ref={dialogRef} className="drawer investigation-drawer" role="dialog" aria-modal="true" aria-labelledby={`alert-title-${instanceId}`} aria-describedby={`alert-scope-${instanceId}`}>
      <header className="drawer-header investigation-header">
        <div>
          <div className="investigation-header-meta"><SeverityLabel severity={alert.severity} /><span className={`status-text status-text--${alert.status}`}>{displayStatus(alert.status)}</span></div>
          <h2 id={`alert-title-${instanceId}`}>{alert.attack_type}</h2>
          <p id={`alert-scope-${instanceId}`}>{alert.id} · observed <time dateTime={alert.timestamp}>{new Date(alert.timestamp).toLocaleString()}</time></p>
        </div>
        <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Close alert details"><X aria-hidden="true" /></button>
      </header>

      <TabList
        baseId={baseId}
        label="Alert investigation sections"
        options={[
          { value: "triage", label: "Triage" },
          { value: "model", label: "Model evidence" },
          { value: "record", label: "Record data" },
        ]}
        panelId={panelId}
        selected={view}
        onSelect={setView}
        className="investigation-tabs"
      />

      <div id={panelId} role="tabpanel" aria-labelledby={tabId(baseId, view)}>
        {view === "triage" ? <>
          <section className="investigation-summary" aria-label="Alert decision summary">
            <div><span>Observed severity</span><strong>{alert.severity}</strong></div>
            <div><span>Current disposition</span><strong>{displayStatus(alert.status)}</strong></div>
            <div><span>Detector verdict</span><strong>{alert.binary_prediction ?? "Attack alert"}</strong></div>
            <div><span>Detector model score</span><strong>{formatScore(alert.detection_score ?? alert.confidence)}</strong></div>
          </section>

          <section className="drawer-section decision-panel" aria-labelledby={`decision-title-${instanceId}`}>
            <div className="decision-heading"><div><span className="eyebrow">Human decision</span><h3 id={`decision-title-${instanceId}`}>Record disposition</h3></div><span className={`status-text status-text--${alert.status}`}>Current: {displayStatus(alert.status)}</span></div>
            <p>Choose the next state and preserve the reasoning that another analyst would need to audit the decision.</p>
            {readOnly ? <p className="readonly-note" role="note">Fixture data is read-only. Connect the API to persist analyst feedback.</p> : <>
              <div className="decision-form">
                <label>Next disposition<select value={proposedStatus} onChange={(event) => { setProposedStatus(event.target.value as AlertStatus); setPendingDisposition(null); setFeedbackError(""); }}>{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}{option.value === alert.status ? " (current)" : ""}</option>)}</select></label>
                <label>Investigation reasoning <small>{requiresReason ? "required for this disposition" : "recommended"}</small><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={10_000} rows={3} aria-describedby={`decision-help-${instanceId}`} placeholder="Record corroborating evidence, context, or why this state is appropriate…" /></label>
                <small id={`decision-help-${instanceId}`}>Terminal decisions require at least 8 characters. The backend records the authenticated operator and timestamp.</small>
                <button type="button" className="primary-button" onClick={reviewDisposition}>Review decision</button>
              </div>
              {pendingDisposition ? <div className="decision-confirm" role="group" aria-label="Confirm analyst disposition">
                <div><strong>Change {displayStatus(alert.status)} → {displayStatus(pendingDisposition)}?</strong><span>{notes.trim() || "No additional reasoning supplied."}</span></div>
                <div className="dialog-actions"><button type="button" className="secondary-button" disabled={submitting} onClick={() => setPendingDisposition(null)}>Cancel</button><button type="button" className="primary-button" disabled={submitting} onClick={() => void saveDisposition()}>{submitting ? "Saving…" : "Confirm and record"}</button></div>
              </div> : null}
              {feedbackError ? <div className="feedback-state feedback-state--error" role="alert">{feedbackError}</div> : null}
              {feedbackState ? <div className="feedback-state feedback-state--success" role="status">{feedbackState}</div> : null}
            </>}
          </section>

          <section className="drawer-section"><h3>Observed communication</h3><div className="route-card"><span><small>Source</small><b>{alert.source_ip}</b>{alert.network_context?.source_port != null ? <em>port {alert.network_context.source_port}</em> : null}</span><ArrowRight aria-hidden="true" /><span><small>Destination</small><b>{alert.destination_ip}</b>{alert.network_context?.destination_port != null ? <em>port {alert.network_context.destination_port}</em> : null}</span></div><p>{alert.protocol} protocol{alert.identity_quality === "port_only" ? ". Only transport ports are available; these are not persistent device identities." : alert.identity_quality === "unknown" ? ". Endpoint identity is incomplete in this observation." : ". Network addresses were observed for this route."}</p></section>

          {alert.reasons?.length ? <section className="drawer-section"><h3>Severity rationale</h3><ul className="investigation-reasons">{alert.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></section> : null}

          {alert.explanations?.length ? <section className="drawer-section"><h3>Detection highlights</h3><p>{alert.evidence_type === "model_contribution" ? "Signed model contributions available with the alert record." : "Observed values highlighted by the detection pipeline; these are not model contribution scores."}</p><dl className="evidence-list">{alert.explanations.map((item) => <div className="evidence-row" key={item.feature}><dt>{item.feature}</dt><dd>{item.evidence_type === "model_contribution" ? `${item.impact >= 0 ? "+" : ""}${item.impact.toFixed(4)}` : String(item.value ?? item.impact)}</dd></div>)}</dl></section> : null}

          <section className="drawer-section"><h3>Disposition history</h3>{feedbackHistory.length ? <ol className="feedback-timeline">{[...feedbackHistory].reverse().map((item) => <li key={item.feedback_id}><span className={`status-text status-text--${item.status}`}>{displayStatus(item.status)}</span><p>{item.notes || "No investigation reasoning recorded."}</p><small>{item.analyst} · <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time></small></li>)}</ol> : <p>No analyst disposition has been recorded.</p>}</section>
        </> : null}

        {view === "model" ? <>
          <section className="drawer-section explanation-boundary" role="note"><span className="eyebrow">Interpretation boundary</span><h3>Decision support, not causal proof</h3><p>Model scores and signed SHAP impacts describe this model's output. They do not establish attacker intent, causality, or deployment-wide accuracy.</p></section>
          <section className="drawer-section"><h3>Cascade decision</h3><div className="cascade-trace"><div><span>1 · Detector</span><strong>{alert.binary_prediction ?? "attack"}</strong><small>{formatScore(alert.detection_score ?? alert.confidence)} model score</small></div><ArrowRight aria-hidden="true" /><div><span>2 · Classifier</span><strong>{alert.attack_class ?? alert.attack_type}</strong><small>{formatScore(alert.attack_class_score)} model score</small></div></div></section>
          <section className="drawer-section"><h3>Serving evidence</h3><dl className="investigation-facts"><div><dt>Detector artifact</dt><dd>{alert.detector_model_version ?? alert.model_version ?? "Not reported"}</dd></div><div><dt>Classifier artifact</dt><dd>{alert.classifier_model_version ?? "Not used or reported"}</dd></div><div><dt>Detector latency</dt><dd>{formatLatency(alert.detector_latency_ms)}</dd></div><div><dt>Classifier latency</dt><dd>{formatLatency(alert.classifier_latency_ms)}</dd></div><div><dt>Total inference latency</dt><dd>{formatLatency(alert.total_latency_ms)}</dd></div><div><dt>Score meaning</dt><dd>Model output; calibration not declared on this alert record</dd></div></dl></section>
          <section className="drawer-section" aria-labelledby={`explanation-title-${instanceId}`}><h3 id={`explanation-title-${instanceId}`}>On-demand explanation</h3>
            {explanationState === "loading" ? <div className="explanation-state" role="status">Computing explanation from the active model artifacts…</div> : null}
            {explanationState === "error" ? <div className="explanation-state explanation-state--error" role="alert"><strong>Explanation unavailable</strong><span>{explanationError || "The explanation service did not return evidence."}</span>{onRetryExplanation ? <button type="button" className="secondary-button" onClick={onRetryExplanation}>Retry explanation</button> : null}</div> : null}
            {explanationState === "empty" ? <div className="explanation-state"><strong>No explanation returned</strong><span>The alert record and analyst decision controls remain available.</span></div> : null}
            {explanations.length > 1 ? <TabList baseId={stageBaseId} label="Explanation stage" options={explanations.map((item, index) => ({ value: index, label: item.stage === "binary" || item.stage === "detector" ? "Detector" : "Classifier" }))} panelId={stagePanelId} selected={activeStage} onSelect={setActiveStage} className="explanation-tabs" /> : null}
            {current ? <div className="explanation-stage" id={explanations.length > 1 ? stagePanelId : undefined} role={explanations.length > 1 ? "tabpanel" : undefined} aria-labelledby={explanations.length > 1 ? tabId(stageBaseId, activeStage) : undefined}>
              <div className="explanation-meta"><div><span>Explained class</span><b>{current.explained_class}</b></div><div><span>Model artifact</span><b>{current.model_version}</b></div><div><span>Base → output</span><b>{current.base_value.toFixed(4)} → {current.output_value.toFixed(4)}</b></div><div><span>Units / method</span><b>{current.output_units ?? "model output"} · {current.method}</b></div></div>
              {current.calibration_scope ? <p className="sample-note">{current.calibration_scope}</p> : null}
              <div className="explanation-summary"><div><span>Strongest increase</span><strong>{strongestIncrease ? `${strongestIncrease.feature} (+${strongestIncrease.impact.toFixed(4)})` : "None reported"}</strong></div><div><span>Strongest decrease</span><strong>{strongestDecrease ? `${strongestDecrease.feature} (${strongestDecrease.impact.toFixed(4)})` : "None reported"}</strong></div><div><span>Additive check</span><strong>{reconstructedOutput == null ? "Not available" : Math.abs(reconstructedOutput - current.output_value) <= 1e-6 ? "Matches reported output" : `Differs by ${Math.abs(reconstructedOutput - current.output_value).toExponential(2)}`}</strong></div></div>
              <WaterfallChart base={current.base_value} output={current.output_value} evidence={chartEvidence} units={current.output_units ?? "model output"} labelId={`waterfall-label-${instanceId}-${activeStage}`} />
              <details className="explanation-exact" open><summary>Exact signed contributions <small>{sortedContributions.length} transformed features</small></summary><div className="investigation-table-scroll" role="region" aria-label="Exact signed feature contributions" tabIndex={0}><table className="evidence-table"><caption>All contributions ordered by absolute impact</caption><thead><tr><th scope="col">Transformed feature</th><th scope="col">Raw feature</th><th scope="col">Raw value</th><th scope="col">Transformed value</th><th scope="col">Impact</th></tr></thead><tbody>{sortedContributions.map((item, index) => <tr key={`${item.feature}-${index}`}><td>{item.feature}</td><td>{item.raw_feature ?? "Not reported"}</td><td>{String(item.raw_value ?? "Not reported")}</td><td>{String(item.transformed_value ?? "Not reported")}</td><td>{item.impact.toFixed(6)}</td></tr>)}</tbody></table></div></details>
            </div> : null}
          </section>
        </> : null}

        {view === "record" ? <>
          <section className="drawer-section"><h3>Record provenance</h3><dl className="investigation-facts"><div><dt>Alert ID</dt><dd>{alert.id}</dd></div><div><dt>Event ID</dt><dd>{alert.event_id ?? "Not reported"}</dd></div><div><dt>Observed</dt><dd><time dateTime={alert.timestamp}>{new Date(alert.timestamp).toLocaleString()}</time></dd></div><div><dt>Capture ID</dt><dd>{alert.network_context?.capture_id ?? "Not reported"}</dd></div><div><dt>Interface</dt><dd>{alert.network_context?.interface ?? "Not reported"}</dd></div><div><dt>Extractor fingerprint</dt><dd>{alert.network_context?.extractor_fingerprint ?? "Not reported"}</dd></div></dl></section>
          <section className="drawer-section"><h3>Network context</h3><dl className="investigation-facts"><div><dt>Source address</dt><dd>{alert.network_context?.source_ip ?? alert.source_ip}</dd></div><div><dt>Source port</dt><dd>{alert.network_context?.source_port ?? "Not reported"}</dd></div><div><dt>Destination address</dt><dd>{alert.network_context?.destination_ip ?? alert.destination_ip}</dd></div><div><dt>Destination port</dt><dd>{alert.network_context?.destination_port ?? "Not reported"}</dd></div><div><dt>Protocol</dt><dd>{alert.network_context?.protocol ?? alert.protocol}</dd></div><div><dt>Identity quality</dt><dd>{alert.identity_quality?.replace("_", " ") ?? "Not reported"}</dd></div></dl></section>
          <details className="drawer-disclosure" open><summary><span>Raw flow features</span><small>{Object.keys(alert.features ?? {}).length} observed values</small></summary><div className="drawer-disclosure-body"><dl className="feature-grid">{Object.entries(alert.features ?? {}).map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{value}</dd></div>)}</dl>{!Object.keys(alert.features ?? {}).length ? <p>No raw feature values were returned with this alert record.</p> : null}</div></details>
        </> : null}
      </div>
    </div>
  </div>;
}

export function AlertDrawer({ alert, onClose, onStatusChange, loadExplanation = true, readOnly = false }: {
  alert: Alert;
  onClose: () => void;
  onStatusChange: (id: string, status: AlertStatus) => void;
  loadExplanation?: boolean;
  readOnly?: boolean;
}) {
  const auth = useAuth();
  const [explanations, setExplanations] = useState<AlertExplanationStage[]>([]);
  const [explanationState, setExplanationState] = useState<ExplanationState>(loadExplanation ? "loading" : "empty");
  const [explanationError, setExplanationError] = useState("");
  const [explanationRefresh, setExplanationRefresh] = useState(0);

  useEffect(() => {
    if (!loadExplanation) {
      setExplanationState("empty");
      setExplanations([]);
      return;
    }
    let cancelled = false;
    setExplanationState("loading");
    setExplanationError("");
    setExplanations([]);
    void getAlertExplanation(alert.id)
      .then((items) => {
        if (cancelled) return;
        setExplanations(items);
        setExplanationState(items.length ? "ready" : "empty");
      })
      .catch((reason) => {
        if (cancelled) return;
        setExplanationError(reason instanceof Error ? reason.message : "The explanation service did not return evidence.");
        setExplanationState("error");
      });
    return () => { cancelled = true; };
  }, [alert.id, explanationRefresh, loadExplanation]);

  const saveDisposition = async (status: AlertStatus, notes: string): Promise<AnalystFeedback | null> => {
    if (!auth.authenticated) {
      auth.openLogin();
      return null;
    }
    if (readOnly) return null;
    const saved = await submitAlertFeedback(alert.id, { status, notes: notes || null });
    onStatusChange(alert.id, status);
    return saved;
  };

  return <AlertInvestigationView
    alert={alert}
    onClose={onClose}
    onDisposition={saveDisposition}
    explanations={explanations}
    explanationState={explanationState}
    explanationError={explanationError}
    onRetryExplanation={loadExplanation ? () => setExplanationRefresh((value) => value + 1) : undefined}
    readOnly={readOnly}
  />;
}
