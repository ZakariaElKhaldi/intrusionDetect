import { useEffect, useMemo, useState } from "react";
import { getEvaluation } from "../../api";
import { ConfusionMatrixChart, ModelComparisonChart } from "../../components/charts";
import { PanelHeading } from "../../components/PanelHeading";
import type { EvaluationReport, ModelInfo, ThresholdAnalysis } from "../../types";
import { ModelHealth } from "./ModelHealth";

type Stage = "binary" | "multiclass";

function ThresholdCurve({ analysis }: { analysis: ThresholdAnalysis }) {
  const width = 720, height = 280, left = 54, top = 20, right = 18, bottom = 42;
  const plotWidth = width-left-right, plotHeight=height-top-bottom;
  const points=[...analysis.points].sort((a,b)=>a.threshold-b.threshold);
  const x=(value:number)=>left+Math.max(0,Math.min(1,value))*plotWidth;
  const y=(value:number)=>top+(1-Math.max(0,Math.min(1,value)))*plotHeight;
  const line=(key: "recall"|"precision"|"false_positive_rate"|"alert_rate")=>points.map((p)=>`${x(p.threshold)},${y(p[key])}`).join(" ");
  return <figure className="threshold-curve"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="threshold-chart-title threshold-chart-desc"><title id="threshold-chart-title">Detector validation metrics across thresholds</title><desc id="threshold-chart-desc">Recall, precision, false-positive rate and alert rate between zero and one, with the serving threshold marked.</desc>
    {[0,.25,.5,.75,1].map(value=><g key={value}><line x1={left} x2={width-right} y1={y(value)} y2={y(value)} className="threshold-grid"/><text x={left-8} y={y(value)+4} textAnchor="end">{Math.round(value*100)}%</text><text x={x(value)} y={height-14} textAnchor="middle">{value.toFixed(2)}</text></g>)}
    <line x1={x(analysis.operating_threshold)} x2={x(analysis.operating_threshold)} y1={top} y2={height-bottom} className="threshold-operating"/><text x={x(analysis.operating_threshold)+5} y={top+12}>Serving {analysis.operating_threshold.toFixed(3)}</text>
    <polyline points={line("recall")} className="threshold-line threshold-line--recall"/><polyline points={line("precision")} className="threshold-line threshold-line--precision"/><polyline points={line("false_positive_rate")} className="threshold-line threshold-line--fpr"/><polyline points={line("alert_rate")} className="threshold-line threshold-line--alert"/>
  </svg><figcaption><span className="legend-recall">Recall</span><span className="legend-precision">Precision</span><span className="legend-fpr">False-positive rate</span><span className="legend-alert">Alert rate</span></figcaption></figure>;
}

function fallbackReport(stage: Stage, models: ModelInfo[]): EvaluationReport {
  const role = stage === "binary" ? "detector" : "classifier";
  return {
    stage,
    candidates: models.filter((model) => model.role === role).map((model) => ({ ...model, selected: model.status === "active" })),
    measurement_notes: [],
  };
}

