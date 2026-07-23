import { ConfusionMatrixChart, ModelComparisonChart } from "../../components/charts";
import { PanelHeading } from "../../components/PanelHeading";
import type { ModelInfo } from "../../types";

export function ModelAnalysis({ models }: { models: ModelInfo[] }) {
  const active = models.find((model) => model.status === "active") ?? models[0];
  return (
    <div className="models-grid">
      <section className="panel model-summary">
        <span className="eyebrow">Active model</span>
        <h2>{active?.name ?? "No model loaded"}</h2>
        <p className="mono">{active?.version ?? "Version unavailable"}</p>
        <div className="model-score">
          <strong>{((active?.macro_f1 ?? 0) * 100).toFixed(1)}</strong>
          <span>% macro F1</span>
        </div>
        <div className="fact-list">
          <div><span>Weighted F1</span><b>{((active?.weighted_f1 ?? 0) * 100).toFixed(1)}%</b></div>
          <div><span>False-positive rate</span><b>{((active?.false_positive_rate ?? 0) * 100).toFixed(2)}%</b></div>
          <div><span>Median latency</span><b>{active?.inference_ms?.toFixed(2) ?? "—"} ms</b></div>
          <div><span>Evaluation scope</span><b>{active?.evaluation_scope ?? "Not reported"}</b></div>
          <div><span>Probability calibration</span><b>Not calibrated</b></div>
        </div>
      </section>

      <section className="panel model-chart-panel">
        <PanelHeading
          eyebrow="Comparable evidence"
          title="Model comparison"
          description="Quality metrics are higher-is-better; false-positive rate and latency are lower-is-better."
          action={<span className="panel-heading-meta">{models.length} versions</span>}
        />
        {models.length
          ? <ModelComparisonChart models={models} height={420} />
          : <div className="chart-empty">No evaluation records were returned.</div>}
      </section>

      <section className="panel matrix-panel">
        <PanelHeading
          eyebrow="Error structure"
          title="Confusion matrix"
          description="Rows are actual classes; columns are predicted classes. Cells show counts and row percentages."
        />
        {active?.confusion_matrix?.length
          ? <ConfusionMatrixChart matrix={active.confusion_matrix} classes={active.classes} height={360} />
          : <div className="chart-empty">The active model record does not include a confusion matrix.</div>}
      </section>

      <section className="panel">
        <PanelHeading
          eyebrow="Monitoring boundary"
          title="Feature drift"
          description="A live reference window is required before distribution shift can be measured."
        />
        <div className="model-note">
          Drift is not collected in the current MVP. No synthetic trend or health score is shown.
          When Phase 7 telemetry is available, this space will compare reference and live distributions.
        </div>
      </section>
    </div>
  );
}

