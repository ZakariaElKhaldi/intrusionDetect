import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Gauge,
  Pause,
  Play,
  RefreshCw,
  Square,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ReplayLifecycle, ReplayScenario, ReplayStatus } from "../../types";

const attackFamilies = [
  "ARP_poisioning",
  "DDOS_Slowloris",
  "DOS_SYN_Hping",
  "Metasploit_Brute_Force_SSH",
  "NMAP_FIN_SCAN",
  "NMAP_OS_DETECTION",
  "NMAP_TCP_scan",
  "NMAP_UDP_SCAN",
  "NMAP_XMAS_TREE_SCAN",
];

export type ReplayPendingAction = "starting" | "pausing" | "resuming" | "stopping";

export interface ReplayPanelProps {
  replay: ReplayStatus | null;
  scenario: ReplayScenario;
  speed: number;
  offset: number;
  limit: number;
  error: string;
  disabled?: boolean;
  unavailableReasons?: string[];
  pendingAction?: ReplayPendingAction | null;
  initialStopReview?: boolean;
  onScenario: (value: ReplayScenario) => void;
  onSpeed: (value: number) => void;
  onOffset: (value: number) => void;
  onLimit: (value: number) => void;
  onPrimary: () => void;
  onStop: () => void;
  onRetry: () => void;
}

const lifecycleCopy: Record<ReplayLifecycle, { label: string; detail: string }> = {
  idle: { label: "Idle", detail: "No replay is currently exercising the serving path." },
  running: { label: "Running", detail: "Observations are being detected, persisted, and published to the live stream." },
  paused: { label: "Paused", detail: "No new observation will be emitted until this run resumes." },
  completed: { label: "Completed", detail: "Every matched observation in this bounded run was processed." },
  stopped: { label: "Stopped", detail: "Processed observations remain persisted; the unprocessed remainder was not emitted." },
  failed: { label: "Failed", detail: "The server ended this run before every matched observation was processed." },
};

function scenarioLabel(value: string) {
  if (value === "attack") return "All attack-labelled rows";
  if (value === "normal") return "All normal-labelled rows";
  if (value === "all") return "Original dataset order";
  if (value === "custom-upload") return "Uploaded observation batch";
  return value.startsWith("class:") ? value.slice(6).replaceAll("_", " ") : value.replaceAll("_", " ");
}

function durationUpperBound(limit: number, speed: number) {
  if (!(speed > 0) || !(limit > 0)) return "Unavailable until the values are valid";
  const seconds = limit * 0.25 / speed;
  if (seconds < 1) return `under ${Math.max(1, Math.ceil(seconds * 1000))} ms`;
  if (seconds < 60) return `about ${Math.ceil(seconds)} seconds`;
  if (seconds < 3600) return `about ${Math.ceil(seconds / 60)} minutes`;
  return `about ${(seconds / 3600).toFixed(1)} hours`;
}

