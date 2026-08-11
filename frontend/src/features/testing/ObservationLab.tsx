import { useMemo, useState } from "react";
import { enqueueObservations, predict, startCustomReplay } from "../../api";
import { useAuth } from "../../auth";
import { verifiedAttackObservationCsv, verifiedNormalObservationCsv } from "../../sampleObservation";
import { parseCsv } from "../../utils";
import { ObservationLabView } from "./ObservationLabView";
import { processingModeIssue, validateObservationRows } from "./observationValidation";
import type { ObservationResponse, ProcessingMode } from "./ObservationResults";

export function ObservationLab({ fixtureMode = false }: { fixtureMode?: boolean }) {
  const auth = useAuth();
  const [rows, setRows] = useState<Record<string, string | number>[]>([]);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  const [response, setResponse] = useState<ObservationResponse>();
  const [processingMode, setProcessingMode] = useState<ProcessingMode>("immediate");
  const [completedMode, setCompletedMode] = useState<ProcessingMode | null>(null);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [loading, setLoading] = useState(false);
  const validation = useMemo(() => validateObservationRows(rows), [rows]);

  const loadText = (text: string, name: string) => {
    setError("");
    setResponse(undefined);
    setCompletedMode(null);
    try {
      const parsed = parseCsv(text);
      if (parsed.length > 100_000) {
        throw new Error(`This file contains ${parsed.length.toLocaleString()} rows. No browser processing path accepts more than 100,000 observations.`);
      }
      setRows(parsed);
      setFilename(name);
    } catch (reason) {
      setRows([]);
      setFilename("");
      setError(reason instanceof Error ? reason.message : "Could not parse the CSV.");
    }
  };

  const loadFile = async (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      setError("Choose a CSV file with a .csv extension.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("CSV must be 10 MB or smaller.");
      return;
    }
    try {
      loadText(await file.text(), file.name);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The selected file could not be read.");
    }
  };

  const run = async () => {
    const pathIssue = processingModeIssue(processingMode, rows.length);
    if (!validation.valid || !rows.length || pathIssue) return;
    if (!auth.authenticated) {
      auth.openLogin();
      return;
    }
    setLoading(true);
    setError("");
    setResponse(undefined);
    setCompletedMode(null);
    try {
      const nextResponse = processingMode === "immediate"
        ? await predict(rows)
        : processingMode === "durable"
          ? await enqueueObservations(rows)
          : await startCustomReplay(rows, replaySpeed);
      setResponse(nextResponse);
      setCompletedMode(processingMode);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Observation submission failed.");
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

  return <ObservationLabView
    rows={rows}
    filename={filename}
    validation={validation}
    processingMode={processingMode}
    replaySpeed={replaySpeed}
    loading={loading}
    error={error}
    response={response}
    completedMode={completedMode}
    fixtureMode={fixtureMode}
    onFile={(file) => void loadFile(file)}
    onLoadNormal={() => loadText(verifiedNormalObservationCsv, "rt-iot2022-line-2-normal.csv")}
    onLoadAttack={() => loadText(verifiedAttackObservationCsv, "rt-iot2022-line-12509-attack.csv")}
    onProcessingMode={setProcessingMode}
    onReplaySpeed={setReplaySpeed}
    onRun={() => void run()}
    onClear={clear}
  />;
}
