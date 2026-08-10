import { Fragment, lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  FlaskConical,
  LayoutDashboard,
  Menu,
  Network,
  ShieldAlert,
} from "lucide-react";
import {
  checkHealth,
  getAlert,
  getAlerts,
  getReplayStatus,
  getDashboardSummary,
  getIngestionStatus,
  getModels,
  liveEventFromSocketMessage,
  replayAction,
  socketUrl,
  startReplay,
} from "./api";
import { sampleAlerts, sampleModels } from "./data";
import { ReplayPanel } from "./features/overview/ReplayPanel";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { Alert, AlertStatus, DashboardSummary, HealthInfo, IngestionStatus, ModelInfo, Page, ReplayScenario, ReplayStatus } from "./types";
import { pageTitles } from "./utils";
import { useAuth } from "./auth";

type SocketState = "connecting" | "live" | "offline";
const Overview = lazy(() => import("./features/overview/Overview").then((module) => ({ default: module.Overview })));
const AlertWorkspace = lazy(() => import("./features/alerts/AlertWorkspace").then((module) => ({ default: module.AlertWorkspace })));
const AlertDrawer = lazy(() => import("./features/alerts/AlertWorkspace").then((module) => ({ default: module.AlertDrawer })));
const ModelAnalysis = lazy(() => import("./features/models/ModelAnalysis").then((module) => ({ default: module.ModelAnalysis })));
const ObservationLab = lazy(() => import("./features/testing/ObservationLab").then((module) => ({ default: module.ObservationLab })));
const TopologyWorkspace = lazy(() => import("./features/topology").then((module) => ({ default: module.TopologyWorkspace })));

function isFixtureMode() {
  return new URLSearchParams(window.location.search).get("fixture") === "true";
}