export function ReplayPanel({
  replay,
  scenario,
  speed,
  offset,
  limit,
  error,
  disabled = false,
  unavailableReasons = [],
  pendingAction = null,
  initialStopReview = false,
  onScenario,
  onSpeed,
  onOffset,
  onLimit,
  onPrimary,
  onStop,
  onRetry,
}: ReplayPanelProps) {
  const speedHintId = useId();
  const offsetHintId = useId();
  const limitHintId = useId();
  const [stopReview, setStopReview] = useState(initialStopReview);
  const stopButtonRef = useRef<HTMLButtonElement>(null);
  const confirmStopRef = useRef<HTMLButtonElement>(null);
  const lifecycle = replay && typeof replay.status === "string" && replay.status in lifecycleCopy ? replay.status : null;
  const active = Boolean(lifecycle && ["running", "paused"].includes(lifecycle));
  const running = lifecycle === "running";
  const processed = Number.isFinite(replay?.processed) ? Math.max(0, Number(replay?.processed)) : 0;
  const total = Number.isFinite(replay?.total) ? Math.max(0, Number(replay?.total)) : 0;
  const remaining = Math.max(0, total - processed);
  const progress = total ? Math.min(100, processed / total * 100) : 0;
  const speedIssue = speed > 0 && speed <= 100 ? "" : "Enter a replay speed above 0 and no greater than 100×.";
  const offsetIssue = Number.isInteger(offset) && offset >= 0 ? "" : "Enter a whole dataset row of 0 or greater.";
  const limitIssue = Number.isInteger(limit) && limit >= 1 && limit <= 1_000_000 ? "" : "Enter a whole-number limit from 1 through 1,000,000.";
  const configurationValid = !speedIssue && !offsetIssue && !limitIssue;
  const blocked = disabled || Boolean(pendingAction);
  const primaryLabel = pendingAction
    ? `${pendingAction[0].toUpperCase()}${pendingAction.slice(1)} replay…`
    : running
      ? "Pause replay"
      : lifecycle === "paused"
        ? "Resume replay"
        : "Start replay";
  const canUsePrimary = !blocked && (running || configurationValid);

  useEffect(() => {
    if (!active) setStopReview(false);
  }, [active]);

  useEffect(() => {
    if (stopReview) confirmStopRef.current?.focus();
  }, [stopReview]);

  const cancelStop = () => {
    setStopReview(false);
    queueMicrotask(() => stopButtonRef.current?.focus());
  };

  return (
    <section className="panel replay-console" aria-labelledby="replay-title" data-testid="replay-panel">
      <header className="replay-console-header">
        <div className="replay-header-title">
          <h2 id="replay-title">Traffic replay</h2>
          <span>RT-IoT2022</span>
        </div>
        <div className="replay-header-controls" aria-label="Replay setup">
          <label className="replay-header-control">
            <span><Database aria-hidden="true" />Traffic</span>
            <select aria-label="Replay scenario" value={scenario} onChange={(event) => onScenario(event.target.value as ReplayScenario)} disabled={active || blocked}>
              <option value="attack">Attack-labelled traffic</option>
              <option value="normal">Normal-labelled traffic</option>
              <option value="all">Original file order</option>
              <optgroup label="Exact attack family">
                {attackFamilies.map((family) => <option value={`class:${family}`} key={family}>{family.replaceAll("_", " ")}</option>)}
              </optgroup>
            </select>
          </label>
          <label className="replay-header-control replay-header-control--speed">
            <span><Gauge aria-hidden="true" />Speed</span>
            <span className="replay-speed-input">
              <input aria-label="Replay speed" aria-invalid={Boolean(speedIssue)} aria-describedby={speedHintId} type="number" min="0.01" max="100" step="0.25" value={speed} onChange={(event) => onSpeed(Number(event.target.value))} disabled={running || blocked} />
              <b aria-hidden="true">×</b>
            </span>
            <small id={speedHintId} className={speedIssue ? "field-guidance field-guidance--error" : "field-guidance"}>{speedIssue || `${(250 / speed).toFixed(1)} ms / event`}</small>
          </label>
        </div>
      </header>

      {disabled ? (
        <div className="replay-availability" role="note">
          <AlertTriangle aria-hidden="true" />
          <div><strong>Dataset replay is unavailable</strong><p>The configuration remains visible, but no control request can be sent.</p>
            <ul>{(unavailableReasons.length ? unavailableReasons : ["A connected, ready API and validated replay dataset are required."]).map((reason) => <li key={reason}>{reason}</li>)}</ul>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="replay-status-error" role="alert">
          <div><strong>{replay ? "Replay status may be stale" : "Replay status is unavailable"}</strong><span>{error}</span>{replay ? <small>The last successful server snapshot remains visible below.</small> : null}</div>
          <button className="secondary-button" type="button" onClick={onRetry}><RefreshCw aria-hidden="true" />Retry status</button>
        </div>
      ) : null}

      <div className="replay-console-grid">
        <fieldset className="replay-configuration">
          <legend><span>Replay range</span></legend>
          <label className="replay-field">
            <span>Start at dataset row</span>
            <input aria-label="Replay offset" aria-invalid={Boolean(offsetIssue)} aria-describedby={offsetHintId} type="number" min="0" step="1" value={offset} onChange={(event) => onOffset(Number(event.target.value))} disabled={active || blocked} />
            <small id={offsetHintId} className={offsetIssue ? "field-guidance field-guidance--error" : "field-guidance"}>{offsetIssue || "Rows before this zero-based source position are skipped before scenario filtering."}</small>
          </label>
          <label className="replay-field">
            <span>Maximum observations</span>
            <input aria-label="Replay limit" aria-invalid={Boolean(limitIssue)} aria-describedby={limitHintId} type="number" min="1" max="1000000" step="1" value={limit} onChange={(event) => onLimit(Number(event.target.value))} disabled={active || blocked} />
            <small id={limitHintId} className={limitIssue ? "field-guidance field-guidance--error" : "field-guidance"}>{limitIssue || "The server may match fewer rows; the backend accepts up to 1,000,000."}</small>
          </label>
          <div className="replay-plan" aria-label="Planned replay effect">
            <div><span>Selection</span><strong>{scenarioLabel(scenario)}</strong></div>
            <div><span>Upper duration bound</span><strong>{durationUpperBound(limit, speed)}</strong></div>
            <p>Each processed row creates a persisted prediction; attack verdicts may create alerts and every result is eligible for live publication.</p>
          </div>
        </fieldset>

        <section className={`replay-run replay-run--${lifecycle ?? "unavailable"}`} aria-labelledby="replay-run-title">
          <div className="replay-run-heading">
            <div><span className="eyebrow">Server-owned state</span><h3 id="replay-run-title">Current run</h3></div>
            <span className={`replay-lifecycle replay-lifecycle--${lifecycle ?? "unavailable"}`} role="status">{replay && lifecycle ? lifecycleCopy[lifecycle].label : "Not loaded"}</span>
          </div>
          {replay && lifecycle ? <>
            <p className="replay-lifecycle-detail">{lifecycleCopy[lifecycle].detail}</p>
            <div className="replay-progress-evidence">
              <div><strong>{progress.toFixed(0)}%</strong><span>{processed.toLocaleString()} processed · {remaining.toLocaleString()} remaining</span></div>
              <progress value={processed} max={Math.max(1, total)} aria-label="Current replay progress">{progress.toFixed(0)}%</progress>
            </div>
            <dl className="replay-run-facts">
              <div><dt>Matched total</dt><dd>{total.toLocaleString()}</dd></div>
              <div><dt>Actual speed</dt><dd>{replay.speed}×</dd></div>
              <div><dt>Source mode</dt><dd>{replay.mode === "dataset" ? "Server dataset" : "Custom upload"}</dd></div>
              <div><dt>Scenario</dt><dd>{scenarioLabel(replay.scenario)}</dd></div>
              <div><dt>Dataset offset</dt><dd>{replay.offset.toLocaleString()}</dd></div>
              <div><dt>Accepted limit</dt><dd>{replay.limit == null ? "Not bounded" : replay.limit.toLocaleString()}</dd></div>
            </dl>
            {lifecycle === "failed" ? <div className="replay-run-failure" role="alert"><AlertTriangle aria-hidden="true" /><span><strong>Run ended with a server error</strong>{replay.error || "No failure reason was reported."}</span></div> : null}
            {lifecycle === "completed" ? <div className="replay-run-success"><CheckCircle2 aria-hidden="true" /><span><strong>Run receipt complete</strong>The overview refreshes persisted alert and summary evidence after completion.</span></div> : null}
          </> : <div className="replay-no-snapshot"><RefreshCw aria-hidden="true" /><strong>No server snapshot loaded</strong><span>Connect the API or retry status to distinguish idle from unavailable.</span></div>}

          <div className="replay-actions">
            <button className="primary-button" type="button" onClick={onPrimary} disabled={!canUsePrimary} aria-label={primaryLabel} data-testid="replay-primary">
              {running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}{primaryLabel}
            </button>
            {active && !stopReview ? <button ref={stopButtonRef} className="secondary-button replay-stop-button" type="button" onClick={() => setStopReview(true)} disabled={blocked}><Square aria-hidden="true" />Review stop</button> : null}
          </div>

          {active && stopReview ? <div className="replay-stop-review" role="group" aria-labelledby="replay-stop-review-title">
            <strong id="replay-stop-review-title">Stop this replay?</strong>
            <p>{processed.toLocaleString()} processed observations remain persisted. Up to {remaining.toLocaleString()} unprocessed observations will not be emitted, and this run cannot resume after stopping.</p>
            <div><button type="button" className="secondary-button" onClick={cancelStop} disabled={Boolean(pendingAction)}>Continue run</button><button ref={confirmStopRef} type="button" className="danger-button" onClick={() => { setStopReview(false); onStop(); }} disabled={Boolean(pendingAction)}>{pendingAction === "stopping" ? "Stopping replay…" : "Confirm stop"}</button></div>
          </div> : null}
        </section>
      </div>
    </section>
  );
}
