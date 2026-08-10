import { type Ref, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getIngestionEvent, getIngestionJobs, getOutboxEvents, redriveIngestionJobs } from "../../api";
import { useAuth } from "../../auth";
import { PanelHeading } from "../../components/PanelHeading";
import { TabList, tabId } from "../../components/TabList";
import type { CursorPage, IngestionJob, IngestionJobDetail, OutboxEvent } from "../../types";

type OperationsTab = "jobs" | "outbox";

function displayTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

function State({ value }: { value: string }) {
  return <span className={`ops-state ops-state--${value.replaceAll("_", "-")}`}>{value.replaceAll("_", " ")}</span>;
}

function deliveryTiming(item: OutboxEvent) {
  if (item.status === "published") return "Complete";
  if (item.claimed) return `Delivering · lease expires ${displayTime(item.claim_expires_at)}`;
  if (item.next_attempt_at) return `Retry scheduled ${displayTime(item.next_attempt_at)}`;
  return "Ready for delivery";
}

export function IngestionOperations({ fixtureMode, refreshKey }: { fixtureMode: boolean; refreshKey?: string }) {
  const auth = useAuth();
  const [tab, setTab] = useState<OperationsTab>("jobs");
  const [jobPage, setJobPage] = useState<CursorPage<IngestionJob> | null>(null);
  const [outboxPage, setOutboxPage] = useState<CursorPage<OutboxEvent> | null>(null);
  const [stateFilter, setStateFilter] = useState("");
  const [errorFilter, setErrorFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [outboxFilter, setOutboxFilter] = useState("");
  const [appliedJobs, setAppliedJobs] = useState({ state: "", error: "", source: "" });
  const [cursor, setCursor] = useState<string | undefined>();
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(!fixtureMode);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<IngestionJobDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [localRefresh, setLocalRefresh] = useState(0);
  const detailRegion = useRef<HTMLElement>(null);
  const detailTrigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (fixtureMode) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    const request = tab === "jobs"
      ? getIngestionJobs({ state: appliedJobs.state, error_code: appliedJobs.error, source: appliedJobs.source, limit: 20, cursor })
      : getOutboxEvents({ status: outboxFilter, limit: 20, cursor });
    void request.then((page) => {
      if (cancelled) return;
      if (tab === "jobs") setJobPage(page as CursorPage<IngestionJob>);
      else setOutboxPage(page as CursorPage<OutboxEvent>);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Operational evidence is unavailable.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [appliedJobs, cursor, fixtureMode, localRefresh, outboxFilter, refreshKey, tab]);

  const changeTab = (next: OperationsTab) => {
    setTab(next);
    setCursor(undefined);
    setCursorHistory([]);
    setSelected(null);
    setDetailError("");
  };

  const nextPage = (next: string | null) => {
    if (!next) return;
    setCursorHistory((current) => [...current, cursor ?? ""]);
    setCursor(next);
  };

  const previousPage = () => {
    setCursorHistory((current) => {
      const previous = current.at(-1);
      setCursor(previous || undefined);
      return current.slice(0, -1);
    });
  };

  useLayoutEffect(() => {
    if (!selected || detailLoading) return;
    detailRegion.current?.focus();
  }, [detailLoading, selected]);

  const inspectJob = async (eventId: string, rememberTrigger = true) => {
    if (rememberTrigger) {
      detailTrigger.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    }
    setDetailLoading(true);
    setDetailError("");
    try {
      setSelected(await getIngestionEvent(eventId));
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : "Job transition evidence is unavailable.");
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setSelected(null);
    setDetailError("");
    const trigger = detailTrigger.current;
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  };

  return (
    <section className="panel operations-panel" aria-label="Ingestion operations">
      <PanelHeading eyebrow="Operational evidence" title="Ingestion operations" description="Read-only evidence for durable jobs and committed event publication."/>
      {fixtureMode ? <div className="data-state" role="note">Fixture preview contains no operational queue evidence.</div> : (
        <>
          <TabList
            baseId="ingestion-evidence"
            className="stage-tabs operations-tabs"
            label="Ingestion evidence type"
            options={[{ value: "jobs", label: "Jobs" }, { value: "outbox", label: "Outbox" }]}
            panelId="ingestion-evidence-panel"
            selected={tab}
            onSelect={changeTab}
          />

          <div id="ingestion-evidence-panel" role="tabpanel" aria-labelledby={tabId("ingestion-evidence", tab)}>
          {tab === "jobs" ? (
            <form className="operations-filters" onSubmit={(event) => { event.preventDefault(); setCursor(undefined); setCursorHistory([]); setSelected(null); setAppliedJobs({ state: stateFilter, error: errorFilter.trim(), source: sourceFilter.trim() }); }}>
              <label>State<select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}><option value="">All states</option><option value="queued">Queued</option><option value="processing">Processing</option><option value="retrying">Retrying</option><option value="succeeded">Succeeded</option><option value="dead_letter">Dead letter</option></select></label>
              <label>Error code<input value={errorFilter} onChange={(event) => setErrorFilter(event.target.value)} placeholder="Any error code"/></label>
              <label>Source<input value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} placeholder="Any source"/></label>
              <button className="secondary-button" type="submit">Apply filters</button>
            </form>
          ) : (
            <div className="operations-filters operations-filters--outbox"><label>Publication state<select value={outboxFilter} onChange={(event) => { setOutboxFilter(event.target.value); setCursor(undefined); setCursorHistory([]); }}><option value="">All states</option><option value="pending">Pending</option><option value="published">Published</option><option value="failed">Failed</option></select></label></div>
          )}

          <div aria-live="polite" className="sr-only">{loading ? `Loading ${tab}` : error ? `${tab} unavailable` : `${tab} loaded`}</div>
          {loading ? <div className="data-state" role="status">Loading {tab} evidence…</div> : null}
          {error ? <div className="data-state data-state--error" role="alert">{error}</div> : null}

          {!loading && !error && tab === "jobs" && jobPage ? <>
            <div className="preview-scroll"><table><caption>Ingestion jobs · {jobPage.total.toLocaleString()} total</caption><thead><tr><th>Event</th><th>State</th><th>Source</th><th>Attempts</th><th>Error</th><th>Updated</th><th>History</th></tr></thead><tbody>{jobPage.items.map((job) => <tr key={job.event_id}><th scope="row" className="mono">{job.event_id}</th><td><State value={job.state}/></td><td>{job.source || "Not reported"}</td><td>{job.attempts}</td><td title={job.last_error ?? undefined}>{job.error_code ?? "—"}</td><td>{displayTime(job.updated_at)}</td><td><button className="text-button" type="button" onClick={() => void inspectJob(job.event_id)} aria-label={`View history for event ${job.event_id}`}>View</button></td></tr>)}</tbody></table></div>
            {!jobPage.items.length ? <div className="chart-empty">No jobs match the active filters.</div> : null}
            <Pagination previous={cursorHistory.length > 0} next={jobPage.next_cursor} onPrevious={previousPage} onNext={nextPage}/>
          </> : null}

          {!loading && !error && tab === "outbox" && outboxPage ? <>
            <div className="preview-scroll"><table><caption>Outbox delivery events · {outboxPage.total.toLocaleString()} total</caption><thead><tr><th>Outbox ID</th><th>Event</th><th>Type</th><th>Status</th><th>Delivery timing</th><th>Attempts</th><th>Created</th><th>Published</th><th>Last error</th></tr></thead><tbody>{outboxPage.items.map((item) => <tr key={item.outbox_id}><th scope="row" className="mono">{item.outbox_id}</th><td className="mono">{item.event_id}</td><td>{item.event_type}</td><td><State value={item.status}/></td><td>{deliveryTiming(item)}</td><td>{item.publish_attempts}</td><td>{displayTime(item.created_at)}</td><td>{displayTime(item.published_at)}</td><td>{item.last_error ?? "—"}</td></tr>)}</tbody></table></div>
            {!outboxPage.items.length ? <div className="chart-empty">No outbox events match the active filter.</div> : null}
            <Pagination previous={cursorHistory.length > 0} next={outboxPage.next_cursor} onPrevious={previousPage} onNext={nextPage}/>
          </> : null}

          {detailLoading ? <div className="operations-detail data-state" role="status">Loading job history…</div> : null}
          {detailError ? <div className="operations-detail data-state data-state--error" role="alert">{detailError}</div> : null}
          {selected && !detailLoading ? <JobDetail focusRef={detailRegion} job={selected} authenticated={auth.authenticated} onAuthenticate={auth.openLogin} onClose={closeDetail} onChanged={async () => { await inspectJob(selected.event_id, false); setLocalRefresh((value) => value + 1); }}/> : null}
          </div>
        </>
      )}
    </section>
  );
}

