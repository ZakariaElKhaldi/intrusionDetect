import type { HealthInfo, IngestionStatus } from "../../types";
import { IngestionOperations } from "./IngestionOperations";
import { IngestionStatusPanel } from "./IngestionStatusPanel";
import { SystemHealthPanel } from "./SystemHealthPanel";

export interface OverviewOperationsProps {
  health: HealthInfo | null;
  ingestion: IngestionStatus | null;
  ingestionLoading: boolean;
  ingestionError: string;
  fixtureMode: boolean;
  socketState: "connecting" | "live" | "offline";
  lastUpdate: Date | null;
  onRetryIngestion: () => void;
}

export function OverviewOperations({ health, ingestion, ingestionLoading, ingestionError, fixtureMode, socketState, lastUpdate, onRetryIngestion }: OverviewOperationsProps) {
  return <section className="overview-operations-stack" aria-labelledby="overview-operations-title">
    <div className="overview-operations-heading"><span className="eyebrow">Serving and delivery</span><h2 id="overview-operations-title">Operations evidence</h2><p>Inspect runtime readiness, durable intake pressure, retry recovery, and publication state after reviewing the alert workload.</p></div>
    <SystemHealthPanel health={health} socketState={socketState} lastUpdate={lastUpdate} fixtureMode={fixtureMode}/>
    <IngestionStatusPanel status={ingestion} loading={ingestionLoading} error={ingestionError} fixtureMode={fixtureMode} onRetry={onRetryIngestion}/>
    <IngestionOperations fixtureMode={fixtureMode} refreshKey={ingestion?.generated_at}/>
  </section>;
}
