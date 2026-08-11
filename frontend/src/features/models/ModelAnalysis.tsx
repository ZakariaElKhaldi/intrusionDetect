import { useEffect, useState } from "react";
import { getEvaluation } from "../../api";
import { TabList, tabId } from "../../components/TabList";
import type { EvaluationReport, ModelInfo } from "../../types";
import { ModelEvaluationView, type EvaluationStage } from "./ModelEvaluationView";
import { ModelHealth } from "./ModelHealth";
import { ServingModelSummary } from "./ServingModelSummary";

type WorkspaceView = "operations" | "evaluation";

export interface ModelAnalysisProps {
  models: ModelInfo[];
  fixtureMode?: boolean;
  descriptorLoading?: boolean;
  descriptorError?: string;
  initialView?: WorkspaceView;
  initialStage?: EvaluationStage;
  initialReports?: Partial<Record<EvaluationStage, EvaluationReport>>;
}

export function ModelAnalysis({ models, fixtureMode = false, descriptorLoading = false, descriptorError = "", initialView = "operations", initialStage = "binary", initialReports = {} }: ModelAnalysisProps) {
  const [view, setView] = useState<WorkspaceView>(initialView);
  const [stage, setStage] = useState<EvaluationStage>(initialStage);
  const [reports, setReports] = useState<Partial<Record<EvaluationStage, EvaluationReport>>>(initialReports);
  const [loading, setLoading] = useState(!fixtureMode && initialView === "evaluation" && !initialReports[initialStage]);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (view !== "evaluation" || fixtureMode || reports[stage]) return;
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
  }, [fixtureMode, reload, reports, stage, view]);

  const changeView = (next: WorkspaceView) => {
    setView(next);
    setError("");
    if (next === "evaluation" && !fixtureMode && !reports[stage]) setLoading(true);
  };

  const changeStage = (next: EvaluationStage) => {
    setStage(next);
    setError("");
    setLoading(!fixtureMode && !reports[next]);
  };

  const retry = () => {
    setReports((current) => ({ ...current, [stage]: undefined }));
    setLoading(true);
    setReload((value) => value + 1);
  };

  return <div className="models-page">
    <section className="panel model-workspace-intro" aria-labelledby="model-workspace-title">
      <div><span className="eyebrow">Evidence boundaries</span><h2 id="model-workspace-title">Know what is live before reading what was tested</h2><p>Serving versions and observed production health answer operational questions. Offline evaluation compares candidates under a documented test protocol.</p></div>
      <div className="model-evidence-map" aria-label="Model evidence map"><span><b>01</b> Serving bundle</span><span><b>02</b> Production health</span><span><b>03</b> Offline evaluation</span></div>
    </section>
    <TabList baseId="model-workspace" label="Model workspace" options={[{ value: "operations", label: "Serving & health" }, { value: "evaluation", label: "Offline evaluation" }]} panelId="model-workspace-panel" selected={view} onSelect={changeView} className="stage-tabs model-workspace-tabs"/>
    <div id="model-workspace-panel" role="tabpanel" aria-labelledby={tabId("model-workspace", view)}>
      {view === "operations" ? <div className="model-operations-view"><ServingModelSummary models={models} loading={descriptorLoading} error={descriptorError}/><ModelHealth fixtureMode={fixtureMode}/></div> : <>
        <TabList baseId="evaluation-stage" label="Evaluation stage" options={[{ value: "binary", label: "Detector" }, { value: "multiclass", label: "Classifier" }]} panelId="evaluation-stage-panel" selected={stage} onSelect={changeStage}/>
        <div id="evaluation-stage-panel" role="tabpanel" aria-labelledby={tabId("evaluation-stage", stage)}><ModelEvaluationView stage={stage} report={reports[stage] ?? null} loading={loading} error={error} fixtureMode={fixtureMode} onRetry={retry}/></div>
      </>}
    </div>
  </div>;
}