function Pagination({ previous, next, onPrevious, onNext }: { previous: boolean; next: string | null; onPrevious: () => void; onNext: (cursor: string) => void }) {
  return <nav className="pagination" aria-label="Operations pagination"><button className="secondary-button" type="button" disabled={!previous} onClick={onPrevious}>Previous</button><button className="secondary-button" type="button" disabled={!next} onClick={() => next && onNext(next)}>Next</button></nav>;
}

function JobDetail({ focusRef, job, authenticated, onAuthenticate, onClose, onChanged }: { focusRef: Ref<HTMLElement>; job: IngestionJobDetail; authenticated: boolean; onAuthenticate: () => void; onClose: () => void; onChanged: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [eligibility, setEligibility] = useState<{ eligible: boolean; reason: string } | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const confirmButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (confirming) confirmButton.current?.focus();
  }, [confirming]);
  const preview = async () => {
    if (!authenticated) { onAuthenticate(); return; }
    setWorking(true); setError(""); setConfirming(false);
    try { const result = await redriveIngestionJobs([job.event_id], reason || "eligibility preview", true); setEligibility(result.results[0] ?? null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Eligibility could not be checked."); }
    finally { setWorking(false); }
  };
  const execute = async () => {
    if (!authenticated) { onAuthenticate(); return; }
    if (!reason.trim()) { setError("An operator reason is required."); return; }
    setWorking(true); setError(""); setConfirming(false);
    try { await redriveIngestionJobs([job.event_id], reason.trim(), false); setEligibility(null); setReason(""); await onChanged(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Redrive was refused."); }
    finally { setWorking(false); }
  };
  return <section ref={focusRef} tabIndex={-1} className="operations-detail" aria-label={`Job history for ${job.event_id}`}><div className="operations-detail-heading"><div><span className="eyebrow">Job transition history</span><h3 className="mono">{job.event_id}</h3></div><button className="secondary-button" type="button" onClick={onClose}>Close history</button></div><dl className="operations-detail-facts"><div><dt>Batch</dt><dd className="mono">{job.batch_id}</dd></div><div><dt>Schema</dt><dd>{job.schema_version}</dd></div><div><dt>Extractor</dt><dd className="mono">{job.extractor_fingerprint ?? "Not reported"}</dd></div><div><dt>Redrives</dt><dd>{job.redrive_count}</dd></div></dl>{job.state === "dead_letter" ? <div className="redrive-controls"><h4>Manual redrive</h4><p>Eligibility is checked against the immutable payload, persisted results, lease state, and active model route.</p><label>Operator reason<textarea value={reason} onChange={(event) => { setReason(event.target.value); setConfirming(false); }} rows={3} maxLength={1000}/></label><div className="dialog-actions"><button type="button" className="secondary-button" disabled={working} onClick={() => void preview()}>{authenticated ? "Check eligibility" : "Sign in to check eligibility"}</button><button className="primary-button" type="button" disabled={working || eligibility?.eligible !== true || !reason.trim()} onClick={() => setConfirming(true)}>Review redrive</button></div>{eligibility ? <div className={`data-state ${eligibility.eligible ? "" : "data-state--error"}`} role="status">{eligibility.eligible ? "Eligible for transactional redrive." : `Redrive refused: ${eligibility.reason}`}</div> : null}{confirming ? <div className="redrive-confirm" role="region" aria-labelledby="redrive-confirm-title"><h5 id="redrive-confirm-title">Confirm manual redrive</h5><p>This will queue <span className="mono">{job.event_id}</span> for another processing attempt.</p><dl><dt>Audit reason</dt><dd>{reason.trim()}</dd></dl><div className="dialog-actions"><button className="secondary-button" type="button" disabled={working} onClick={() => setConfirming(false)}>Cancel</button><button ref={confirmButton} className="primary-button" type="button" disabled={working} onClick={() => void execute()}>Confirm redrive</button></div></div> : null}{error ? <div className="data-state data-state--error" role="alert">{error}</div> : null}</div> : null}<div className="preview-scroll"><table><caption>Immutable state transitions</caption><thead><tr><th>Time</th><th>From</th><th>To</th><th>Action</th><th>Attempt</th><th>Actor</th><th>Error</th><th>Reason</th></tr></thead><tbody>{job.transitions.map((transition) => <tr key={transition.transition_id}><td>{displayTime(transition.created_at)}</td><td>{transition.from_state ?? "Created"}</td><td><State value={transition.to_state}/></td><td>{transition.action}</td><td>{transition.attempt}</td><td>{transition.actor}</td><td>{transition.error_code ?? "—"}</td><td>{transition.reason ?? "—"}</td></tr>)}</tbody></table></div>{!job.transitions.length ? <div className="chart-empty">No transition records were returned.</div> : null}</section>;
}
