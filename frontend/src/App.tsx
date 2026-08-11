import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  checkHealth,
  getAlert,
  getAlerts,
  getReplayStatus,
  getDashboardSummary,
  getIngestionStatus,
  getModels,
  isLiveConnectionMessage,
  isLivePongMessage,
  liveEventFromSocketMessage,
  replayAction,
  socketAuthenticationMessage,
  socketUrl,
  startReplay,
} from "./api";
import { sampleAlerts, sampleModels } from "./data";
import { ReplayPanel, type ReplayPendingAction } from "./features/overview/ReplayPanel";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { Alert, AlertStatus, DashboardSummary, HealthInfo, IngestionStatus, ModelInfo, Page, ReplayScenario, ReplayStatus } from "./types";
import { pageTitles } from "./utils";
import { useAuth } from "./auth";
import { ApplicationShell, type ShellSocketState } from "./features/shell/ApplicationShell";

const Overview = lazy(() => import("./features/overview/Overview").then((module) => ({ default: module.Overview })));
const OverviewOperations = lazy(() => import("./features/overview/OverviewOperations").then((module) => ({ default: module.OverviewOperations })));
const AlertWorkspace = lazy(() => import("./features/alerts/AlertWorkspace").then((module) => ({ default: module.AlertWorkspace })));
const AlertDrawer = lazy(() => import("./features/alerts/AlertInvestigationDrawer").then((module) => ({ default: module.AlertDrawer })));
const ModelAnalysis = lazy(() => import("./features/models/ModelAnalysis").then((module) => ({ default: module.ModelAnalysis })));
const ObservationLab = lazy(() => import("./features/testing/ObservationLab").then((module) => ({ default: module.ObservationLab })));
const TopologyWorkspace = lazy(() => import("./features/topology").then((module) => ({ default: module.TopologyWorkspace })));

