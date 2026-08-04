import { useEffect, useMemo, useState } from "react";
import { getEvaluation } from "../../api";
import { ConfusionMatrixChart, ModelComparisonChart } from "../../components/charts";
import { PanelHeading } from "../../components/PanelHeading";
import type { EvaluationReport, ModelInfo } from "../../types";

type Stage = "binary" | "multiclass";

function fallbackReport(stage: Stage, models: ModelInfo[]): EvaluationReport {
  const role = stage === "binary" ? "detector" : "classifier";
  return {
    stage,
    candidates: models.filter((model) => model.role === role).map((model) => ({ ...model, selected: model.status === "active" })),
    measurement_notes: [],
  };
}

export function ModelAnalysis({ models, fixtureMode = false }: { models: ModelInfo[]; fixtureMode?: boolean }) {
  const [stage, setStage] = useState<Stage>("binary");
  const [reports, setReports] = useState<Partial<Record<Stage, EvaluationReport>>>({});
  const [loading, setLoading] = useState(!fixtureMode);
  const [error, setError] = useState("");

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
  }, [fixtureMode, reports, stage]);

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
      <div className="stage-tabs" role="tablist" aria-label="Evaluation stage">
        <button role="tab" aria-selected={stage === "binary"} onClick={() => setStage("binary")}>Detector</button>
        <button role="tab" aria-selected={stage === "multiclass"} onClick={() => setStage("multiclass")}>Classifier</button>
      </div>

      <div className="research-warning" role="note">
        Random shared-split evidence estimates performance on this dataset; it is not deployment validation.
        Scores are uncalibrated and must not be read as probabilities.
      </div>

      {loading ? <div className="panel data-state" role="status">Loading {taskName.toLowerCase()} evidence…</div> : null}
      {error && !candidates.length ? <div className="panel data-state data-state--error" role="alert">{error}</div> : null}

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
              <div><span>Probability calibration</span><b>Not calibrated</b></div>
            </div>
          </section>

          <section className="panel model-chart-panel">
            <PanelHeading
              eyebrow="Three-seed candidate study"
              title={`${taskName} comparison`}
              description="Candidates shown here solve the same task. Quality is higher-is-better; false-positive rate and latency are lower-is-better."
              action={<span className="panel-heading-meta">{candidates.length} candidates</span>}
            />
            <ModelComparisonChart models={candidates} height={420} />
          </section>

          <section className="panel matrix-panel">
            <PanelHeading
              eyebrow="Held-out error structure"
              title="Champion confusion matrix"
              description="Rows are actual classes; columns are predictions. Each cell reports count and actual-class percentage."
            />
            {active?.confusion_matrix?.length
              ? <ConfusionMatrixChart matrix={active.confusion_matrix} classes={active.classes} height={410} />
              : <div className="chart-empty">No confusion matrix was returned for this stage.</div>}
          </section>

          <section className="panel seed-panel">
            <PanelHeading
              eyebrow="Selection evidence"
              title="Three-seed validation aggregates"
              description="These validation aggregates selected the champion. The confusion matrix remains held-out test evidence."
            />
            <div className="seed-table">
              <div className="seed-row seed-row--head"><span>Candidate</span><span>Macro F1</span><span>FPR</span><span>p95 latency</span></div>
              {candidates.map((candidate) => (
                <div className="seed-row" key={candidate.name}>
                  <b>{candidate.name}{candidate.selected ? " · selected" : ""}</b>
                  <span>{candidate.selection_summary?.mean_validation_macro_f1 != null ? `${(candidate.selection_summary.mean_validation_macro_f1 * 100).toFixed(2)}%` : "—"}</span>
                  <span>{candidate.selection_summary?.mean_validation_false_positive_rate != null ? `${(candidate.selection_summary.mean_validation_false_positive_rate * 100).toFixed(2)}%` : "—"}</span>
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
        </div>
      ) : null}

      {!loading && !error && !candidates.length ? (
        <div className="panel data-state">No evaluation records were returned for the {taskName.toLowerCase()}.</div>
      ) : null}
    </div>
  );
}
