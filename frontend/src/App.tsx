import { Fragment, lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  FlaskConical,
  LayoutDashboard,
  Network,
  Pause,
  Play,
  ShieldAlert,
  Square,
} from "lucide-react";
import {
  checkHealth,
  getAlert,
  getAlerts,
  getReplayStatus,
  getModels,
  liveEventFromSocketMessage,
  replayAction,
  socketUrl,
  startReplay,
} from "./api";
import { sampleAlerts, sampleModels } from "./data";
import type { Alert, AlertStatus, HealthInfo, ModelInfo, Page, ReplayScenario, ReplayStatus } from "./types";
import { pageTitles } from "./utils";

type SocketState = "connecting" | "live" | "offline";
const Overview = lazy(() => import("./features/overview/Overview").then((module) => ({ default: module.Overview })));
const AlertWorkspace = lazy(() => import("./features/alerts/AlertWorkspace").then((module) => ({ default: module.AlertWorkspace })));
const AlertDrawer = lazy(() => import("./features/alerts/AlertWorkspace").then((module) => ({ default: module.AlertDrawer })));
const ModelAnalysis = lazy(() => import("./features/models/ModelAnalysis").then((module) => ({ default: module.ModelAnalysis })));
const ObservationLab = lazy(() => import("./features/testing/ObservationLab").then((module) => ({ default: module.ObservationLab })));
const TopologyWorkspace = lazy(() => import("./features/topology").then((module) => ({ default: module.TopologyWorkspace })));

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

function isFixtureMode() {
  return new URLSearchParams(window.location.search).get("fixture") === "true";
}

const navGroups = [
  {
    label: "Monitor",
    items: [
      { page: "overview" as Page, label: "Overview", icon: LayoutDashboard },
      { page: "alerts" as Page, label: "Alerts", icon: ShieldAlert },
      { page: "topology" as Page, label: "Topology", icon: Network },
    ],
  },
  {
    label: "Investigate",
    items: [
      { page: "models" as Page, label: "Models", icon: BarChart3 },
      { page: "testing" as Page, label: "Observation lab", icon: FlaskConical },
    ],
  },
];

function pageFromUrl(): Page {
  const candidate = new URLSearchParams(window.location.search).get("view");
  return ["overview", "alerts", "topology", "models", "testing"].includes(candidate ?? "")
    ? (candidate as Page)
    : "overview";
}

