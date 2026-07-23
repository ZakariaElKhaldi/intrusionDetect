import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  FlaskConical,
  LayoutDashboard,
  Network,
  Pause,
  Play,
  ShieldAlert,
} from "lucide-react";
import {
  alertFromSocketMessage,
  checkHealth,
  getAlert,
  getAlerts,
  getModels,
  replayAction,
  socketUrl,
  startReplay,
} from "./api";
import { AlertDrawer, AlertWorkspace } from "./features/alerts/AlertWorkspace";
import { ModelAnalysis } from "./features/models/ModelAnalysis";
import { Overview } from "./features/overview/Overview";
import { ObservationLab } from "./features/testing/ObservationLab";
import { TopologyWorkspace } from "./features/topology";
import { sampleAlerts, sampleModels } from "./data";
import { savedObservationCsv } from "./sampleObservation";
import type { Alert, AlertStatus, HealthInfo, ModelInfo, Page } from "./types";
import { pageTitles, parseCsv } from "./utils";

type SocketState = "connecting" | "live" | "offline";
type ReplayState = "idle" | "running" | "paused";

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
  const [page, setPage] = useState<Page>(pageFromUrl);
  const [alerts, setAlerts] = useState<Alert[]>(sampleAlerts);
  const [queuedAlerts, setQueuedAlerts] = useState<Alert[]>([]);
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [models, setModels] = useState<ModelInfo[]>(sampleModels);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [healthChecked, setHealthChecked] = useState(false);
  const [socketState, setSocketState] = useState<SocketState>("connecting");
  const [lastUpdate, setLastUpdate] = useState(() => new Date());
  const [replayState, setReplayState] = useState<ReplayState>("idle");
  const [replaySpeed, setReplaySpeed] = useState(1);
  const pageRef = useRef(page);

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
    let cancelled = false;
    void Promise.allSettled([checkHealth(), getAlerts(), getModels()]).then(
      ([healthResult, alertsResult, modelsResult]) => {
        if (cancelled) return;
        if (healthResult.status === "fulfilled") setHealth(healthResult.value);
        setHealthChecked(true);
        if (alertsResult.status === "fulfilled" && alertsResult.value.length) {
          setAlerts(alertsResult.value);
        }
        if (modelsResult.status === "fulfilled" && modelsResult.value.length) {
          setModels(modelsResult.value);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
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
          const incoming = alertFromSocketMessage(event.data);
          if (!incoming) return;
          setLastUpdate(new Date(incoming.timestamp));
          if (pageRef.current === "alerts") {
            setAlerts((current) => [
              incoming,
              ...current.filter((item) => item.id !== incoming.id),
            ]);
          } else {
            setQueuedAlerts((current) => [
              incoming,
              ...current.filter((item) => item.id !== incoming.id),
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
  }, []);

  const navigate = useCallback((nextPage: Page, params?: Record<string, string>) => {
    const search = new URLSearchParams({ view: nextPage, ...params });
    window.history.pushState({}, "", `${window.location.pathname}?${search.toString()}`);
    setPage(nextPage);
  }, []);

  const openAlert = useCallback(async (alert: Alert) => {
    setSelectedAlert(alert);
    try {
      const detail = await getAlert(alert.id);
      if (detail) setSelectedAlert(detail);
    } catch {
      // The table payload is still a useful offline/fixture detail view.
    }
  }, []);

  const updateAlertStatus = useCallback((id: string, status: AlertStatus) => {
    setAlerts((current) =>
      current.map((alert) => (alert.id === id ? { ...alert, status } : alert)),
    );
    setSelectedAlert((current) => (current?.id === id ? { ...current, status } : current));
  }, []);

  const handleReplay = useCallback(async () => {
    if (replayState === "idle") {
      const started = await startReplay(parseCsv(savedObservationCsv), replaySpeed);
      if (started) setReplayState("running");
      return;
    }
    const action = replayState === "running" ? "pause" : "resume";
    const changed = await replayAction(action, replaySpeed);
    if (changed) setReplayState(action === "pause" ? "paused" : "running");
  }, [replaySpeed, replayState]);

  const openTimeBucket = useCallback(
    (start: string) => {
      const from = new Date(start);
      const to = new Date(from.getTime() + 5 * 60_000);
      navigate("alerts", { from: from.toISOString(), to: to.toISOString() });
    },
    [navigate],
  );

  const sourceLabel = health ? "Live API" : healthChecked ? "Fixture data" : "Checking source";
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
        <header className="topbar">
          <div className="page-title">
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <div className="topbar-actions">
            <div className="replay-control">
              <label className="replay-label" htmlFor="replay-speed">
                <i className={replayState === "paused" ? "paused" : ""} aria-hidden="true" />
                Replay
              </label>
              <select
                id="replay-speed"
                aria-label="Replay speed"
                value={replaySpeed}
                onChange={(event) => setReplaySpeed(Number(event.target.value))}
                disabled={replayState !== "idle"}
              >
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
                <option value={4}>4×</option>
              </select>
              <button
                className="icon-button"
                type="button"
                onClick={() => void handleReplay()}
                aria-label={replayState === "running" ? "Pause replay" : replayState === "paused" ? "Resume replay" : "Start replay"}
              >
                {replayState === "running" ? <Pause size={16} /> : <Play size={16} />}
              </button>
            </div>
            <div className="system-status">
              <span
                className={`status-mark status-mark--${health ? socketState : "offline"}`}
                aria-hidden="true"
              />
              <span>
                <b>{health ? "System connected" : healthChecked ? "Offline mode" : "Connecting"}</b>
                <small>{sourceLabel} · stream {socketState}</small>
              </span>
            </div>
          </div>
        </header>

        <main id="main-content">
          {healthChecked && !health ? (
            <div className="offline-notice" role="status">
              Backend unavailable. Showing representative fixture data; actions will retry against the API.
            </div>
          ) : null}
          {page === "overview" ? (
            <Overview
              alerts={alerts}
              health={health}
              socketState={socketState}
              lastUpdate={lastUpdate}
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
          {page === "models" ? <ModelAnalysis models={models} /> : null}
          {page === "testing" ? <ObservationLab /> : null}
        </main>
      </div>

      {selectedAlert ? (
        <AlertDrawer
          alert={selectedAlert}
          onClose={() => setSelectedAlert(null)}
          onStatusChange={updateAlertStatus}
        />
      ) : null}
    </div>
  );
}

export default App;