function isFixtureMode() {
  return new URLSearchParams(window.location.search).get("fixture") === "true";
}

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
  const [summaryLoading, setSummaryLoading] = useState(!fixtureMode);
  const [summaryError, setSummaryError] = useState("");
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [healthChecked, setHealthChecked] = useState(false);
  const [healthError, setHealthError] = useState("");
  const [ingestion, setIngestion] = useState<IngestionStatus | null>(null);
  const [ingestionLoading, setIngestionLoading] = useState(!fixtureMode);
  const [ingestionError, setIngestionError] = useState("");
  const [alertsError, setAlertsError] = useState("");
  const [modelsError, setModelsError] = useState("");
  const [socketState, setSocketState] = useState<ShellSocketState>("connecting");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [livePredictionCount, setLivePredictionCount] = useState(0);
  const [alertsLoading, setAlertsLoading] = useState(!fixtureMode);
  const [modelsLoading, setModelsLoading] = useState(!fixtureMode);
  const [replay, setReplay] = useState<ReplayStatus | null>(null);
  const [replayError, setReplayError] = useState("");
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [replayOffset, setReplayOffset] = useState(0);
  const [replayLimit, setReplayLimit] = useState(40);
  const [replayScenario, setReplayScenario] = useState<ReplayScenario>("attack");
  const [replayPendingAction, setReplayPendingAction] = useState<ReplayPendingAction | null>(null);
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
    const healthResult = await checkHealth();
    if (healthResult) setHealth(healthResult);
    else {
      setHealth(null);
      setHealthError("The API health check failed.");
    }
    setHealthChecked(true);
    if (!auth.authenticated) {
      setAlertsLoading(false);
      setModelsLoading(false);
      return;
    }
    const [alertsResult, modelsResult] = await Promise.allSettled([getAlerts(), getModels()]);
    if (alertsResult.status === "fulfilled") setAlerts((current) => mergeAlerts(current, alertsResult.value));
    else setAlertsError(alertsResult.reason instanceof Error ? alertsResult.reason.message : "Alerts could not be loaded.");
    if (modelsResult.status === "fulfilled") setModels(modelsResult.value);
    else setModelsError(modelsResult.reason instanceof Error ? modelsResult.reason.message : "Model descriptors could not be loaded.");
    setAlertsLoading(false);
    setModelsLoading(false);
  }, [auth.authenticated, fixtureMode, mergeAlerts]);

  const loadSummary = useCallback(async () => {
    if (fixtureMode || !auth.authenticated) return;
    setSummaryLoading(true);
    setSummaryError("");
    try {
      setSummary(await getDashboardSummary(summaryRange));
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : "Dashboard summary could not be loaded.");
    } finally {
      setSummaryLoading(false);
    }
  }, [auth.authenticated, fixtureMode, summaryRange]);

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

  useEffect(() => {
    if (fixtureMode) {
      setSummaryLoading(false);
      return;
    }
    void loadSummary();
  }, [fixtureMode, loadSummary]);

  const loadIngestionStatus = useCallback(async () => {
    if (fixtureMode || !auth.authenticated) return;
    setIngestionError("");
    try {
      setIngestion(await getIngestionStatus());
    } catch (error) {
      setIngestionError(error instanceof Error ? error.message : "Ingestion status is unavailable.");
    } finally {
      setIngestionLoading(false);
    }
  }, [auth.authenticated, fixtureMode]);

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
    if (fixtureMode || !auth.authenticated) return;
    setReplayError("");
    try {
      setReplay(await getReplayStatus());
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "Replay status is unavailable.");
    }
  }, [auth.authenticated, fixtureMode]);

  useEffect(() => {
    void hydrateReplay();
  }, [hydrateReplay]);

  useEffect(() => {
    if (fixtureMode || !auth.authenticated) {
      setSocketState("offline");
      return;
    }
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;
    let heartbeatTimer: number | undefined;
    let pongTimer: number | undefined;
    let disposed = false;
    let retryAttempt = 0;

    const clearHeartbeat = () => {
      if (heartbeatTimer) window.clearTimeout(heartbeatTimer);
      if (pongTimer) window.clearTimeout(pongTimer);
      heartbeatTimer = undefined;
      pongTimer = undefined;
    };

    const scheduleHeartbeat = () => {
      clearHeartbeat();
      heartbeatTimer = window.setTimeout(() => {
        heartbeatTimer = undefined;
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        socket.send("ping");
        pongTimer = window.setTimeout(() => {
          pongTimer = undefined;
          socket?.close(4000, "heartbeat timeout");
        }, 10_000);
      }, 25_000);
    };

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
          const authentication = socketAuthenticationMessage();
          if (authentication) socket?.send(authentication);
        };
        socket.onmessage = (event) => {
          if (isLiveConnectionMessage(event.data)) {
            setSocketState("live");
            scheduleHeartbeat();
            return;
          }
          if (isLivePongMessage(event.data)) {
            scheduleHeartbeat();
            return;
          }
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
          clearHeartbeat();
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
      clearHeartbeat();
      socket?.close();
    };
  }, [auth.authenticated, auth.session?.access_token, fixtureMode]);

  useEffect(() => {
    if (fixtureMode) return;
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await getReplayStatus();
        if (disposed) return;
        setReplay(next);
        setReplayError("");
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
      void loadSummary();
    }
    lastReplayStatus.current = replay?.status ?? null;
  }, [loadSummary, mergeAlerts, replay?.status]);

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
    const action: ReplayPendingAction = !replay || ["idle", "completed", "stopped", "failed"].includes(replay.status)
      ? "starting"
      : replay.status === "running" ? "pausing" : "resuming";
    setReplayPendingAction(action);
    try {
      if (!replay || ["idle", "completed", "stopped", "failed"].includes(replay.status)) {
        setReplay(await startReplay({
          scenario: replayScenario,
          speed: replaySpeed,
          offset: replayOffset,
          limit: replayLimit,
        }));
        return;
      }
      const action = replay.status === "running" ? "pause" : "resume";
      setReplay(await replayAction(action, replaySpeed));
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "Replay request failed.");
    } finally {
      setReplayPendingAction(null);
    }
  }, [auth, fixtureMode, replay, replayLimit, replayOffset, replayScenario, replaySpeed]);

  const stopReplay = useCallback(async () => {
    if (!auth.authenticated) { auth.openLogin(); return; }
    setReplayError("");
    setReplayPendingAction("stopping");
    try {
      setReplay(await replayAction("stop", replaySpeed));
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "Could not stop replay.");
    } finally {
      setReplayPendingAction(null);
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

  const replayReady = Boolean(health && (health.readiness === undefined || health.readiness === "ready")
    && (health.components?.dataset?.status === undefined || health.components.dataset.status === "ready")
    && (health.components?.database?.status === undefined || health.components.database.status === "ready")
    && (health.components?.bundle?.status === undefined || health.components.bundle.status === "ready"));
  const replayUnavailableReasons = fixtureMode
    ? ["Fixture preview is read-only and does not send replay mutations."]
    : !healthChecked
      ? ["API readiness is still being checked."]
      : !health
        ? ["The API health endpoint is unavailable."]
        : [
          health.readiness && health.readiness !== "ready" ? `API readiness is ${health.readiness}.` : "",
          ...(["dataset", "database", "bundle"] as const).map((name) => {
            const component = health.components?.[name];
            return component && component.status !== "ready"
              ? `${name[0].toUpperCase()}${name.slice(1)} is ${component.status}${component.reason ? `: ${component.reason}` : "."}`
              : "";
          }),
        ].filter(Boolean);
  const [title] = pageTitles[page];

  return (
    <ApplicationShell
      page={page}
      fixtureMode={fixtureMode}
      health={health}
      healthChecked={healthChecked}
      socketState={socketState}
      queuedAlertCount={queuedAlerts.length}
      session={auth.session}
      authRequired={auth.authRequired}
      onNavigate={navigate}
      onSignIn={auth.openLogin}
      onSignOut={auth.logout}
    >
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
                offset={replayOffset}
                limit={replayLimit}
                error={replayError}
                disabled={fixtureMode || !replayReady}
                unavailableReasons={replayUnavailableReasons}
                pendingAction={replayPendingAction}
                onScenario={setReplayScenario}
                onSpeed={setReplaySpeed}
                onOffset={setReplayOffset}
                onLimit={setReplayLimit}
                onPrimary={() => void handleReplay()}
                onStop={() => void stopReplay()}
                onRetry={() => void hydrateReplay()}
              />
              <Overview
                alerts={alerts}
                fixtureMode={fixtureMode}
                socketState={socketState}
                lastUpdate={lastUpdate}
                livePredictionCount={livePredictionCount}
                summary={summary}
                summaryLoading={summaryLoading}
                summaryError={summaryError}
                summaryRange={summaryRange}
                onSummaryRange={setSummaryRange}
                onRetrySummary={() => void loadSummary()}
                alertsLoading={alertsLoading}
                alertsError={alertsError}
                onRetry={() => void loadConnectedData()}
                onOpenAlert={openAlert}
                onTimeBucket={openTimeBucket}
                onViewAlertQueue={() => navigate("alerts")}
              />
              <OverviewOperations
                health={health}
                ingestion={ingestion}
                ingestionLoading={ingestionLoading}
                ingestionError={ingestionError}
                fixtureMode={fixtureMode}
                socketState={socketState}
                lastUpdate={lastUpdate}
                onRetryIngestion={() => void loadIngestionStatus()}
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
              loading={alertsLoading}
              error={alertsError}
              onRetry={() => void loadConnectedData()}
              fixtureMode={fixtureMode}
              onViewAlerts={(endpoint) => navigate("alerts", { q: endpoint })}
            />
          ) : null}
          {page === "models" ? <ModelAnalysis models={models} fixtureMode={fixtureMode} descriptorLoading={modelsLoading} descriptorError={modelsError} /> : null}
            {page === "testing" ? <ObservationLab fixtureMode={fixtureMode} /> : null}
            </Suspense>
          </ErrorBoundary>
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
    </ApplicationShell>
  );
}

export default App;
