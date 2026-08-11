import { AlertTriangle, CheckCircle2, FileSearch } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PanelHeading } from "../../components/PanelHeading";
import type {
  BatchPredictionResponse,
  IngestionBatchReceipt,
  ObservationPrediction,
  ReplayStatus,
} from "../../types";

export type ProcessingMode = "immediate" | "durable" | "replay";
export type ObservationResponse =
  | ObservationPrediction
  | BatchPredictionResponse
  | IngestionBatchReceipt
  | ReplayStatus;

type ResultFilter = "all" | "review" | "attack";

const pageSize = 25;
const normalLabels = new Set([
  "normal",
  "normal_traffic",
  "benign",
  "mqtt",
  "mqtt_publish",
  "thing_speak",
  "wipro_bulb_dataset",
  "wipro_bulb",
  "amazon-alexa",
]);

function normalizedLabel(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase().replaceAll(" ", "_");
}

export function normalizePredictionResults(response?: ObservationResponse): ObservationPrediction[] {
  if (!response) return [];
  if ("predictions" in response && Array.isArray(response.predictions)) return response.predictions;
  return "binary_prediction" in response ? [response] : [];
}

export function comparePrediction(
  result: ObservationPrediction,
  row: Record<string, string | number> | undefined,
) {
  const truth = String(row?.Attack_type ?? row?.ground_truth ?? "").trim();
  if (!truth) return { truth, truthBinary: null, detectorMatch: null, familyMatch: null, needsReview: false } as const;
  const truthBinary = normalLabels.has(normalizedLabel(truth)) ? "normal" : "attack";
  const detectorMatch = result.binary_prediction === truthBinary;
  const familyMatch = truthBinary === "attack" && result.binary_prediction === "attack"
    ? normalizedLabel(result.attack_class) === normalizedLabel(truth)
    : null;
  return {
    truth,
    truthBinary,
    detectorMatch,
    familyMatch,
    needsReview: detectorMatch === false || familyMatch === false,
  } as const;
}

function scoreLabel(value: number | undefined, calibrated: boolean | null | undefined) {
  if (typeof value !== "number") return "Not reported";
  return `${(value * 100).toFixed(1)}% · ${calibrated ? "calibrated probability" : "model score"}`;
}

function latencyLabel(value: number | null | undefined) {
  return typeof value === "number" ? `${value.toFixed(2)} ms` : "Not reported";
}

