import { PanelHeading } from "../../components/PanelHeading";
import type { ModelInfo } from "../../types";

const roles: Array<{ role: "detector" | "classifier"; label: string; purpose: string }> = [
  { role: "detector", label: "Attack detector", purpose: "Routes traffic as normal or attack." },
  { role: "classifier", label: "Family classifier", purpose: "Names the attack family after detection." },
];

function servingModel(models: ModelInfo[], role: "detector" | "classifier") {
  const matching = models.filter((model) => model.role === role);
  return matching.find((model) => model.status === "active") ?? matching[0];
}

export function ServingModelSummary({ models, loading, error }: { models: ModelInfo[]; loading: boolean; error: string }) {
  const activeModels = roles.map((item) => ({ ...item, model: servingModel(models, item.role) }));
  const available = activeModels.filter((item) => item.model).length;

  return (
    <section className="panel serving-models" aria-labelledby="serving-models-title">
      <PanelHeading
        eyebrow="Live inference path"
        title="Serving bundle"
        description="Versions reported by the runtime model registry. Offline champions and deployment health are shown separately."
        action={<span className={`ops-state ${available === roles.length ? "ops-state--healthy" : "ops-state--warning"}`}>{available}/{roles.length} roles reported</span>}
      />
      {loading ? <div className="data-state" role="status">Loading serving model descriptors…</div> : null}
      {error ? <div className="data-state data-state--error" role="alert">Serving descriptors: {error}</div> : null}
      {!loading ? (
        <div className="serving-model-grid">
          {activeModels.map(({ role, label, purpose, model }) => (
            <article className="serving-model-card" key={role}>
              <div className="serving-model-card__heading">
                <div><span>{label}</span><h3>{model?.name ?? "Not reported"}</h3></div>
                <span className={`ops-state ${model?.status === "active" ? "ops-state--healthy" : "ops-state--warning"}`}>{model?.status ?? "missing"}</span>
              </div>
              <p>{purpose}</p>
              <dl>
                <div><dt>Version</dt><dd className="mono">{model?.version ?? "Unavailable"}</dd></div>
                <div><dt>Input schema</dt><dd className="mono">{model?.schema_version ?? "Not reported"}</dd></div>
                <div><dt>Score meaning</dt><dd>{model?.probability_calibrated ? "Calibrated probability" : "Model score"}</dd></div>
                <div><dt>Artifact</dt><dd>{model?.artifact_registered ? "Registered" : "Not reported"}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