function App() {
  const fixtureMode = isFixtureMode();
  const [page, setPage] = useState<Page>(pageFromUrl);
  const [alerts, setAlerts] = useState<Alert[]>(fixtureMode ? sampleAlerts : []);
  const [queuedAlerts, setQueuedAlerts] = useState<Alert[]>([]);
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [models, setModels] = useState<ModelInfo[]>(fixtureMode ? sampleModels : []);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [healthChecked, setHealthChecked] = useState(false);
  const [socketState, setSocketState] = useState<SocketState>("connecting");
  const [lastUpdate, setLastUpdate] = useState(() => new Date());
  const [livePredictionCount, setLivePredictionCount] = useState(0);
  const [dataLoading, setDataLoading] = useState(!fixtureMode);
  const [replay, setReplay] = useState<ReplayStatus | null>(null);
  const [replayError, setReplayError] = useState("");
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [replayLimit, setReplayLimit] = useState(40);
  const [replayScenario, setReplayScenario] = useState<ReplayScenario>("attack");
  const pageRef = useRef(page);
  const seenPredictions = useRef(new Set<string>());

  useEffect(() => {
    pageRef.current = page;
    if (page === "alerts" && queuedAlerts.length > 0) {
      setAlerts((current) => {
        const ids = new Set(current.map((alert) => alert.id));
        return [...queuedAlerts.filter((alert) => !ids.has(alert.id)), ...current];
      });
      setQueuedAlerts([]);
    }
  }, [page, queuedAlerts]);

  useEffect(() => {
    const onPopState = () => setPage(pageFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (fixtureMode) {
      setHealthChecked(true);
      setDataLoading(false);
      setSocketState("offline");
      return;
    }
    let cancelled = false;
    void Promise.allSettled([checkHealth(), getAlerts(), getModels()]).then(
      ([healthResult, alertsResult, modelsResult]) => {
        if (cancelled) return;
        if (healthResult.status === "fulfilled") setHealth(healthResult.value);
        setHealthChecked(true);
        if (alertsResult.status === "fulfilled") setAlerts(alertsResult.value);
        if (modelsResult.status === "fulfilled") setModels(modelsResult.value);
        setDataLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fixtureMode]);

  useEffect(() => {
    if (fixtureMode) return;
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      setSocketState("connecting");
      try {
        socket = new WebSocket(socketUrl());
        socket.onopen = () => setSocketState("live");
        socket.onmessage = (event) => {
          const incoming = liveEventFromSocketMessage(event.data);
          if (!incoming) return;
          if (incoming.type === "prediction.created") {
            setLastUpdate(new Date());
            if (!seenPredictions.current.has(incoming.data.prediction_id)) {
              seenPredictions.current.add(incoming.data.prediction_id);
              setLivePredictionCount((current) => current + 1);
            }
            return;
          }
          const alert = incoming.data;
          setLastUpdate(new Date(alert.timestamp));
          if (pageRef.current === "alerts") {
            setAlerts((current) => [
              alert,
              ...current.filter((item) => item.id !== alert.id),
            ]);
          } else {
            setQueuedAlerts((current) => [
              alert,
              ...current.filter((item) => item.id !== alert.id),
            ]);
          }
        };
        socket.onerror = () => setSocketState("offline");
        socket.onclose = () => {
          setSocketState("offline");
          if (!disposed) retryTimer = window.setTimeout(connect, 5_000);
        };
      } catch {
        setSocketState("offline");
      }
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [fixtureMode]);

  useEffect(() => {
    if (fixtureMode) return;
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await getReplayStatus();
        if (disposed) return;
        setReplay(next);
        if (["running", "paused"].includes(next.status)) {
          timer = window.setTimeout(poll, 500);
        }
      } catch (error) {
        if (!disposed) setReplayError(error instanceof Error ? error.message : "Could not read replay status.");
      }
    };
    if (replay && ["running", "paused"].includes(replay.status)) timer = window.setTimeout(poll, 300);
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [fixtureMode, replay?.status, replay?.processed]);

  const navigate = useCallback((nextPage: Page, params?: Record<string, string>) => {
    const search = new URLSearchParams({ view: nextPage, ...params });
    if (fixtureMode) search.set("fixture", "true");
    window.history.pushState({}, "", `${window.location.pathname}?${search.toString()}`);
    setPage(nextPage);
  }, [fixtureMode]);

  const openAlert = useCallback(async (alert: Alert) => {
    setSelectedAlert(alert);
    if (fixtureMode) return;
    try {
      const detail = await getAlert(alert.id);
      if (detail) setSelectedAlert(detail);
    } catch {
      // The table payload is still a useful offline/fixture detail view.
    }
  }, [fixtureMode]);

  const updateAlertStatus = useCallback((id: string, status: AlertStatus) => {
    setAlerts((current) =>
      current.map((alert) => (alert.id === id ? { ...alert, status } : alert)),
    );
    setSelectedAlert((current) => (current?.id === id ? { ...current, status } : current));
  }, []);

  const handleReplay = useCallback(async () => {
    if (fixtureMode) return;
    setReplayError("");
    try {
      if (!replay || ["idle", "completed", "stopped", "failed"].includes(replay.status)) {
        setReplay(await startReplay({
          scenario: replayScenario,
          speed: replaySpeed,
          limit: replayLimit,
        }));
        return;
      }
      const action = replay.status === "running" ? "pause" : "resume";
      setReplay(await replayAction(action, replaySpeed));
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "Replay request failed.");
    }
  }, [fixtureMode, replay, replayLimit, replayScenario, replaySpeed]);

  const stopReplay = useCallback(async () => {
    setReplayError("");
    try {
      setReplay(await replayAction("stop", replaySpeed));
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "Could not stop replay.");
    }
  }, [replaySpeed]);

  const openTimeBucket = useCallback(
    (start: string) => {
      const from = new Date(start);
      const to = new Date(from.getTime() + 5 * 60_000);
      navigate("alerts", { from: from.toISOString(), to: to.toISOString() });
    },
    [navigate],
  );

  const replayActive = replay && ["running", "paused"].includes(replay.status);
  const replayProgress = replay?.total ? Math.min(100, (replay.processed / replay.total) * 100) : 0;
  const sourceLabel = fixtureMode ? "Fixture data" : health ? "Live API" : healthChecked ? "API unavailable" : "Checking source";
  const [title, subtitle] = pageTitles[page];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" type="button" onClick={() => navigate("overview")}>
          <span className="brand-mark" aria-hidden="true">
            <Activity size={18} />
          </span>
          <span className="brand-copy">
            <strong>Sentinel</strong>
            <small>Network observability</small>
          </span>
        </button>

        <nav className="primary-nav" aria-label="Primary navigation">
          {navGroups.map((group) => (
            <Fragment key={group.label}>
              <div className="nav-group">{group.label}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    className="nav-button"
                    aria-current={page === item.page ? "page" : undefined}
                    type="button"
                    key={item.page}
                    onClick={() => navigate(item.page)}
                  >
                    <Icon size={17} strokeWidth={1.8} />
                    <span>{item.label}</span>
                    {item.page === "alerts" && queuedAlerts.length > 0 ? (
                      <span className="nav-count" aria-label={`${queuedAlerts.length} new alerts`}>
                        {queuedAlerts.length}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="avatar" aria-hidden="true">AN</span>
          <span><b>Analyst</b><small>Investigation workspace</small></span>
        </div>
      </aside>

      <div className="workspace">
        {fixtureMode ? <div className="fixture-badge" role="status">Fixture data · not connected evidence</div> : null}
        <header className="topbar">
          <div className="page-title">
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <div className="topbar-actions">
            <div className="replay-control">
              <label className="replay-label" htmlFor="replay-scenario">
                <i className={replay?.status === "paused" ? "paused" : ""} aria-hidden="true" /> Replay
              </label>
              <select
                id="replay-scenario"
                aria-label="Replay scenario"
                value={replayScenario}
                onChange={(event) => setReplayScenario(event.target.value as ReplayScenario)}
                disabled={Boolean(replayActive) || fixtureMode}
              >
                <option value="attack">Attack traffic</option>
                <option value="normal">Normal traffic</option>
                <option value="all">File order</option>
                <optgroup label="Exact attack family">
                  {attackFamilies.map((family) => <option value={`class:${family}`} key={family}>{family}</option>)}
                </optgroup>
              </select>
              <select
                id="replay-speed"
                aria-label="Replay speed"
                value={replaySpeed}
                onChange={(event) => setReplaySpeed(Number(event.target.value))}
                disabled={Boolean(replayActive) || fixtureMode}
              >
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
                <option value={4}>4×</option>
              </select>
              <label className="replay-limit">
                <span className="sr-only">Replay limit</span>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={replayLimit}
                  onChange={(event) => setReplayLimit(Math.max(1, Math.min(1000, Number(event.target.value) || 1)))}
                  disabled={Boolean(replayActive) || fixtureMode}
                  aria-label="Replay limit"
                />
              </label>
              <button
                className="icon-button"
                type="button"
                onClick={() => void handleReplay()}
                disabled={fixtureMode || !health}
                aria-label={replay?.status === "running" ? "Pause replay" : replay?.status === "paused" ? "Resume replay" : "Start replay"}
              >
                {replay?.status === "running" ? <Pause size={16} /> : <Play size={16} />}
              </button>
              {replayActive ? (
                <button className="icon-button" type="button" onClick={() => void stopReplay()} aria-label="Stop replay">
                  <Square size={14} />
                </button>
              ) : null}
            </div>
            <div className="system-status">
              <span
                className={`status-mark status-mark--${health ? socketState : "offline"}`}
                aria-hidden="true"
              />
              <span>
                <b>{fixtureMode ? "Fixture preview" : health ? "System connected" : healthChecked ? "Backend offline" : "Connecting"}</b>
                <small>{sourceLabel} · stream {socketState}</small>
              </span>
            </div>
          </div>
        </header>

        <main id="main-content">
          {!fixtureMode && healthChecked && !health ? (
            <div className="offline-notice" role="alert">
              Backend unavailable. No fixture records are mixed into this connected workspace.
            </div>
          ) : null}
          {dataLoading ? <div className="inline-notice" role="status">Loading connected alerts and model records…</div> : null}
          {replay ? (
            <section className={`replay-status replay-status--${replay.status}`} aria-live="polite">
              <div>
                <b>{replay.status === "completed" ? "Replay completed" : replay.status === "failed" ? "Replay failed" : `Replay ${replay.status}`}</b>
                <span>{replay.processed} / {replay.total} observations · {replay.scenario}</span>
              </div>
              <progress value={replay.processed} max={Math.max(1, replay.total)} aria-label="Replay progress">{replayProgress.toFixed(0)}%</progress>
            </section>
          ) : null}
          {(replayError || replay?.error) ? <div className="inline-notice" role="alert">{replayError || replay?.error}</div> : null}
          <Suspense fallback={<div className="panel data-state" role="status">Loading workspace…</div>}>
          {page === "overview" ? (
            <Overview
              alerts={alerts}
              health={health}
              socketState={socketState}
              lastUpdate={lastUpdate}
              livePredictionCount={livePredictionCount}
              onOpenAlert={openAlert}
              onTimeBucket={openTimeBucket}
            />
          ) : null}
          {page === "alerts" ? (
            <AlertWorkspace
              alerts={alerts}
              pending={queuedAlerts.length}
              onSelect={openAlert}
              applyPending={() => {
                setAlerts((current) => [...queuedAlerts, ...current]);
                setQueuedAlerts([]);
              }}
            />
          ) : null}
          {page === "topology" ? (
            <TopologyWorkspace
              alerts={alerts}
              onViewAlerts={(endpoint) => navigate("alerts", { q: endpoint })}
            />
          ) : null}
          {page === "models" ? <ModelAnalysis models={models} fixtureMode={fixtureMode} /> : null}
          {page === "testing" ? <ObservationLab /> : null}
          </Suspense>
        </main>
      </div>

      {selectedAlert ? (
        <Suspense fallback={null}>
          <AlertDrawer
            alert={selectedAlert}
            onClose={() => setSelectedAlert(null)}
            onStatusChange={updateAlertStatus}
            loadExplanation={!fixtureMode}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

export default App;
