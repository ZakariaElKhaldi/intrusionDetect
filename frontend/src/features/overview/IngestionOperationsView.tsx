import { type Ref, useLayoutEffect, useRef, useState } from "react";
import type {
  CursorPage,
  IngestionJob,
  IngestionJobDetail,
  IngestionTransition,
  OutboxEvent,
  RedriveResult,
} from "../../types";

export function displayOperationsTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

export function OperationsState({ value }: { value: string }) {
  return <span className={`ops-state ops-state--${value.replaceAll("_", "-")}`}>{value.replaceAll("_", " ")}</span>;
}

function jobTiming(job: IngestionJob) {
  if (job.state === "processing") return job.lease_expires_at ? `Lease expires ${displayOperationsTime(job.lease_expires_at)}` : "Processing lease not reported";
  if (job.state === "retrying") return `Available ${displayOperationsTime(job.available_at)}`;
  if (job.state === "succeeded") return `Completed ${displayOperationsTime(job.completed_at)}`;
  if (job.state === "queued") return `Available ${displayOperationsTime(job.available_at)}`;
  return "Held for operator review";
}

function deliveryTiming(item: OutboxEvent) {
  if (item.status === "published") return `Published ${displayOperationsTime(item.published_at)}`;
  if (item.claimed) return `Delivering · lease expires ${displayOperationsTime(item.claim_expires_at)}`;
  if (item.next_attempt_at) return `Retry scheduled ${displayOperationsTime(item.next_attempt_at)}`;
  return "Ready for delivery";
}

function PageSummary({ label, values }: { label: string; values: { term: string; value: number; note: string; tone?: "attention" }[] }) {
  return <section className="operations-summary" aria-label={label}><dl>{values.map((item) => <div className={item.tone ? "operations-summary--attention" : undefined} key={item.term}><dt>{item.term}</dt><dd>{item.value.toLocaleString()}</dd><dd className="operations-summary-note">{item.note}</dd></div>)}</dl></section>;
}

export function OperationsPagination({ previous, next, onPrevious, onNext }: { previous: boolean; next: string | null; onPrevious: () => void; onNext: (cursor: string) => void }) {
  return <nav className="pagination" aria-label="Operations pagination"><button className="secondary-button" type="button" disabled={!previous} onClick={onPrevious}>Previous</button><button className="secondary-button" type="button" disabled={!next} onClick={() => next && onNext(next)}>Next</button></nav>;
}

export function IngestionJobsView({ page, previous = false, onInspect, onPrevious = () => undefined, onNext = () => undefined }: { page: CursorPage<IngestionJob>; previous?: boolean; onInspect: (eventId: string) => void; onPrevious?: () => void; onNext?: (cursor: string) => void }) {
  const attention = page.items.filter((job) => job.state === "retrying" || job.state === "dead_letter").length;
  const active = page.items.filter((job) => job.state === "queued" || job.state === "processing").length;
  return <section className="operations-results" aria-labelledby="job-queue-title">
    <header className="operations-results-heading"><div><span className="eyebrow">Durable processing</span><h3 id="job-queue-title">Job queue</h3></div><p><b>{page.items.length.toLocaleString()}</b> shown of <b>{page.total.toLocaleString()}</b> matching</p></header>
    <PageSummary label="Current job page summary" values={[
      { term: "Needs attention", value: attention, note: "Retrying or dead-letter on this page", tone: attention ? "attention" : undefined },
      { term: "Active", value: active, note: "Queued or processing on this page" },
      { term: "Succeeded", value: page.items.filter((job) => job.state === "succeeded").length, note: "Completed on this page" },
      { term: "Matching total", value: page.total, note: "Across all result pages" },
    ]}/>
    {page.items.length ? <>
      <div className="preview-scroll operations-table-view" role="region" aria-label="Scrollable ingestion jobs table" tabIndex={0}><table><caption>Ingestion jobs · {page.total.toLocaleString()} matching</caption><thead><tr><th scope="col">Event</th><th scope="col">State</th><th scope="col">Queue timing</th><th scope="col">Source</th><th scope="col">Attempts</th><th scope="col">Error</th><th scope="col">Updated</th><th scope="col">History</th></tr></thead><tbody>{page.items.map((job) => <tr key={job.event_id}><th scope="row" className="mono">{job.event_id}</th><td><OperationsState value={job.state}/></td><td>{jobTiming(job)}</td><td>{job.source || "Not reported"}</td><td>{job.attempts}</td><td title={job.last_error ?? undefined}>{job.error_code ?? "—"}</td><td>{displayOperationsTime(job.updated_at)}</td><td><button className="text-button" type="button" onClick={() => onInspect(job.event_id)} aria-label={`View history for event ${job.event_id}`}>Inspect</button></td></tr>)}</tbody></table></div>
      <ul className="operations-card-list" aria-label="Ingestion jobs">{page.items.map((job) => <li key={job.event_id}><div className="operations-card-heading"><strong className="mono">{job.event_id}</strong><OperationsState value={job.state}/></div><p>{jobTiming(job)}</p><dl><div><dt>Source</dt><dd>{job.source || "Not reported"}</dd></div><div><dt>Attempts</dt><dd>{job.attempts}</dd></div><div><dt>Error</dt><dd>{job.error_code ?? "—"}</dd></div><div><dt>Updated</dt><dd>{displayOperationsTime(job.updated_at)}</dd></div></dl><button className="secondary-button" type="button" onClick={() => onInspect(job.event_id)} aria-label={`View history for event ${job.event_id}`}>Inspect history</button></li>)}</ul>
    </> : <div className="chart-empty">No jobs match the active filters.</div>}
    <OperationsPagination previous={previous} next={page.next_cursor} onPrevious={onPrevious} onNext={onNext}/>
  </section>;
}

