import { AlertTriangle, CheckCircle2, FileSearch, RotateCcw, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { predict } from "../../api";
import { PanelHeading } from "../../components/PanelHeading";
import { savedObservationCsv } from "../../sampleObservation";
import { parseCsv } from "../../utils";

interface PredictionResult {
  event_id?: string;
  model_version?: string;
  binary_prediction?: string;
  attack_class?: string | null;
  confidence?: number;
  alert_id?: string | null;
}

const sampleRow = parseCsv(savedObservationCsv)[0];
const canonicalHeaders = Object.keys(sampleRow).filter((header) => header !== "Attack_type");

function normalizeResults(value: unknown): PredictionResult[] {
  if (!value || typeof value !== "object") return [];
  if ("predictions" in value && Array.isArray((value as { predictions: unknown }).predictions)) {
    return (value as { predictions: PredictionResult[] }).predictions;
  }
  return [value as PredictionResult];
}

export function ObservationLab() {
  const [rows, setRows] = useState<Record<string, string | number>[]>([]);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  const [response, setResponse] = useState<unknown>();
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
  const results = useMemo(() => normalizeResults(response), [response]);
  const attackCount = results.filter((result) => result.binary_prediction === "attack").length;
  const averageConfidence = results.length
    ? results.reduce((total, result) => total + (result.confidence ?? 0), 0) / results.length
    : 0;

  const loadText = (text: string, name: string) => {
    setError("");
    setResponse(undefined);
    try {
      const parsed = parseCsv(text);
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
    setLoading(true);
    setError("");
    try {
      setResponse(await predict(rows));
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
  };

  return (
    <div className="lab-grid">
      <section className="panel lab-controls">
        <span className="eyebrow">Observation workflow</span>
        <h2>Validate traffic features</h2>
        <p>Inspect the schema before sending one observation or a batch to the active model.</p>

        <div className="step-label"><b>1</b> Select observations</div>
        <label className="dropzone">
          <input type="file" accept=".csv,text/csv" onChange={(event) => loadFile(event.target.files?.[0])} />
          <Upload aria-hidden="true" />
          <b>Choose an RT-IoT2022 CSV</b>
          <small>Canonical 83-feature order · maximum 10 MB</small>
        </label>
        <button className="secondary-button" onClick={() => loadText(savedObservationCsv, "saved-normal-observation.csv")}>
          Load the saved fixture
        </button>

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

        <div className="step-label"><b>3</b> Run inference</div>
        <div className="lab-actions">
          <button className="primary-button" disabled={!schema.valid || loading} onClick={run}>
            {loading ? "Running…" : `Predict ${rows.length || 0} row${rows.length === 1 ? "" : "s"}`}
          </button>
          <button className="secondary-button" disabled={!rows.length && !response} onClick={clear}>
            <RotateCcw aria-hidden="true" /> Clear
          </button>
        </div>
        {error && <div className="offline-notice" role="alert">{error}</div>}
      </section>

      <section className="panel lab-results">
        <PanelHeading
          eyebrow="Prediction output"
          title="Results"
          description="Scores are classifier outputs and are not guaranteed calibrated probabilities."
          action={results.length ? <span className="panel-heading-meta">{results.length} evaluated</span> : undefined}
        />
        {!results.length ? (
          <div className="empty-state">
            <FileSearch aria-hidden="true" />
            <p>Validated predictions will appear here as an investigation-ready summary, with raw data available on demand.</p>
          </div>
        ) : (
          <>
            <div className="result-summary">
              <div><span>Rows evaluated</span><b>{results.length}</b></div>
              <div><span>Attack predictions</span><b>{attackCount}</b></div>
              <div><span>Mean score</span><b>{(averageConfidence * 100).toFixed(1)}%</b></div>
            </div>
            <div className="preview-scroll">
              <table>
                <thead><tr><th>Row</th><th>Prediction</th><th>Class</th><th>Score</th><th>Model version</th><th>Alert</th></tr></thead>
                <tbody>
                  {results.map((result, index) => (
                    <tr key={result.event_id ?? index}>
                      <td>{index + 1}</td>
                      <td>{result.binary_prediction ?? "Unknown"}</td>
                      <td>{result.attack_class ?? "—"}</td>
                      <td>{typeof result.confidence === "number" ? `${(result.confidence * 100).toFixed(1)}%` : "—"}</td>
                      <td className="mono">{result.model_version ?? "—"}</td>
                      <td className="mono">{result.alert_id ?? "No alert"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className="raw-details">
              <summary>Inspect raw response</summary>
              <pre>{JSON.stringify(response, null, 2)}</pre>
            </details>
          </>
        )}
      </section>
    </div>
  );
}

