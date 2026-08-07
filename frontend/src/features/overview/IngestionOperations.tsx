import { useEffect, useState } from "react";
import { getIngestionEvent, getIngestionJobs, getOutboxEvents } from "../../api";
import { PanelHeading } from "../../components/PanelHeading";
import type { CursorPage, IngestionJob, IngestionJobDetail, OutboxEvent } from "../../types";

type OperationsTab = "jobs" | "outbox";

function displayTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

function State({ value }: { value: string }) {
  return <span className={`ops-state ops-state--${value.replaceAll("_", "-")}`}>{value.replaceAll("_", " ")}</span>;
}

export function IngestionOperations({ fixtureMode, refreshKey }: { fixtureMode: boolean; refreshKey?: string }) {
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
  }, [appliedJobs, cursor, fixtureMode, outboxFilter, refreshKey, tab]);

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

  const inspectJob = async (eventId: string) => {
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

  return (
    <section className="panel operations-panel" aria-label="Ingestion operations">
      <PanelHeading eyebrow="Operational evidence" title="Ingestion operations" description="Read-only evidence for durable jobs and committed event publication."/>
      {fixtureMode ? <div className="data-state" role="note">Fixture preview contains no operational queue evidence.</div> : (
        <>
          <div className="stage-tabs operations-tabs" role="tablist" aria-label="Ingestion evidence type">
            <button role="tab" aria-selected={tab === "jobs"} onClick={() => changeTab("jobs")}>Jobs</button>
            <button role="tab" aria-selected={tab === "outbox"} onClick={() => changeTab("outbox")}>Outbox</button>
          </div>

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
            <div className="preview-scroll"><table><caption>Outbox delivery events · {outboxPage.total.toLocaleString()} total</caption><thead><tr><th>Outbox ID</th><th>Event</th><th>Type</th><th>Status</th><th>Attempts</th><th>Created</th><th>Published</th><th>Last error</th></tr></thead><tbody>{outboxPage.items.map((item) => <tr key={item.outbox_id}><th scope="row" className="mono">{item.outbox_id}</th><td className="mono">{item.event_id}</td><td>{item.event_type}</td><td><State value={item.status}/></td><td>{item.publish_attempts}</td><td>{displayTime(item.created_at)}</td><td>{displayTime(item.published_at)}</td><td>{item.last_error ?? "—"}</td></tr>)}</tbody></table></div>
            {!outboxPage.items.length ? <div className="chart-empty">No outbox events match the active filter.</div> : null}
            <Pagination previous={cursorHistory.length > 0} next={outboxPage.next_cursor} onPrevious={previousPage} onNext={nextPage}/>
          </> : null}

          {detailLoading ? <div className="operations-detail data-state" role="status">Loading job history…</div> : null}
          {detailError ? <div className="operations-detail data-state data-state--error" role="alert">{detailError}</div> : null}
          {selected && !detailLoading ? <JobDetail job={selected} onClose={() => setSelected(null)}/> : null}
        </>
      )}
    </section>
  );
}

function Pagination({ previous, next, onPrevious, onNext }: { previous: boolean; next: string | null; onPrevious: () => void; onNext: (cursor: string) => void }) {
  return <nav className="pagination" aria-label="Operations pagination"><button className="secondary-button" type="button" disabled={!previous} onClick={onPrevious}>Previous</button><button className="secondary-button" type="button" disabled={!next} onClick={() => next && onNext(next)}>Next</button></nav>;
}

function JobDetail({ job, onClose }: { job: IngestionJobDetail; onClose: () => void }) {
  return <section className="operations-detail" aria-label={`Job history for ${job.event_id}`}><div className="operations-detail-heading"><div><span className="eyebrow">Job transition history</span><h3 className="mono">{job.event_id}</h3></div><button className="secondary-button" type="button" onClick={onClose}>Close history</button></div><dl className="operations-detail-facts"><div><dt>Batch</dt><dd className="mono">{job.batch_id}</dd></div><div><dt>Schema</dt><dd>{job.schema_version}</dd></div><div><dt>Extractor</dt><dd className="mono">{job.extractor_fingerprint ?? "Not reported"}</dd></div><div><dt>Redrives</dt><dd>{job.redrive_count}</dd></div></dl><div className="preview-scroll"><table><caption>Immutable state transitions</caption><thead><tr><th>Time</th><th>From</th><th>To</th><th>Action</th><th>Attempt</th><th>Actor</th><th>Error</th><th>Reason</th></tr></thead><tbody>{job.transitions.map((transition) => <tr key={transition.transition_id}><td>{displayTime(transition.created_at)}</td><td>{transition.from_state ?? "Created"}</td><td><State value={transition.to_state}/></td><td>{transition.action}</td><td>{transition.attempt}</td><td>{transition.actor}</td><td>{transition.error_code ?? "—"}</td><td>{transition.reason ?? "—"}</td></tr>)}</tbody></table></div>{!job.transitions.length ? <div className="chart-empty">No transition records were returned.</div> : null}</section>;
}