export function OutboxEventsView({ page, previous = false, onPrevious = () => undefined, onNext = () => undefined }: { page: CursorPage<OutboxEvent>; previous?: boolean; onPrevious?: () => void; onNext?: (cursor: string) => void }) {
  const delayed = page.items.filter((item) => item.status === "failed" || (item.status === "pending" && Boolean(item.next_attempt_at))).length;
  return <section className="operations-results" aria-labelledby="outbox-title">
    <header className="operations-results-heading"><div><span className="eyebrow">Committed publication</span><h3 id="outbox-title">Transactional outbox</h3></div><p><b>{page.items.length.toLocaleString()}</b> shown of <b>{page.total.toLocaleString()}</b> matching</p></header>
    <PageSummary label="Current outbox page summary" values={[
      { term: "Delayed / failed", value: delayed, note: "Failed or retry-scheduled on this page", tone: delayed ? "attention" : undefined },
      { term: "Delivering", value: page.items.filter((item) => item.claimed).length, note: "Active delivery leases on this page" },
      { term: "Published", value: page.items.filter((item) => item.status === "published").length, note: "Delivered on this page" },
      { term: "Matching total", value: page.total, note: "Across all result pages" },
    ]}/>
    {page.items.length ? <>
      <div className="preview-scroll operations-table-view" role="region" aria-label="Scrollable outbox delivery table" tabIndex={0}><table><caption>Outbox delivery events · {page.total.toLocaleString()} matching</caption><thead><tr><th scope="col">Outbox ID</th><th scope="col">Event</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Delivery timing</th><th scope="col">Attempts</th><th scope="col">Created</th><th scope="col">Last error</th></tr></thead><tbody>{page.items.map((item) => <tr key={item.outbox_id}><th scope="row" className="mono">{item.outbox_id}</th><td className="mono">{item.event_id}</td><td>{item.event_type}</td><td><OperationsState value={item.status}/></td><td>{deliveryTiming(item)}</td><td>{item.publish_attempts}</td><td>{displayOperationsTime(item.created_at)}</td><td>{item.last_error ?? "—"}</td></tr>)}</tbody></table></div>
      <ul className="operations-card-list" aria-label="Outbox delivery events">{page.items.map((item) => <li key={item.outbox_id}><div className="operations-card-heading"><strong className="mono">{item.outbox_id}</strong><OperationsState value={item.status}/></div><p>{deliveryTiming(item)}</p><dl><div><dt>Event</dt><dd className="mono">{item.event_id}</dd></div><div><dt>Type</dt><dd>{item.event_type}</dd></div><div><dt>Attempts</dt><dd>{item.publish_attempts}</dd></div><div><dt>Last error</dt><dd>{item.last_error ?? "—"}</dd></div></dl></li>)}</ul>
    </> : <div className="chart-empty">No outbox events match the active filters.</div>}
    <OperationsPagination previous={previous} next={page.next_cursor} onPrevious={onPrevious} onNext={onNext}/>
  </section>;
}

