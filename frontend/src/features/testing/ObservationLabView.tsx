import { AlertTriangle, CheckCircle2, FileSearch, RotateCcw, Upload } from "lucide-react";
import { useId, useState, type DragEvent } from "react";
import { datasetExampleProvenance } from "../../sampleObservation";
import type { ObservationValidation } from "./observationValidation";
import { processingModeIssue, processingModeLimits } from "./observationValidation";
import { ObservationResults, type ObservationResponse, type ProcessingMode } from "./ObservationResults";

const previewColumns = [
  "id.orig_p",
  "id.resp_p",
  "proto",
  "service",
  "flow_duration",
  "fwd_pkts_tot",
  "bwd_pkts_tot",
  "Attack_type",
];

const modeCopy: Record<ProcessingMode, { title: string; effect: string; bestFor: string }> = {
  immediate: {
    title: "Analyze immediately",
    effect: "Persists predictions, creates alerts for attack verdicts, and returns every result in this workspace.",
    bestFor: "Controlled validation and row-by-row comparison",
  },
  durable: {
    title: "Queue reliably",
    effect: "Persists jobs for worker processing, retry, dead-letter recovery, and outbox delivery evidence.",
    bestFor: "Recoverable asynchronous ingestion",
  },
  replay: {
    title: "Replay as live traffic",
    effect: "Starts a custom replay through the detector, persistence layer, and live event stream.",
    bestFor: "End-to-end exercises using uploaded observations",
  },
};

export interface ObservationLabViewProps {
  rows: Record<string, string | number>[];
  filename: string;
  validation: ObservationValidation;
  processingMode: ProcessingMode;
  replaySpeed: number;
  loading?: boolean;
  error?: string;
  response?: ObservationResponse;
  completedMode?: ProcessingMode | null;
  fixtureMode?: boolean;
  onFile: (file?: File) => void;
  onLoadNormal: () => void;
  onLoadAttack: () => void;
  onProcessingMode: (mode: ProcessingMode) => void;
  onReplaySpeed: (speed: number) => void;
  onRun: () => void;
  onClear: () => void;
}