function PredictionResults({
  results,
  rows,
}: {
  results: ObservationPrediction[];
  rows: Record<string, string | number>[];
}) {
  const [filter, setFilter] = useState<ResultFilter>("all");
  const [page, setPage] = useState(0);
  const compared = useMemo(
    () => results.map((result, index) => ({ result, index, comparison: comparePrediction(result, rows[index]) })),
    [results, rows],
  );
  const reviewCount = compared.filter((item) => item.comparison.needsReview).length;
  const attackCount = compared.filter((item) => item.result.binary_prediction === "attack").length;
  const detectorMismatchCount = compared.filter((item) => item.comparison.detectorMatch === false).length;
  const familyMismatchCount = compared.filter((item) => item.comparison.familyMatch === false).length;
  const filtered = compared.filter((item) => filter === "all"
    || (filter === "review" && item.comparison.needsReview)
    || (filter === "attack" && item.result.binary_prediction === "attack"));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice(page * pageSize, (page + 1) * pageSize);

  useEffect(() => setPage(0), [filter, results]);

  return (
    <>
      <div className="result-summary result-summary--four" aria-label="Prediction summary">
        <div><span>Rows evaluated</span><b>{results.length}</b></div>
        <div><span>Attack verdicts</span><b>{attackCount}</b></div>
        <div className={detectorMismatchCount ? "result-summary--attention" : ""}><span>Detector discrepancies</span><b>{detectorMismatchCount}</b></div>
        <div className={familyMismatchCount ? "result-summary--attention" : ""}><span>Family discrepancies</span><b>{familyMismatchCount}</b></div>
      </div>
      <div className="result-guidance" role="note">
        <FileSearch aria-hidden="true" />
        <p><strong>Comparison scope</strong> Uploaded labels are reference evidence, not a performance estimate. Detector comparison checks normal versus attack; family comparison applies only when both the reference and verdict are attacks.</p>
      </div>
      <div className="result-toolbar">
        <div className="result-filters" role="group" aria-label="Filter prediction results">
          <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All <span>{results.length}</span></button>
          <button type="button" aria-pressed={filter === "review"} onClick={() => setFilter("review")}>Needs review <span>{reviewCount}</span></button>
          <button type="button" aria-pressed={filter === "attack"} onClick={() => setFilter("attack")}>Attack verdicts <span>{attackCount}</span></button>
        </div>
        <span aria-live="polite">Showing {filtered.length} result{filtered.length === 1 ? "" : "s"}</span>
      </div>
      {visible.length ? (
        <ol className="result-review-list" start={page * pageSize + 1}>
          {visible.map(({ result, index, comparison }) => {
            const status = comparison.needsReview ? "review" : comparison.detectorMatch === null ? "unlabelled" : "match";
            return (
              <li className={`result-review-card result-review-card--${status}`} key={result.prediction_id ?? result.event_id ?? index}>
                <div className="result-review-heading">
                  <div><span>Observation</span><strong>Row {index + 1}</strong></div>
                  <span className={`review-state review-state--${status}`}>
                    {status === "review" ? <AlertTriangle aria-hidden="true" /> : status === "match" ? <CheckCircle2 aria-hidden="true" /> : <FileSearch aria-hidden="true" />}
                    {status === "review" ? "Needs review" : status === "match" ? "Matches reference" : "No reference label"}
                  </span>
                </div>
                <dl className="result-review-facts">
                  <div><dt>Detector verdict</dt><dd><strong>{result.binary_prediction}</strong><small>{scoreLabel(result.detection_score ?? result.confidence, result.detection_score_calibrated)}</small></dd></div>
                  <div><dt>Reference</dt><dd><strong>{comparison.truthBinary ?? "Not provided"}</strong><small>{comparison.truth || "No uploaded ground truth"}</small></dd></div>
                  <div><dt>Attack family</dt><dd><strong>{result.attack_class ?? "Not applicable"}</strong><small>{comparison.familyMatch === true ? "Matches reference family" : comparison.familyMatch === false ? "Differs from reference family" : "Not compared"}</small></dd></div>
                  <div><dt>Alert record</dt><dd><strong>{result.alert_id ? "Created" : "No alert"}</strong><small className="mono">{result.alert_id ?? "Normal verdicts do not create alerts"}</small></dd></div>
                </dl>
                <details className="result-evidence">
                  <summary>Exact serving evidence</summary>
                  <dl>
                    <div><dt>Detector model</dt><dd className="mono">{result.detector_model_version ?? result.model_version ?? "Not reported"}</dd></div>
                    <div><dt>Classifier model</dt><dd className="mono">{result.classifier_model_version ?? "Not invoked"}</dd></div>
                    <div><dt>Class score</dt><dd>{scoreLabel(result.attack_class_score ?? undefined, result.attack_class_score_calibrated)}</dd></div>
                    <div><dt>Detector latency</dt><dd>{latencyLabel(result.detector_latency_ms)}</dd></div>
                    <div><dt>Classifier latency</dt><dd>{latencyLabel(result.classifier_latency_ms)}</dd></div>
                    <div><dt>End-to-end latency</dt><dd>{latencyLabel(result.end_to_end_latency_ms ?? result.total_latency_ms)}</dd></div>
                    <div><dt>Prediction</dt><dd className="mono">{result.prediction_id ?? "Not reported"}</dd></div>
                    <div><dt>Event</dt><dd className="mono">{result.event_id ?? "Not reported"}</dd></div>
                  </dl>
                </details>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="data-state" role="status">No results match this review filter.</div>
      )}
      {pageCount > 1 ? (
        <nav className="pagination" aria-label="Prediction result pages">
          <button className="secondary-button" type="button" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</button>
          <span>Page {page + 1} of {pageCount}</span>
          <button className="secondary-button" type="button" disabled={page >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>Next</button>
        </nav>
      ) : null}
    </>
  );
}

export function ObservationResults({
  completedMode,
  response,
  rows,
}: {
  completedMode: ProcessingMode | null;
  response?: ObservationResponse;
  rows: Record<string, string | number>[];
}) {
  const results = normalizePredictionResults(response);
  const ingestionReceipt = completedMode === "durable" ? response as IngestionBatchReceipt | undefined : undefined;
  const replayReceipt = completedMode === "replay" ? response as ReplayStatus | undefined : undefined;

  return (
    <section className="panel lab-results" aria-label="Observation results">
      <PanelHeading
        eyebrow={completedMode === "durable" ? "Ingestion receipt" : completedMode === "replay" ? "Replay receipt" : "Prediction output"}
        title={completedMode === "durable" ? "Queued observations" : completedMode === "replay" ? "Live replay started" : "Results"}
        description={completedMode === "durable"
          ? "The durable worker owns these observations now; progress and retries are visible in ingestion operations."
          : completedMode === "replay"
            ? "The uploaded observations are moving through the same detector and event stream as recorded scenarios."
            : "Review verdicts against uploaded labels, then disclose exact serving evidence only where it is needed."}
        action={results.length ? <span className="panel-heading-meta">{results.length} evaluated</span> : undefined}
      />
      {ingestionReceipt ? (
        <div className="submission-receipt" role="status">
          <CheckCircle2 aria-hidden="true" />
          <div><span>Batch accepted</span><strong>{ingestionReceipt.events.length} observation{ingestionReceipt.events.length === 1 ? "" : "s"} received</strong><small className="mono">Batch {ingestionReceipt.batch_id}</small></div>
          <dl><div><dt>Accepted</dt><dd>{ingestionReceipt.events.filter((event) => event.disposition === "accepted").length}</dd></div><div><dt>Duplicates</dt><dd>{ingestionReceipt.events.filter((event) => event.disposition === "duplicate").length}</dd></div></dl>
        </div>
      ) : replayReceipt ? (
        <div className="submission-receipt" role="status">
          <CheckCircle2 aria-hidden="true" />
          <div><span>Custom replay</span><strong>{replayReceipt.status}</strong><small>{replayReceipt.total} observations · {replayReceipt.speed}× speed</small></div>
          <dl><div><dt>Processed</dt><dd>{replayReceipt.processed}</dd></div><div><dt>Total</dt><dd>{replayReceipt.total}</dd></div></dl>
        </div>
      ) : results.length ? (
        <PredictionResults results={results} rows={rows} />
      ) : (
        <div className="empty-state">
          <FileSearch aria-hidden="true" />
          <p>Choose a processing path to analyze immediately, queue reliably, or exercise the live event pipeline.</p>
        </div>
      )}
      {response && completedMode !== "immediate" ? (
        <details className="raw-details submission-evidence">
          <summary>Inspect exact receipt</summary>
          <pre role="region" aria-label="Exact submission receipt" tabIndex={0}>{JSON.stringify(response, null, 2)}</pre>
        </details>
      ) : null}
    </section>
  );
}