function transitionIdentity(transition: IngestionTransition) {
  return transition.operator ?? transition.worker_id ?? transition.actor ?? "System";
}

function TransitionEvidence({ transition }: { transition: IngestionTransition }) {
  const hasDetails = Object.keys(transition.details).length > 0;
  return <details className="transition-evidence"><summary>Full evidence</summary><dl><div><dt>Transition ID</dt><dd className="mono">{transition.transition_id}</dd></div><div><dt>Recorded</dt><dd>{displayOperationsTime(transition.created_at)}</dd></div><div><dt>Reason code</dt><dd>{transition.reason_code || "—"}</dd></div><div><dt>Retryable</dt><dd>{transition.retryable == null ? "Not reported" : transition.retryable ? "Yes" : "No"}</dd></div><div><dt>Worker</dt><dd>{transition.worker_id ?? "—"}</dd></div><div><dt>Operator</dt><dd>{transition.operator ?? "—"}</dd></div></dl>{hasDetails ? <pre>{JSON.stringify(transition.details, null, 2)}</pre> : <p>No structured details recorded.</p>}</details>;
}

export interface IngestionJobDetailProps {
  focusRef?: Ref<HTMLElement>;
  job: IngestionJobDetail;
  authenticated: boolean;
  onAuthenticate: () => void;
  onClose: () => void;
  onChanged: () => Promise<void>;
  previewRedrive: (eventId: string, reason: string) => Promise<RedriveResult | null>;
  executeRedrive: (eventId: string, reason: string) => Promise<void>;
}

