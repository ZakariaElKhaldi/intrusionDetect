import { useEffect, useState } from "react";
import { getModelHealth, getModelHealthCohorts, getModelHealthHistory } from "../../api";
import type { ModelHealthCohort, ModelHealthHistory, ModelHealthSnapshot } from "../../types";
import { ModelHealthView, type ModelHealthWindow } from "./ModelHealthView";

export function ModelHealth({ fixtureMode }: { fixtureMode: boolean }) {
  const [windowName, setWindowName] = useState<ModelHealthWindow>("fast");
  const [cohorts, setCohorts] = useState<ModelHealthCohort[]>([]);
  const [cohortIndex, setCohortIndex] = useState("");
  const [snapshot, setSnapshot] = useState<ModelHealthSnapshot | null>(null);
  const [history, setHistory] = useState<ModelHealthHistory | null>(null);
  const [loading, setLoading] = useState(!fixtureMode);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const selected = cohortIndex === "" ? null : cohorts[Number(cohortIndex)] ?? null;

  useEffect(() => {
    if (fixtureMode) return;
    void getModelHealthCohorts().then(setCohorts).catch(() => undefined);
  }, [fixtureMode]);

  useEffect(() => {
    if (fixtureMode) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    const filters = {
      window: windowName,
      source: selected?.ingestion_channel,
      extractor_fingerprint: selected?.extractor_fingerprint ?? undefined,
      schema_version: selected?.schema_version,
      model_version: selected?.model_version,
    };
    let timer: number | undefined;
    void Promise.all([getModelHealth(filters), getModelHealthHistory({ ...filters, limit: 50 })]).then(([next, nextHistory]) => {
      if (!cancelled) { setSnapshot(next); setHistory(nextHistory); }
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Model-health evidence is unavailable.");
    }).finally(() => {
      if (!cancelled) { setLoading(false); timer = window.setTimeout(() => setRefresh((value) => value + 1), 30_000); }
    });
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [cohortIndex, cohorts, fixtureMode, refresh, selected, windowName]);

  return (
    <ModelHealthView
      fixtureMode={fixtureMode}
      windowName={windowName}
      cohorts={cohorts}
      cohortIndex={cohortIndex}
      snapshot={snapshot}
      history={history}
      loading={loading}
      error={error}
      onWindowName={setWindowName}
      onCohortIndex={setCohortIndex}
    />
  );
}
