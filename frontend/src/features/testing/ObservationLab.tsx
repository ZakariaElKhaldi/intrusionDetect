import { AlertTriangle, CheckCircle2, FileSearch, RotateCcw, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { enqueueObservations, predict, startCustomReplay } from "../../api";
import { useAuth } from "../../auth";
import { datasetExampleProvenance, verifiedAttackObservationCsv, verifiedNormalObservationCsv } from "../../sampleObservation";
import { parseCsv } from "../../utils";
import { ObservationResults, type ObservationResponse, type ProcessingMode } from "./ObservationResults";

const sampleRow = parseCsv(verifiedNormalObservationCsv)[0];
const canonicalHeaders = Object.keys(sampleRow).filter((header) => header !== "Attack_type");

export function ObservationLab({ fixtureMode = false }: { fixtureMode?: boolean }) {
  const auth = useAuth();
  const [rows, setRows] = useState<Record<string, string | number>[]>([]);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  const [response, setResponse] = useState<ObservationResponse>();
  const [processingMode, setProcessingMode] = useState<ProcessingMode>("immediate");
  const [completedMode, setCompletedMode] = useState<ProcessingMode | null>(null);
  const [loading, setLoading] = useState(false);

  const schema = useMemo(() => {
    if (!rows.length) return { missing: [] as string[], extra: [] as string[], valid: false };
    const headers = Object.keys(rows[0]).filter((header) => header !== "Attack_type");
    return {
      missing: canonicalHeaders.filter((header) => !headers.includes(header)),
      extra: headers.filter((header) => !canonicalHeaders.includes(header)),
      valid: headers.length === canonicalHeaders.length
        && canonicalHeaders.every((header, index) => headers[index] === header),
    };
  }, [rows]);

  const loadText = (text: string, name: string) => {
    setError("");
    setResponse(undefined);
    try {
      const parsed = parseCsv(text);
      if (parsed.length > 10_000) throw new Error(`This file contains ${parsed.length.toLocaleString()} rows. The inference limit is 10,000 rows per request.`);
      setRows(parsed);
      setFilename(name);
    } catch (caught) {
      setRows([]);
      setFilename("");
      setError(caught instanceof Error ? caught.message : "Could not parse the CSV.");
    }
  };

  const loadFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError("CSV must be 10 MB or smaller.");
      return;
    }
    loadText(await file.text(), file.name);
  };

  const run = async () => {
    if (!schema.valid || !rows.length) return;
    if (processingMode === "durable" && rows.length > 1_000) {
      setError("Durable ingestion accepts at most 1,000 observations per batch. Split this file or use immediate analysis.");
      return;
    }
    if (!auth.authenticated) { auth.openLogin(); return; }
    setLoading(true);
    setError("");
    setResponse(undefined);
    setCompletedMode(null);
    try {
      const nextResponse = processingMode === "immediate"
        ? await predict(rows)
        : processingMode === "durable"
          ? await enqueueObservations(rows)
          : await startCustomReplay(rows);
      setResponse(nextResponse);
      setCompletedMode(processingMode);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Prediction request failed.");
    } finally {
      setLoading(false);
    }
  };

  const clear = () => {
    setRows([]);
    setFilename("");
    setError("");
    setResponse(undefined);
    setCompletedMode(null);
  };

  return (
    <div className="lab-grid">
      <section className="panel lab-controls">
        <span className="eyebrow">Observation workflow</span>
        <h2>Validate traffic features</h2>
        <p>Inspect the schema before sending one observation or a batch to the active model.</p>
        <p className="sample-note">Batch inference is all-or-nothing: one invalid row rejects the complete request.</p>

        <div className="step-label"><b>1</b> Select observations</div>
        <label className="dropzone">
          <input type="file" accept=".csv,text/csv" onChange={(event) => loadFile(event.target.files?.[0])} />
          <Upload aria-hidden="true" />
          <b>Choose an RT-IoT2022 CSV</b>
          <small>Canonical 83-feature order · maximum 10 MB and 10,000 rows</small>
        </label>
        <div className="example-buttons">
          <button className="secondary-button" onClick={() => loadText(verifiedNormalObservationCsv, "rt-iot2022-line-2-normal.csv")}>Load verified normal example</button>
          <button className="secondary-button" onClick={() => loadText(verifiedAttackObservationCsv, "rt-iot2022-line-12509-attack.csv")}>Load verified attack example</button>
        </div>
        <p className="sample-note">RT-IoT2022 extracted SHA-256 <span className="mono">{datasetExampleProvenance.extractedSha256}</span>. Source lines 2 (MQTT_Publish → normal) and 12,509 (ARP_poisioning → attack); the leading dataset index is intentionally removed.</p>

        <div className="step-label"><b>2</b> Validate schema</div>
        {rows.length ? (
          <>
            <div className="file-summary">
              <span>File</span><b>{filename}</b>
              <span>Rows</span><b>{rows.length}</b>
              <span>Feature columns</span><b>{Object.keys(rows[0]).filter((key) => key !== "Attack_type").length}</b>
            </div>
            <div className="validation-list">
              <div className={`validation-item ${schema.valid ? "validation-item--ok" : "validation-item--error"}`}>
                {schema.valid ? <CheckCircle2 /> : <AlertTriangle />}
                <span>{schema.valid ? "Names and order match rt-iot2022-v1." : "Feature names or order do not match the canonical schema."}</span>
              </div>
              {!!schema.missing.length && (
                <div className="validation-item validation-item--error"><AlertTriangle /><span>Missing: {schema.missing.join(", ")}</span></div>
              )}
              {!!schema.extra.length && (
                <div className="validation-item validation-item--error"><AlertTriangle /><span>Unexpected: {schema.extra.join(", ")}</span></div>
              )}
            </div>
          </>
        ) : <div className="validation-item"><FileSearch /><span>Select a file to inspect its schema.</span></div>}

        <div className="step-label"><b>3</b> Choose processing path</div>
        <fieldset className="processing-modes">
          <legend className="sr-only">Processing path</legend>
          <label className={processingMode === "immediate" ? "processing-mode processing-mode--selected" : "processing-mode"}>
            <input type="radio" name="processing-mode" value="immediate" checked={processingMode === "immediate"} onChange={() => setProcessingMode("immediate")} />
            <span><b>Analyze now</b><small>Return a verdict for every row immediately. Best for controlled investigation.</small></span>
          </label>
          <label className={processingMode === "durable" ? "processing-mode processing-mode--selected" : "processing-mode"}>
            <input type="radio" name="processing-mode" value="durable" checked={processingMode === "durable"} onChange={() => setProcessingMode("durable")} />
            <span><b>Queue reliably</b><small>Persist up to 1,000 rows for worker processing, retries, and operations evidence.</small></span>
          </label>
          <label className={processingMode === "replay" ? "processing-mode processing-mode--selected" : "processing-mode"}>
            <input type="radio" name="processing-mode" value="replay" checked={processingMode === "replay"} onChange={() => setProcessingMode("replay")} />
            <span><b>Replay as live traffic</b><small>Stream these rows through the detector at a controlled interval for an end-to-end exercise.</small></span>
          </label>
        </fieldset>
        {fixtureMode ? <div className="validation-item" role="note"><FileSearch /><span>Fixture preview validates files locally but cannot submit observations. Connect the API to use a processing path.</span></div> : null}
        <div className="lab-actions">
          <button className="primary-button" disabled={fixtureMode || !schema.valid || loading} onClick={run}>
            {loading ? "Submitting…" : processingMode === "immediate"
              ? `Analyze ${rows.length || 0} row${rows.length === 1 ? "" : "s"}`
              : processingMode === "durable"
                ? `Queue ${rows.length || 0} row${rows.length === 1 ? "" : "s"}`
                : `Replay ${rows.length || 0} row${rows.length === 1 ? "" : "s"}`}
          </button>
          <button className="secondary-button" disabled={!rows.length && !response} onClick={clear}>
            <RotateCcw aria-hidden="true" /> Clear
          </button>
        </div>
        {error && <div className="offline-notice" role="alert">{error}</div>}
      </section>

      <ObservationResults completedMode={completedMode} response={response} rows={rows} />
    </div>
  );
}