export function IngestionJobDetailView({ focusRef, job, authenticated, onAuthenticate, onClose, onChanged, previewRedrive, executeRedrive }: IngestionJobDetailProps) {
  const [reason, setReason] = useState("");
  const [eligibility, setEligibility] = useState<RedriveResult | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const confirmButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { if (confirming) confirmButton.current?.focus(); }, [confirming]);
  const preview = async () => {
    if (!authenticated) { onAuthenticate(); return; }
    if (reason.trim().length < 3) { setError("Add an operator reason of at least 3 characters before checking eligibility."); return; }
    setWorking(true); setError(""); setConfirming(false);
    try { setEligibility(await previewRedrive(job.event_id, reason.trim())); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Eligibility could not be checked."); }
    finally { setWorking(false); }
  };
  const execute = async () => {
    if (!authenticated) { onAuthenticate(); return; }
    if (reason.trim().length < 3) { setError("An operator reason of at least 3 characters is required."); return; }
    setWorking(true); setError(""); setConfirming(false);
    try { await executeRedrive(job.event_id, reason.trim()); setEligibility(null); setReason(""); await onChanged(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Redrive was refused."); }
    finally { setWorking(false); }
  };
  return <section ref={focusRef} tabIndex={-1} className="operations-detail" aria-label={`Job history for ${job.event_id}`}>
    <div className="operations-detail-heading"><div><span className="eyebrow">Job investigation</span><h3 className="mono">{job.event_id}</h3><p><OperationsState value={job.state}/> <span>{jobTiming(job)}</span></p></div><button className="secondary-button" type="button" onClick={onClose}>Close history</button></div>
    <dl className="operations-detail-facts"><div><dt>Batch</dt><dd className="mono">{job.batch_id}</dd></div><div><dt>Source</dt><dd>{job.source || "Not reported"}</dd></div><div><dt>Schema</dt><dd>{job.schema_version}</dd></div><div><dt>Model route</dt><dd className="mono">{job.model_version ?? "Not assigned"}</dd></div><div><dt>Extractor</dt><dd className="mono">{job.extractor_fingerprint ?? "Not reported"}</dd></div><div><dt>Attempts</dt><dd>{job.attempts}</dd></div><div><dt>Retryable</dt><dd>{job.retryable == null ? "Not reported" : job.retryable ? "Yes" : "No"}</dd></div><div><dt>Redrives</dt><dd>{job.redrive_count}</dd></div></dl>
    {job.redrive_count > 0 ? <section className="redrive-audit" aria-labelledby="redrive-audit-title"><div><span className="eyebrow">Last recovery action</span><h4 id="redrive-audit-title">Redriven by {job.last_redriven_by ?? "unknown operator"}</h4></div><dl><div><dt>When</dt><dd>{displayOperationsTime(job.last_redriven_at)}</dd></div><div><dt>Audit reason</dt><dd>{job.last_redrive_reason ?? "Not recorded"}</dd></div></dl></section> : null}
    {job.state === "dead_letter" ? <div className="redrive-controls"><span className="eyebrow">Controlled recovery</span><h4>Manual redrive</h4><p>First run a read-only compatibility check. Execution queues one new processing attempt and preserves this audit trail.</p><label>Operator reason<textarea value={reason} onChange={(event) => { setReason(event.target.value); setEligibility(null); setConfirming(false); }} rows={3} minLength={3} maxLength={1000} aria-describedby="redrive-reason-help"/></label><small id="redrive-reason-help">Required for both eligibility review and the immutable operator audit.</small><div className="dialog-actions"><button type="button" className="secondary-button" disabled={working} onClick={() => void preview()}>{authenticated ? "Check eligibility" : "Sign in to check eligibility"}</button><button className="primary-button" type="button" disabled={working || eligibility?.eligible !== true || reason.trim().length < 3} onClick={() => setConfirming(true)}>Review redrive</button></div>{eligibility ? <div className={`data-state ${eligibility.eligible ? "" : "data-state--error"}`} role="status">{eligibility.eligible ? "Eligible for transactional redrive." : `Redrive refused: ${eligibility.reason}`}</div> : null}{confirming ? <div className="redrive-confirm" role="region" aria-labelledby="redrive-confirm-title"><h5 id="redrive-confirm-title">Confirm manual redrive</h5><p>This will queue <span className="mono">{job.event_id}</span> for another processing attempt.</p><dl><dt>Audit reason</dt><dd>{reason.trim()}</dd></dl><div className="dialog-actions"><button className="secondary-button" type="button" disabled={working} onClick={() => setConfirming(false)}>Cancel</button><button ref={confirmButton} className="primary-button" type="button" disabled={working} onClick={() => void execute()}>Confirm redrive</button></div></div> : null}{error ? <div className="data-state data-state--error" role="alert">{error}</div> : null}</div> : null}
    <section className="transition-ledger" aria-labelledby="transition-ledger-title"><header><div><span className="eyebrow">Immutable audit trail</span><h4 id="transition-ledger-title">State transitions</h4></div><p>{job.transitions.length} recorded</p></header>{job.transitions.length ? <><div className="preview-scroll operations-table-view" role="region" aria-label="Scrollable immutable state transitions table" tabIndex={0}><table><caption>Immutable state transitions</caption><thead><tr><th scope="col">Occurred</th><th scope="col">Route</th><th scope="col">Action</th><th scope="col">Attempt</th><th scope="col">Actor</th><th scope="col">Error / reason</th><th scope="col">Evidence</th></tr></thead><tbody>{job.transitions.map((transition) => <tr key={transition.transition_id}><td>{displayOperationsTime(transition.occurred_at)}</td><td>{transition.from_state ?? "Created"} → <OperationsState value={transition.to_state}/></td><td>{transition.action}</td><td>{transition.attempt ?? "—"}</td><td>{transitionIdentity(transition)}</td><td>{transition.error_code ?? transition.reason ?? "—"}</td><td><TransitionEvidence transition={transition}/></td></tr>)}</tbody></table></div><ol className="operations-card-list transition-card-list">{job.transitions.map((transition) => <li key={transition.transition_id}><div className="operations-card-heading"><strong>{transition.action}</strong><OperationsState value={transition.to_state}/></div><p>{displayOperationsTime(transition.occurred_at)} · {transition.from_state ?? "Created"} → {transition.to_state.replaceAll("_", " ")}</p><dl><div><dt>Attempt</dt><dd>{transition.attempt ?? "—"}</dd></div><div><dt>Actor</dt><dd>{transitionIdentity(transition)}</dd></div><div><dt>Error</dt><dd>{transition.error_code ?? "—"}</dd></div><div><dt>Reason</dt><dd>{transition.reason ?? "—"}</dd></div></dl><TransitionEvidence transition={transition}/></li>)}</ol></> : <div className="chart-empty">No transition records were returned.</div>}</section>
  </section>;
}
