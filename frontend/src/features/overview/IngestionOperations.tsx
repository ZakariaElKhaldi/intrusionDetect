import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getIngestionEvent, getIngestionJobs, getOutboxEvents, redriveIngestionJobs } from "../../api";
import { useAuth } from "../../auth";
import { PanelHeading } from "../../components/PanelHeading";
import { TabList, tabId } from "../../components/TabList";
import type { CursorPage, IngestionJob, IngestionJobDetail, OutboxEvent } from "../../types";
import {
  emptyJobFilters,
  emptyOutboxFilters,
  JobOperationsFilters,
  OutboxOperationsFilters,
  type JobFilterValues,
  type OutboxFilterValues,
} from "./IngestionOperationsFilters";
import { IngestionJobDetailView, IngestionJobsView, OutboxEventsView } from "./IngestionOperationsView";

type OperationsTab = "jobs" | "outbox";

function toIso(value: string) {
  return value ? new Date(value).toISOString() : "";
}

export function IngestionOperations({ fixtureMode, refreshKey }: { fixtureMode: boolean; refreshKey?: string }) {
  const auth = useAuth();
  const [tab, setTab] = useState<OperationsTab>("jobs");
  const [jobPage, setJobPage] = useState<CursorPage<IngestionJob> | null>(null);
  const [outboxPage, setOutboxPage] = useState<CursorPage<OutboxEvent> | null>(null);
  const [appliedJobs, setAppliedJobs] = useState<JobFilterValues>({ ...emptyJobFilters });
  const [appliedOutbox, setAppliedOutbox] = useState<OutboxFilterValues>({ ...emptyOutboxFilters });
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
      ? getIngestionJobs({ state: appliedJobs.state, error_code: appliedJobs.error, source: appliedJobs.source, created_from: toIso(appliedJobs.createdFrom), created_to: toIso(appliedJobs.createdTo), limit: 20, cursor })
      : getOutboxEvents({ status: appliedOutbox.status, event_type: appliedOutbox.eventType, limit: 20, cursor });
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
  }, [appliedJobs, appliedOutbox, cursor, fixtureMode, localRefresh, refreshKey, tab]);

  const applyJobFilters = (filters: JobFilterValues) => {
    setAppliedJobs(filters); setCursor(undefined); setCursorHistory([]); setSelected(null);
  };

  const applyOutboxFilters = (filters: OutboxFilterValues) => {
    setAppliedOutbox(filters); setCursor(undefined); setCursorHistory([]); setSelected(null);
  };

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
      <PanelHeading eyebrow="Operational evidence" title="Ingestion operations" description="Investigate durable jobs and committed publication. Authenticated operators can safely redrive eligible dead letters after review."/>
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
            <JobOperationsFilters applied={appliedJobs} onApply={applyJobFilters} />
          ) : (
            <OutboxOperationsFilters applied={appliedOutbox} onApply={applyOutboxFilters} />
          )}

          <div aria-live="polite" className="sr-only">{loading ? `Loading ${tab}` : error ? `${tab} unavailable` : `${tab} loaded`}</div>
          {loading ? <div className="data-state" role="status">Loading {tab} evidence…</div> : null}
          {error ? <div className="data-state data-state--error" role="alert">{error}</div> : null}

          {detailLoading ? <div className="operations-detail data-state" role="status">Loading job history…</div> : null}
          {detailError ? <div className="operations-detail data-state data-state--error" role="alert">{detailError}</div> : null}
          {selected && !detailLoading ? <IngestionJobDetailView focusRef={detailRegion} job={selected} authenticated={auth.authenticated} onAuthenticate={auth.openLogin} onClose={closeDetail} previewRedrive={async (eventId, reason) => (await redriveIngestionJobs([eventId], reason, true)).results[0] ?? null} executeRedrive={async (eventId, reason) => { await redriveIngestionJobs([eventId], reason, false); }} onChanged={async () => { await inspectJob(selected.event_id, false); setLocalRefresh((value) => value + 1); }}/> : null}

          {!loading && !error && tab === "jobs" && jobPage ? <IngestionJobsView page={jobPage} previous={cursorHistory.length > 0} onInspect={(eventId) => void inspectJob(eventId)} onPrevious={previousPage} onNext={nextPage}/> : null}

          {!loading && !error && tab === "outbox" && outboxPage ? <OutboxEventsView page={outboxPage} previous={cursorHistory.length > 0} onPrevious={previousPage} onNext={nextPage}/> : null}
          </div>
        </>
      )}
    </section>
  );
}
