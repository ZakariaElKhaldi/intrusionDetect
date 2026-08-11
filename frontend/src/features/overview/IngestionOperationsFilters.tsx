import { useState } from "react";

export interface JobFilterValues {
  state: string;
  error: string;
  source: string;
  createdFrom: string;
  createdTo: string;
}

export interface OutboxFilterValues {
  status: string;
  eventType: string;
}

export const emptyJobFilters: JobFilterValues = { state: "", error: "", source: "", createdFrom: "", createdTo: "" };
export const emptyOutboxFilters: OutboxFilterValues = { status: "", eventType: "" };

function localTime(value: string) {
  return value ? new Date(value).toLocaleString() : "";
}

function JobScope({ filters }: { filters: JobFilterValues }) {
  const items = [
    filters.state ? `state: ${filters.state.replaceAll("_", " ")}` : "",
    filters.error ? `error: ${filters.error}` : "",
    filters.source ? `source: ${filters.source}` : "",
    filters.createdFrom ? `from ${localTime(filters.createdFrom)}` : "",
    filters.createdTo ? `until ${localTime(filters.createdTo)}` : "",
  ].filter(Boolean);
  return <span>{items.length ? items.join(" · ") : "All jobs"}</span>;
}

export function JobOperationsFilters({ applied, onApply }: { applied: JobFilterValues; onApply: (filters: JobFilterValues) => void }) {
  const [draft, setDraft] = useState(applied);
  const [validationError, setValidationError] = useState("");
  const update = (key: keyof JobFilterValues, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  const apply = () => {
    if (draft.createdFrom && draft.createdTo && Date.parse(draft.createdFrom) >= Date.parse(draft.createdTo)) {
      setValidationError("Created after must be earlier than created before.");
      return;
    }
    setValidationError("");
    onApply({ ...draft, error: draft.error.trim(), source: draft.source.trim() });
  };

  const clear = () => {
    const next = { ...emptyJobFilters };
    setDraft(next);
    setValidationError("");
    onApply(next);
  };

  return (
    <form className="operations-filter-panel" onSubmit={(event) => { event.preventDefault(); apply(); }}>
      <fieldset>
        <legend>Filter ingestion jobs</legend>
        <div className="operations-filter-fields operations-filter-fields--jobs">
          <label>State<select value={draft.state} onChange={(event) => update("state", event.target.value)}><option value="">All states</option><option value="queued">Queued</option><option value="processing">Processing</option><option value="retrying">Retrying</option><option value="succeeded">Succeeded</option><option value="dead_letter">Dead letter</option></select></label>
          <label>Error code<input value={draft.error} onChange={(event) => update("error", event.target.value)} placeholder="For example, schema_rejected" /></label>
          <label>Source<input value={draft.source} onChange={(event) => update("source", event.target.value)} placeholder="For example, dashboard-upload" /></label>
          <label>Created after <small>Local time</small><input type="datetime-local" value={draft.createdFrom} onChange={(event) => update("createdFrom", event.target.value)} /></label>
          <label>Created before <small>Local time</small><input type="datetime-local" value={draft.createdTo} onChange={(event) => update("createdTo", event.target.value)} /></label>
        </div>
      </fieldset>
      {validationError ? <div className="operations-filter-error" role="alert">{validationError}</div> : null}
      <div className="operations-filter-footer">
        <p aria-live="polite"><b>Active scope</b><JobScope filters={applied} /></p>
        <div><button className="text-button" type="button" onClick={clear}>Clear filters</button><button className="secondary-button" type="submit">Apply filters</button></div>
      </div>
    </form>
  );
}

function OutboxScope({ filters }: { filters: OutboxFilterValues }) {
  const items = [filters.status ? `state: ${filters.status}` : "", filters.eventType ? `type: ${filters.eventType}` : ""].filter(Boolean);
  return <span>{items.length ? items.join(" · ") : "All publication events"}</span>;
}

export function OutboxOperationsFilters({ applied, onApply }: { applied: OutboxFilterValues; onApply: (filters: OutboxFilterValues) => void }) {
  const [draft, setDraft] = useState(applied);
  const update = (key: keyof OutboxFilterValues, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const apply = () => onApply({ ...draft, eventType: draft.eventType.trim() });
  const clear = () => { const next = { ...emptyOutboxFilters }; setDraft(next); onApply(next); };

  return (
    <form className="operations-filter-panel" onSubmit={(event) => { event.preventDefault(); apply(); }}>
      <fieldset>
        <legend>Filter publication events</legend>
        <div className="operations-filter-fields operations-filter-fields--outbox">
          <label>Publication state<select value={draft.status} onChange={(event) => update("status", event.target.value)}><option value="">All states</option><option value="pending">Pending</option><option value="published">Published</option><option value="failed">Failed</option></select></label>
          <label>Event type<input list="outbox-event-types" value={draft.eventType} onChange={(event) => update("eventType", event.target.value)} placeholder="Any event type" /><datalist id="outbox-event-types"><option value="prediction.created" /><option value="alert.created" /></datalist></label>
        </div>
      </fieldset>
      <div className="operations-filter-footer">
        <p aria-live="polite"><b>Active scope</b><OutboxScope filters={applied} /></p>
        <div><button className="text-button" type="button" onClick={clear}>Clear filters</button><button className="secondary-button" type="submit">Apply filters</button></div>
      </div>
    </form>
  );
}
