import { Pause, Play, RefreshCw, Square } from "lucide-react";
import type { ReplayScenario, ReplayStatus } from "../../types";

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

export interface ReplayPanelProps {
  replay: ReplayStatus | null;
  scenario: ReplayScenario;
  speed: number;
  limit: number;
  error: string;
  disabled?: boolean;
  onScenario: (value: ReplayScenario) => void;
  onSpeed: (value: number) => void;
  onLimit: (value: number) => void;
  onPrimary: () => void;
  onStop: () => void;
  onRetry: () => void;
}

export function ReplayPanel({
  replay,
  scenario,
  speed,
  limit,
  error,
  disabled = false,
  onScenario,
  onSpeed,
  onLimit,
  onPrimary,
  onStop,
  onRetry,
}: ReplayPanelProps) {
  const active = replay && ["running", "paused"].includes(replay.status);
  const processed = Number.isFinite(replay?.processed) ? Number(replay?.processed) : 0;
  const total = Number.isFinite(replay?.total) ? Number(replay?.total) : 0;
  const progress = total ? Math.min(100, processed / total * 100) : 0;
  const primaryLabel = replay?.status === "running" ? "Pause replay" : replay?.status === "paused" ? "Resume replay" : "Start replay";

  return (
    <section className="panel replay-panel" aria-labelledby="replay-title" data-testid="replay-panel">
      <div className="replay-panel-copy">
        <span className="eyebrow">Dataset demonstration</span>
        <h2 id="replay-title">Replay recorded traffic</h2>
        <p>Send a bounded, reproducible scenario through the live detector and persistence pipeline.</p>
      </div>
      <div className="replay-fields">
        <label>
          <span>Scenario</span>
          <select aria-label="Replay scenario" value={scenario} onChange={(event) => onScenario(event.target.value as ReplayScenario)} disabled={Boolean(active) || disabled}>
            <option value="attack">Attack traffic</option>
            <option value="normal">Normal traffic</option>
            <option value="all">Original file order</option>
            <optgroup label="Exact attack family">
              {attackFamilies.map((family) => <option value={`class:${family}`} key={family}>{family}</option>)}
            </optgroup>
          </select>
        </label>
        <label>
          <span>Speed</span>
          <select aria-label="Replay speed" value={speed} onChange={(event) => onSpeed(Number(event.target.value))} disabled={replay?.status === "running" || disabled}>
            <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
          </select>
        </label>
        <label>
          <span>Observation limit</span>
          <input aria-label="Replay limit" type="number" min={1} max={1000} value={limit} onChange={(event) => onLimit(Math.max(1, Math.min(1000, Number(event.target.value) || 1)))} disabled={Boolean(active) || disabled} />
        </label>
      </div>
      <div className="replay-buttons">
        <button className="primary-button" type="button" onClick={onPrimary} disabled={disabled} aria-label={primaryLabel} data-testid="replay-primary">
          {replay?.status === "running" ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}{primaryLabel}
        </button>
        {active ? <button className="secondary-button" type="button" onClick={onStop} aria-label="Stop replay"><Square aria-hidden="true" />Stop</button> : null}
        {error ? <button className="secondary-button" type="button" onClick={onRetry}><RefreshCw aria-hidden="true" />Retry status</button> : null}
      </div>
      {replay ? (
        <div className={`replay-progress replay-progress--${replay.status}`} aria-live="polite" data-replay-status={replay.status}>
          <span><b>{replay.status}</b> · {processed} of {total} observations · {replay.scenario}</span>
          <progress value={processed} max={Math.max(1, total)} aria-label="Replay progress">{progress.toFixed(0)}%</progress>
        </div>
      ) : null}
      {error ? <div className="state-message state-message--error" role="alert">{error}</div> : null}
      {disabled ? <div className="state-message" role="note">Replay is available only with a connected live API.</div> : null}
    </section>
  );
}