export function ModelAnalysis({ models, fixtureMode = false, descriptorLoading = false, descriptorError = "" }: { models: ModelInfo[]; fixtureMode?: boolean; descriptorLoading?: boolean; descriptorError?: string }) {
  const [stage, setStage] = useState<Stage>("binary");
  const [reports, setReports] = useState<Partial<Record<Stage, EvaluationReport>>>({});
  const [loading, setLoading] = useState(!fixtureMode);
  const [error, setError] = useState("");
  const [matrixMode, setMatrixMode] = useState<"raw" | "normalized">("raw");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (fixtureMode || reports[stage]) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void getEvaluation(stage).then((report) => {
      if (!cancelled) setReports((current) => ({ ...current, [stage]: report }));
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Evaluation evidence is unavailable.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [fixtureMode, reload, reports, stage]);

  const report = reports[stage] ?? fallbackReport(stage, models);
  const candidates = report.candidates;
  const active = candidates.find((model) => model.selected || model.status === "active") ?? candidates[0];
  const support = useMemo(
    () => Object.entries(active?.support ?? {}).sort((left, right) => left[1] - right[1]),
    [active],
  );
  const taskName = stage === "binary" ? "Attack detector" : "Attack-family classifier";

  return (
    <div className="models-page">
      <ModelHealth fixtureMode={fixtureMode}/>
      <div className="stage-tabs" role="tablist" aria-label="Evaluation stage">
        <button role="tab" aria-selected={stage === "binary"} onClick={() => setStage("binary")}>Detector</button>
        <button role="tab" aria-selected={stage === "multiclass"} onClick={() => setStage("multiclass")}>Classifier</button>
      </div>

      <div className="research-warning" role="note">
        Random shared-split evidence estimates performance on this dataset; it is not deployment validation.
        {active?.probability_calibrated ? " Serving scores use sigmoid calibration fitted on the validation partition." : " Uncalibrated scores must not be read as probabilities."}
      </div>

      {loading ? <div className="panel data-state" role="status">Loading {taskName.toLowerCase()} evidence…</div> : null}
      {descriptorLoading ? <div className="panel data-state" role="status">Loading serving model descriptors…</div> : null}
      {descriptorError ? <div className="panel data-state data-state--error" role="alert">Serving descriptors: {descriptorError}</div> : null}
      {error && !candidates.length ? <div className="panel data-state data-state--error" role="alert"><span>{error}</span><button className="secondary-button" onClick={() => { setReports((current) => ({ ...current, [stage]: undefined })); setReload((value) => value + 1); }}>Retry evaluation</button></div> : null}

      {!loading && candidates.length ? (
        <div className="models-grid">
          <section className="panel model-summary">
            <span className="eyebrow">Selected {taskName}</span>
            <h2>{active?.name ?? "No champion reported"}</h2>
            <p className="mono">{active?.version ?? report.selected_champion ?? "Version unavailable"}</p>
            <div className="model-score">
              <strong>{((active?.macro_f1 ?? 0) * 100).toFixed(1)}</strong>
              <span>% test macro F1</span>
            </div>
            <div className="fact-list">
              <div><span>Weighted F1</span><b>{((active?.weighted_f1 ?? 0) * 100).toFixed(1)}%</b></div>
              {stage === "binary" ? <div><span>False-positive rate</span><b>{((active?.false_positive_rate ?? 0) * 100).toFixed(2)}%</b></div> : null}
              <div><span>Median latency</span><b>{active?.inference_ms ? `${active.inference_ms.toFixed(2)} ms` : "Not reported"}</b></div>
              <div><span>Selection metric</span><b>{active?.selection_metric ?? "Macro F1"}</b></div>
              <div><span>Evaluation scope</span><b>{report.split_notes ?? active?.evaluation_scope ?? "Shared random test split"}</b></div>
              <div><span>Probability calibration</span><b>{active?.probability_calibrated ? "Sigmoid · validation partition" : "Not calibrated"}</b></div>
            </div>
          </section>

          <section className="panel model-chart-panel">
            <PanelHeading
              eyebrow="Three-seed candidate study"
              title={`${taskName} comparison`}
              description={stage === "binary" ? "Detector candidates only. Quality is higher-is-better; false-positive rate and latency are lower-is-better." : "Classifier candidates only. Quality is higher-is-better and latency is lower-is-better; detector FPR does not apply."}
              action={<span className="panel-heading-meta">{candidates.length} candidates</span>}
            />
            <ModelComparisonChart models={candidates} height={420} includeFalsePositiveRate={stage === "binary"} />
            <div className="preview-scroll"><table><caption>Exact held-out candidate metrics</caption><thead><tr><th>Candidate</th><th>Macro F1</th><th>Weighted F1</th>{stage === "binary" ? <th>FPR</th> : null}<th>Median latency</th></tr></thead><tbody>{candidates.map((candidate) => <tr key={candidate.name}><th scope="row">{candidate.name}{candidate.selected ? " · selected" : ""}</th><td>{candidate.macro_f1 == null ? "—" : `${(candidate.macro_f1 * 100).toFixed(2)}%`}</td><td>{candidate.weighted_f1 == null ? "—" : `${(candidate.weighted_f1 * 100).toFixed(2)}%`}</td>{stage === "binary" ? <td>{candidate.false_positive_rate == null ? "Not measured" : `${(candidate.false_positive_rate * 100).toFixed(2)}%`}</td> : null}<td>{candidate.inference_ms == null ? "—" : `${candidate.inference_ms.toFixed(2)} ms`}</td></tr>)}</tbody></table></div>
          </section>

          <section className="panel matrix-panel">
            <PanelHeading
              eyebrow="Held-out error structure"
              title="Champion confusion matrix"
              description="Rows are actual classes; columns are predictions. Each cell reports count and actual-class percentage."
            />
            <div className="matrix-toggle" role="group" aria-label="Confusion matrix values"><button className="secondary-button" aria-pressed={matrixMode === "raw"} onClick={() => setMatrixMode("raw")}>Raw counts</button><button className="secondary-button" aria-pressed={matrixMode === "normalized"} onClick={() => setMatrixMode("normalized")}>Row percentages</button></div>
            {active?.confusion_matrix?.length
              ? <ConfusionMatrixChart matrix={active.confusion_matrix} classes={active.classes} height={410} />
              : <div className="chart-empty">No confusion matrix was returned for this stage.</div>}
            {active?.confusion_matrix?.length ? <div className="preview-scroll"><table><caption>{matrixMode === "raw" ? "Exact confusion counts" : "Percent within each actual class"}</caption><thead><tr><th>Actual \ predicted</th>{active.classes?.map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{active.confusion_matrix.map((row, rowIndex) => { const total = row.reduce((sum, value) => sum + value, 0); return <tr key={active.classes?.[rowIndex] ?? rowIndex}><th scope="row">{active.classes?.[rowIndex] ?? `Class ${rowIndex + 1}`}</th>{row.map((value, column) => <td key={column}>{matrixMode === "raw" ? value : `${(total ? value / total * 100 : 0).toFixed(1)}%`}</td>)}</tr>; })}</tbody></table></div> : null}
          </section>

          <section className="panel seed-panel">
            <PanelHeading
              eyebrow="Selection evidence"
              title="Three-seed validation aggregates"
              description="These validation aggregates selected the champion. The confusion matrix remains held-out test evidence."
            />
            <div className="seed-table">
              <div className={`seed-row ${stage === "multiclass" ? "seed-row--three" : ""} seed-row--head`}><span>Candidate</span><span>Macro F1</span>{stage === "binary" ? <span>FPR</span> : null}<span>p95 latency</span></div>
              {candidates.map((candidate) => (
                <div className={`seed-row ${stage === "multiclass" ? "seed-row--three" : ""}`} key={candidate.name}>
                  <b>{candidate.name}{candidate.selected ? " · selected" : ""}</b>
                  <span>{candidate.selection_summary?.mean_validation_macro_f1 != null ? `${(candidate.selection_summary.mean_validation_macro_f1 * 100).toFixed(2)}%` : "—"}</span>
                  {stage === "binary" ? <span>{candidate.selection_summary?.mean_validation_false_positive_rate != null ? `${(candidate.selection_summary.mean_validation_false_positive_rate * 100).toFixed(2)}%` : "—"}</span> : null}
                  <span>{candidate.selection_summary?.mean_p95_inference_latency_ms != null ? `${candidate.selection_summary.mean_p95_inference_latency_ms.toFixed(2)} ms` : "—"}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel support-panel">
            <PanelHeading
              eyebrow="Evidence strength"
              title="Held-out class support"
              description="Low support makes per-class conclusions less stable, even when the headline score is strong."
            />
            {support.length ? (
              <div className="support-table">
                {support.map(([label, count]) => (
                  <div key={label} className={count < 30 ? "support-row support-row--rare" : "support-row"}>
                    <span>{label}</span><b>{count}</b><small>{count < 30 ? "rare class" : "test rows"}</small>
                  </div>
                ))}
              </div>
            ) : <div className="chart-empty">Class support was not included in the evaluation response.</div>}
          </section>

          <section className="panel measurement-panel">
            <PanelHeading eyebrow="Interpretation" title="Measurement notes" />
            <div className="model-note">
              {(report.measurement_notes.length ? report.measurement_notes : [
                "Candidate selection and final test measurement are distinct steps.",
                "Random splits do not measure temporal drift or performance on unseen deployments.",
              ]).map((note) => <p key={note}>{note}</p>)}
            </div>
          </section>
          {stage === "binary" && report.threshold_analysis ? <section className="panel threshold-panel"><PanelHeading eyebrow="Operating policy" title="Detector threshold analysis" description={`Validation-set behavior across detector thresholds; the promoted detector ${report.probability_calibrated ? "reports calibrated probabilities" : "reports model scores without declared calibration"}.`}/><div className="fact-list threshold-facts"><div><span>Serving threshold</span><b>{report.threshold_analysis.operating_threshold.toFixed(3)}</b></div><div><span>Policy</span><b>{report.threshold_analysis.selection_policy ?? "Current threshold retained"}</b></div><div><span>Validation rows</span><b>{report.threshold_analysis.partition_rows ?? "Not reported"}</b></div></div><ThresholdCurve analysis={report.threshold_analysis}/><div className="preview-scroll"><table><caption>Recall, precision, false-positive and alert rates by threshold</caption><thead><tr><th>Threshold</th><th>Recall</th><th>Precision</th><th>FPR</th><th>Alert rate</th></tr></thead><tbody>{report.threshold_analysis.points.map((point) => <tr className={Math.abs(point.threshold - report.threshold_analysis!.operating_threshold) < 1e-8 ? "operating-row" : ""} key={point.threshold}><td>{point.threshold.toFixed(3)}</td><td>{(point.recall*100).toFixed(1)}%</td><td>{(point.precision*100).toFixed(1)}%</td><td>{(point.false_positive_rate*100).toFixed(1)}%</td><td>{(point.alert_rate*100).toFixed(1)}%</td></tr>)}</tbody></table></div></section> : null}
          {stage === "binary" && report.cascade_evaluation ? <section className="panel cascade-panel"><PanelHeading eyebrow="Complete serving path" title="Binary → family cascade" description={report.cascade_evaluation.protocol ?? "Shared held-out split evaluation"}/><div className="result-summary"><div><span>Test rows</span><b>{report.cascade_evaluation.test_rows ?? "—"}</b></div><div><span>Detector false negatives</span><b>{report.cascade_evaluation.detector_false_negatives ?? "—"}</b></div><div><span>Cascade macro F1</span><b>{report.cascade_evaluation.metrics?.macro_f1 == null ? "—" : `${(report.cascade_evaluation.metrics.macro_f1*100).toFixed(2)}%`}</b></div></div>{report.cascade_evaluation.confusion_matrix.length ? <ConfusionMatrixChart matrix={report.cascade_evaluation.confusion_matrix} classes={report.cascade_evaluation.classes} height={430}/> : null}<div className="preview-scroll"><table><caption>Per-class cascade recall and support, including detector misses</caption><thead><tr><th>Actual class</th><th>Correct</th><th>Support</th><th>Recall</th></tr></thead><tbody>{report.cascade_evaluation.classes.map((label,index)=>{const row=report.cascade_evaluation!.confusion_matrix[index]??[];const support=report.cascade_evaluation!.class_support?.[label]??row.reduce((sum,value)=>sum+value,0);const correct=row[index]??0;return <tr key={label}><th scope="row">{label}</th><td>{correct}</td><td>{support}</td><td>{support?`${(correct/support*100).toFixed(2)}%`:"—"}</td></tr>})}</tbody></table></div></section> : null}
        </div>
      ) : null}

      {!loading && !error && !candidates.length ? (
        <div className="panel data-state">No evaluation records were returned for the {taskName.toLowerCase()}.</div>
      ) : null}
    </div>
  );
}