export function ObservationLabView({
  rows,
  filename,
  validation,
  processingMode,
  replaySpeed,
  loading = false,
  error = "",
  response,
  completedMode = null,
  fixtureMode = false,
  onFile,
  onLoadNormal,
  onLoadAttack,
  onProcessingMode,
  onReplaySpeed,
  onRun,
  onClear,
}: ObservationLabViewProps) {
  const inputId = useId();
  const [dragActive, setDragActive] = useState(false);
  const modeIssue = processingModeIssue(processingMode, rows.length);
  const canSubmit = rows.length > 0 && validation.valid && !modeIssue && !fixtureMode && !loading;
  const submitLabel = loading
    ? "Submitting observations…"
    : processingMode === "immediate"
      ? `Analyze ${rows.length.toLocaleString()} row${rows.length === 1 ? "" : "s"}`
      : processingMode === "durable"
        ? `Queue ${rows.length.toLocaleString()} row${rows.length === 1 ? "" : "s"}`
        : `Start ${rows.length.toLocaleString()}-row replay`;
  const visibleColumns = previewColumns.filter((column) => rows.some((row) => column in row));

  const acceptDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    onFile(event.dataTransfer.files[0]);
  };

  return <div className="observation-workspace">
    <header className="panel observation-intro">
      <div><span className="eyebrow">Controlled observation workflow</span><h2>Validate before traffic reaches the detector</h2><p>Inspect an RT-IoT2022 feature file, choose its operational path, and review the exact receipt or model result.</p></div>
      <dl aria-label="Observation workflow contract">
        <div><dt>Schema</dt><dd>rt-iot2022-v1 <span className="observation-contract-note">83 ordered model features</span></dd></div>
        <div><dt>File boundary</dt><dd>CSV · 10 MB <span className="observation-contract-note">One header and up to 100,000 rows</span></dd></div>
        <div><dt>Mutations</dt><dd>Authenticated <span className="observation-contract-note">Validation remains local until submission</span></dd></div>
      </dl>
    </header>

    <div className="observation-preflight">
      <section className="panel observation-source" aria-labelledby="observation-source-title">
        <div className="observation-section-heading"><span className="step-number">1</span><div><span className="eyebrow">Source evidence</span><h3 id="observation-source-title">Choose observations</h3><p>Select one CSV or use a checksum-bound example from the documented dataset extract.</p></div></div>

        <div className="observation-file-control">
          <label htmlFor={inputId}>RT-IoT2022 CSV file</label>
          <span id={`${inputId}-hint`}>CSV only · maximum 10 MB · one file</span>
          <input key={filename || "empty-file"} id={inputId} type="file" accept=".csv,text/csv" aria-describedby={`${inputId}-hint`} disabled={loading} onChange={(event) => onFile(event.target.files?.[0])} />
        </div>
        <div
          className={dragActive ? "observation-drop observation-drop--active" : "observation-drop"}
          onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => { if (event.currentTarget === event.target) setDragActive(false); }}
          onDrop={acceptDrop}
          aria-hidden="true"
        ><Upload aria-hidden="true" /><span>Or drop one CSV here</span></div>

        <div className="example-buttons" aria-label="Verified observation examples">
          <button type="button" className="secondary-button" disabled={loading} onClick={onLoadNormal}>Load verified normal example</button>
          <button type="button" className="secondary-button" disabled={loading} onClick={onLoadAttack}>Load verified attack example</button>
        </div>
        <p className="sample-note">RT-IoT2022 extracted SHA-256 <span className="mono">{datasetExampleProvenance.extractedSha256}</span>. Source lines {datasetExampleProvenance.normal.sourceLine} and {datasetExampleProvenance.attack.sourceLine}; only the dataset index outside the serving schema is removed.</p>

        {rows.length ? <div className="observation-file-summary" role="status">
          <div><span>Selected file</span><strong>{filename}</strong></div>
          <dl><div><dt>Rows</dt><dd>{rows.length.toLocaleString()}</dd></div><div><dt>Feature columns</dt><dd>{Object.keys(rows[0]).filter((key) => key !== "Attack_type").length}</dd></div><div><dt>Reference labels</dt><dd>{rows.filter((row) => String(row.Attack_type ?? "").trim()).length}</dd></div></dl>
        </div> : null}
      </section>

      <section className="panel observation-review" aria-labelledby="observation-review-title">
        <div className="observation-section-heading"><span className="step-number">2</span><div><span className="eyebrow">Preflight</span><h3 id="observation-review-title">Review contract and values</h3><p>Submission remains blocked until headers, order, categorical values, and numeric values match the backend contract.</p></div></div>

        {!rows.length ? <div className="observation-awaiting"><FileSearch aria-hidden="true" /><strong>No file selected</strong><span>Choose a CSV to inspect its schema and sample values locally.</span></div> : <>
          <div className="validation-summary" aria-live="polite">
            <div className={validation.orderMatches && !validation.missing.length && !validation.extra.length ? "validation-check validation-check--ok" : "validation-check validation-check--error"}>{validation.orderMatches && !validation.missing.length && !validation.extra.length ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}<span><strong>Header contract</strong>{validation.orderMatches && !validation.missing.length && !validation.extra.length ? "83 feature names in canonical order" : "Feature names or order require correction"}</span></div>
            <div className={validation.issueCount === 0 ? "validation-check validation-check--ok" : "validation-check validation-check--error"}>{validation.issueCount === 0 ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}<span><strong>Cell values</strong>{validation.issueCount === 0 ? `${validation.numericFeatureCount} numeric and ${validation.categoricalFeatureCount} categorical fields validated per row` : `${validation.issueCount.toLocaleString()} invalid or blank feature value${validation.issueCount === 1 ? "" : "s"}`}</span></div>
          </div>
          {validation.missing.length || validation.extra.length || !validation.orderMatches ? <div className="validation-errors" role="alert"><strong>Correct the CSV header</strong>{validation.missing.length ? <p>Missing: {validation.missing.join(", ")}</p> : null}{validation.extra.length ? <p>Unexpected: {validation.extra.join(", ")}</p> : null}{!validation.missing.length && !validation.extra.length && !validation.orderMatches ? <p>All names exist, but columns must follow the canonical 83-feature order.</p> : null}</div> : null}
          {validation.issueCount ? <details className="validation-errors"><summary>Review row-level value errors <small>{validation.issueCount.toLocaleString()} total</small></summary><ol>{validation.issues.map((issue, index) => <li key={`${issue.row}-${issue.feature}-${index}`}><strong>Row {issue.row}, {issue.feature}</strong>: {issue.message}</li>)}</ol>{validation.issueCount > validation.issues.length ? <p>Showing the first {validation.issues.length} errors. Correct these issues and reselect the file to validate again.</p> : null}</details> : null}
          <div className="observation-preview">
            <div><strong>Sample preview</strong><span>First {Math.min(5, rows.length)} rows · selected identifying and flow fields</span></div>
            <div className="observation-preview-scroll" role="region" aria-label="Observation sample preview" tabIndex={0}><table><caption>Preview of selected CSV values</caption><thead><tr><th scope="col">Row</th>{visibleColumns.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{rows.slice(0, 5).map((row, rowIndex) => <tr key={rowIndex}><th scope="row">{rowIndex + 1}</th>{visibleColumns.map((column) => <td key={column}>{String(row[column] ?? "Blank")}</td>)}</tr>)}</tbody></table></div>
            <small>The complete 83-feature vector is submitted; this focused preview supports recognition without presenting an 84-column page.</small>
          </div>
        </>}
      </section>
    </div>

    <section className="panel observation-dispatch" aria-labelledby="observation-dispatch-title">
      <div className="observation-section-heading"><span className="step-number">3</span><div><span className="eyebrow">Operational effect</span><h3 id="observation-dispatch-title">Choose processing path</h3><p>The selected path changes persistence, timing, recovery, and where follow-up evidence appears.</p></div></div>
      <fieldset className="processing-mode-grid" disabled={loading}>
        <legend className="sr-only">Processing path</legend>
        {(Object.keys(modeCopy) as ProcessingMode[]).map((mode) => <label key={mode} className={processingMode === mode ? "processing-mode-card processing-mode-card--selected" : "processing-mode-card"}>
          <span className="processing-mode-choice"><input type="radio" name="processing-mode" value={mode} checked={processingMode === mode} onChange={() => onProcessingMode(mode)} /><strong>{modeCopy[mode].title}</strong></span>
          <span>{modeCopy[mode].effect}</span>
          <small>Best for: {modeCopy[mode].bestFor}</small>
          <b>Limit {processingModeLimits[mode].toLocaleString()} rows</b>
        </label>)}
      </fieldset>
      {processingMode === "replay" ? <div className="replay-speed-control"><label>Replay speed<input type="number" min="0.01" max="100" step="0.25" value={replaySpeed} disabled={loading} onChange={(event) => onReplaySpeed(Math.max(0.01, Math.min(100, Number(event.target.value) || 1)))} /></label><p>A 250 ms base interval divided by {replaySpeed}× produces an approximate {(250 / replaySpeed).toFixed(1)} ms event cadence. The backend accepts values above 0 through 100×.</p></div> : null}
      {modeIssue ? <div className="validation-errors" role="alert"><strong>Selected path cannot accept this file</strong><p>{modeIssue}</p></div> : null}
      {fixtureMode ? <div className="fixture-boundary" role="note"><FileSearch aria-hidden="true" /><span><strong>Read-only fixture boundary</strong>Fixture preview validates files locally but cannot submit observations. Connect the API to persist predictions, queue jobs, or start a replay.</span></div> : null}
      {error ? <div className="observation-submit-error" role="alert"><strong>Submission failed</strong><span>{error}</span><small>The validated file remains selected. Correct the issue if needed, then try the same action again.</small></div> : null}
      <div className="observation-actions">
        <button type="button" className="primary-button" disabled={!canSubmit} onClick={onRun}>{submitLabel}</button>
        <button type="button" className="secondary-button" disabled={loading || (!rows.length && !response)} onClick={onClear}><RotateCcw aria-hidden="true" /> Clear workspace</button>
        <span aria-live="polite">{rows.length ? validation.valid && !modeIssue ? `${rows.length.toLocaleString()} validated row${rows.length === 1 ? "" : "s"} ready for ${modeCopy[processingMode].title.toLowerCase()}.` : "Resolve validation or path-limit errors before submission." : "Select observations to continue."}</span>
      </div>
    </section>

    <ObservationResults completedMode={completedMode} response={response} rows={rows} />
  </div>;
}