const navGroups = [
  {
    label: "Monitor",
    items: [
      { page: "overview" as Page, label: "Monitor", icon: LayoutDashboard },
      { page: "alerts" as Page, label: "Triage alerts", icon: ShieldAlert },
      { page: "topology" as Page, label: "Map routes", icon: Network },
    ],
  },
  {
    label: "Investigate",
    items: [
      { page: "models" as Page, label: "Validate models", icon: BarChart3 },
      { page: "testing" as Page, label: "Test observations", icon: FlaskConical },
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
  const auth = useAuth();
  const fixtureMode = isFixtureMode();
  const [page, setPage] = useState<Page>(pageFromUrl);
  const [alerts, setAlerts] = useState<Alert[]>(fixtureMode ? sampleAlerts : []);
  const [queuedAlerts, setQueuedAlerts] = useState<Alert[]>([]);
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [models, setModels] = useState<ModelInfo[]>(fixtureMode ? sampleModels : []);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryRange, setSummaryRange] = useState<DashboardSummary["range"]>("24h");
  const [summaryError, setSummaryError] = useState("");
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [healthChecked, setHealthChecked] = useState(false);
  const [healthError, setHealthError] = useState("");
  const [ingestion, setIngestion] = useState<IngestionStatus | null>(null);
  const [ingestionLoading, setIngestionLoading] = useState(!fixtureMode);
  const [ingestionError, setIngestionError] = useState("");
  const [alertsError, setAlertsError] = useState("");
  const [modelsError, setModelsError] = useState("");
  const [socketState, setSocketState] = useState<SocketState>("connecting");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [livePredictionCount, setLivePredictionCount] = useState(0);
  const [alertsLoading, setAlertsLoading] = useState(!fixtureMode);
  const [modelsLoading, setModelsLoading] = useState(!fixtureMode);
  const [replay, setReplay] = useState<ReplayStatus | null>(null);
  const [replayError, setReplayError] = useState("");
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [replayLimit, setReplayLimit] = useState(40);
  const [replayScenario, setReplayScenario] = useState<ReplayScenario>("attack");
  const pageRef = useRef(page);
  const seenPredictions = useRef(new Set<string>());
  const lastReplayStatus = useRef<string | null>(null);

  const mergeAlerts = useCallback((current: Alert[], incoming: Alert[]) => {
    const merged = new Map(current.map((alert) => [alert.id, alert]));
    incoming.forEach((alert) => merged.set(alert.id, alert));
    return [...merged.values()].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
  }, []);

  const loadConnectedData = useCallback(async () => {
    if (fixtureMode) return;
    setAlertsLoading(true);
    setModelsLoading(true);
    setAlertsError("");
    setModelsError("");
    setHealthError("");
    const [healthResult, alertsResult, modelsResult, summaryResult] = await Promise.allSettled([checkHealth(), getAlerts(), getModels(), getDashboardSummary(summaryRange)]);
    if (healthResult.status === "fulfilled" && healthResult.value) setHealth(healthResult.value);
    else {
      setHealth(null);
      setHealthError("The API health check failed.");
    }
    setHealthChecked(true);
    if (alertsResult.status === "fulfilled") setAlerts((current) => mergeAlerts(current, alertsResult.value));
    else setAlertsError(alertsResult.reason instanceof Error ? alertsResult.reason.message : "Alerts could not be loaded.");
    if (modelsResult.status === "fulfilled") setModels(modelsResult.value);
    else setModelsError(modelsResult.reason instanceof Error ? modelsResult.reason.message : "Model descriptors could not be loaded.");
    setAlertsLoading(false);
    setModelsLoading(false);
    if (summaryResult.status === "fulfilled") { setSummary(summaryResult.value); setSummaryError(""); }
    else setSummaryError(summaryResult.reason instanceof Error ? summaryResult.reason.message : "Dashboard summary could not be loaded.");
  }, [fixtureMode, mergeAlerts, summaryRange]);

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
      setAlertsLoading(false);
      setModelsLoading(false);
      setSocketState("offline");
      return;
    }
    void loadConnectedData();
  }, [fixtureMode, loadConnectedData]);

  const loadIngestionStatus = useCallback(async () => {
    if (fixtureMode) return;
    setIngestionError("");
    try {
      setIngestion(await getIngestionStatus());
    } catch (error) {
      setIngestionError(error instanceof Error ? error.message : "Ingestion status is unavailable.");
    } finally {
      setIngestionLoading(false);
    }
  }, [fixtureMode]);

  useEffect(() => {
    if (fixtureMode) {
      setIngestionLoading(false);
      return;
    }
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      await loadIngestionStatus();
      if (!disposed) timer = window.setTimeout(poll, 5_000);
    };
    void poll();
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [fixtureMode, loadIngestionStatus]);

  const hydrateReplay = useCallback(async () => {
    if (fixtureMode) return;
    setReplayError("");
    try {
      setReplay(await getReplayStatus());
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "Replay status is unavailable.");
    }
  }, [fixtureMode]);

  useEffect(() => {
    void hydrateReplay();
  }, [hydrateReplay]);

  useEffect(() => {
    if (fixtureMode) return;
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;
    let disposed = false;
    let retryAttempt = 0;

    const scheduleReconnect = () => {
      if (disposed || retryTimer) return;
      const baseDelay = Math.min(30_000, 1_000 * (2 ** retryAttempt));
      const jitter = Math.round(baseDelay * 0.2 * Math.random());
      retryAttempt += 1;
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined;
        connect();
      }, baseDelay + jitter);
    };

    const connect = () => {
      if (disposed) return;
      setSocketState("connecting");
      try {
        socket = new WebSocket(socketUrl());
        socket.onopen = () => {
          retryAttempt = 0;
          setSocketState("live");
        };
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
          scheduleReconnect();
        };
      } catch {
        setSocketState("offline");
        scheduleReconnect();
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

  useEffect(() => {
    if (replay?.status === "completed" && lastReplayStatus.current !== "completed") {
      void getAlerts().then((incoming) => setAlerts((current) => mergeAlerts(current, incoming))).catch(() => undefined);
      void getDashboardSummary(summaryRange).then(setSummary).catch(() => undefined);
    }
    lastReplayStatus.current = replay?.status ?? null;
  }, [mergeAlerts, replay?.status, summaryRange]);

  const navigate = useCallback((nextPage: Page, params?: Record<string, string>) => {
    const search = new URLSearchParams({ view: nextPage, ...params });
    if (fixtureMode) search.set("fixture", "true");
    window.history.pushState({}, "", `${window.location.pathname}?${search.toString()}`);
    setPage(nextPage);
  }, [fixtureMode]);

  useEffect(() => {
    const [nextTitle] = pageTitles[page];
    document.title = `${nextTitle} · Sentinel`;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [page]);

  useEffect(() => {
    const labelScrollableTables = () => {
      document.querySelectorAll<HTMLElement>(".preview-scroll").forEach((region) => {
        region.tabIndex = 0;
        region.setAttribute("role", "region");
        const caption = region.querySelector("caption")?.textContent?.trim();
        region.setAttribute("aria-label", caption || "Scrollable data table");
      });
    };
    labelScrollableTables();
    const observer = new MutationObserver(labelScrollableTables);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

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
    if (!auth.authenticated) { auth.openLogin(); return; }
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
  }, [auth, fixtureMode, replay, replayLimit, replayScenario, replaySpeed]);

  const stopReplay = useCallback(async () => {
    if (!auth.authenticated) { auth.openLogin(); return; }
    setReplayError("");
    try {
      setReplay(await replayAction("stop", replaySpeed));
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "Could not stop replay.");
    }
  }, [auth, replaySpeed]);

  const openTimeBucket = useCallback(
    (start: string, bucketMinutes = 5) => {
      const from = new Date(start);
      const to = new Date(from.getTime() + bucketMinutes * 60_000);
      navigate("alerts", { from: from.toISOString(), to: to.toISOString() });
    },
    [navigate],
  );

  const sourceLabel = fixtureMode ? "Fixture data" : health?.readiness === "blocked" ? "API blocked" : health?.readiness === "degraded" ? "API degraded" : health ? "Live API" : healthChecked ? "API unavailable" : "Checking source";
  const replayReady = Boolean(health && (health.readiness === undefined || health.readiness === "ready")
    && (health.components?.dataset?.status === undefined || health.components.dataset.status === "ready")
    && (health.components?.database?.status === undefined || health.components.database.status === "ready")
    && (health.components?.bundle?.status === undefined || health.components.bundle.status === "ready"));
  const [title, subtitle] = pageTitles[page];

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
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
                    className={`nav-button ${["models", "testing"].includes(item.page) ? "nav-button--mobile-overflow" : ""}`}
                    aria-current={page === item.page ? "page" : undefined}
                    aria-label={item.label}
                    data-nav-page={item.page}
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
          <details className="mobile-more">
            <summary><Menu aria-hidden="true" /><span>More</span></summary>
            <div className="mobile-more-menu">
              <button type="button" onClick={() => navigate("models")} data-nav-page="models">Validate models</button>
              <button type="button" onClick={() => navigate("testing")} data-nav-page="testing">Test observations</button>
            </div>
          </details>
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
            {auth.session ? <div className="operator-session"><span>Signed in as <b>{auth.session.username}</b></span><button className="text-button" type="button" onClick={auth.logout}>Sign out</button></div> : auth.authRequired ? <button className="secondary-button" type="button" onClick={auth.openLogin}>Operator sign in</button> : <span className="operator-session">Local mutations enabled</span>}
            <div className="system-status">
              <span
                className={`status-mark status-mark--${health ? socketState : "offline"}`}
                aria-hidden="true"
              />
              <span>
                <b>{fixtureMode ? "Fixture preview" : health?.readiness === "blocked" ? "Backend blocked" : health?.readiness === "degraded" ? "Backend degraded" : health && socketState === "live" ? "Live stream connected" : health ? "API connected" : healthChecked ? "Backend offline" : "Connecting"}</b>
                <small>{sourceLabel} · stream {socketState}</small>
              </span>
            </div>
          </div>
        </header>

        <main id="main-content" tabIndex={-1}>
          {!fixtureMode && healthChecked && !health ? (
            <div className="offline-notice" role="alert" data-state="offline">
              <span>Backend unavailable. No fixture records are mixed into this connected workspace.</span>
              <button className="secondary-button" type="button" onClick={() => void loadConnectedData()}>Retry connection</button>
            </div>
          ) : null}
          {healthError && health ? <div className="inline-notice" role="alert">{healthError}</div> : null}
          <ErrorBoundary resetKey={page} title={`${title} workspace unavailable`}>
            <Suspense fallback={<div className="panel data-state" role="status">Loading workspace…</div>}>
            {page === "overview" ? (
            <div className="monitor-page">
              <ReplayPanel
                replay={replay}
                scenario={replayScenario}
                speed={replaySpeed}
                limit={replayLimit}
                error={replayError || replay?.error || ""}
                disabled={fixtureMode || !replayReady}
                onScenario={setReplayScenario}
                onSpeed={setReplaySpeed}
                onLimit={setReplayLimit}
                onPrimary={() => void handleReplay()}
                onStop={() => void stopReplay()}
                onRetry={() => void hydrateReplay()}
              />
              <Overview
                alerts={alerts}
                health={health}
                ingestion={ingestion}
                ingestionLoading={ingestionLoading}
                ingestionError={ingestionError}
                fixtureMode={fixtureMode}
                onRetryIngestion={() => void loadIngestionStatus()}
                socketState={socketState}
                lastUpdate={lastUpdate}
                livePredictionCount={livePredictionCount}
                summary={summary}
                summaryError={summaryError}
                summaryRange={summaryRange}
                onSummaryRange={setSummaryRange}
                alertsLoading={alertsLoading}
                alertsError={alertsError}
                onRetry={() => void loadConnectedData()}
                onOpenAlert={openAlert}
                onTimeBucket={openTimeBucket}
              />
            </div>
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
              loading={alertsLoading}
              error={alertsError}
              onRetry={() => void loadConnectedData()}
              fixtureMode={fixtureMode}
            />
          ) : null}
          {page === "topology" ? (
            <TopologyWorkspace
              alerts={alerts}
              onViewAlerts={(endpoint) => navigate("alerts", { q: endpoint })}
            />
          ) : null}
          {page === "models" ? <ModelAnalysis models={models} fixtureMode={fixtureMode} descriptorLoading={modelsLoading} descriptorError={modelsError} /> : null}
            {page === "testing" ? <ObservationLab /> : null}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      {selectedAlert ? (
        <ErrorBoundary
          resetKey={selectedAlert.id}
          title="Alert details unavailable"
          message="The alert remains unchanged. Close this detail view and try opening it again."
          resetLabel="Close details"
          onReset={() => setSelectedAlert(null)}
        >
          <Suspense fallback={null}>
            <AlertDrawer
              alert={selectedAlert}
              onClose={() => setSelectedAlert(null)}
              onStatusChange={updateAlertStatus}
              loadExplanation={!fixtureMode}
              readOnly={fixtureMode}
            />
          </Suspense>
        </ErrorBoundary>
      ) : null}
    </div>
  );
}

export default App;
