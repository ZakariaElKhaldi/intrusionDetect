import type { MouseEvent, ReactNode } from "react";
import {
  Activity,
  BarChart3,
  FlaskConical,
  LayoutDashboard,
  Network,
  ShieldAlert,
} from "lucide-react";
import type { AuthSession, HealthInfo, Page } from "../../types";
import { pageTitles } from "../../utils";

export type ShellSocketState = "connecting" | "live" | "offline";

interface ApplicationShellProps {
  page: Page;
  fixtureMode: boolean;
  health: HealthInfo | null;
  healthChecked: boolean;
  socketState: ShellSocketState;
  queuedAlertCount: number;
  session: AuthSession | null;
  authRequired: boolean;
  onNavigate: (page: Page) => void;
  onSignIn: () => void;
  onSignOut: () => void;
  children: ReactNode;
}

const navigationGroups = [
  {
    label: "Monitor",
    items: [
      { page: "overview" as const, label: "Monitor", shortLabel: "Monitor", icon: LayoutDashboard },
      { page: "alerts" as const, label: "Triage alerts", shortLabel: "Alerts", icon: ShieldAlert },
      { page: "topology" as const, label: "Map routes", shortLabel: "Routes", icon: Network },
    ],
  },
  {
    label: "Investigate",
    items: [
      { page: "models" as const, label: "Validate models", shortLabel: "Models", icon: BarChart3 },
      { page: "testing" as const, label: "Test observations", shortLabel: "Lab", icon: FlaskConical },
    ],
  },
];

function navigationHref(page: Page, fixtureMode: boolean) {
  const search = new URLSearchParams({ view: page });
  if (fixtureMode) search.set("fixture", "true");
  return `?${search.toString()}`;
}

function SourceStatus({ fixtureMode, health, healthChecked }: Pick<ApplicationShellProps, "fixtureMode" | "health" | "healthChecked">) {
  const state = fixtureMode
    ? { label: "Fixture", detail: "Generated records", tone: "fixture" }
    : !healthChecked
      ? { label: "Checking", detail: "API evidence pending", tone: "checking" }
      : !health
        ? { label: "Unavailable", detail: "No connected evidence", tone: "offline" }
        : health.readiness === "blocked"
          ? { label: "Blocked", detail: "Serving path unavailable", tone: "blocked" }
          : health.readiness === "degraded"
            ? { label: "Degraded", detail: "Serving with exceptions", tone: "degraded" }
            : { label: "Connected", detail: "API evidence available", tone: "ready" };
  return <div className="shell-status" data-tone={state.tone}><dt>Evidence source</dt><dd><i aria-hidden="true"/><span><b>{state.label}</b><small>{state.detail}</small></span></dd></div>;
}

function StreamStatus({ fixtureMode, health, socketState }: Pick<ApplicationShellProps, "fixtureMode" | "health" | "socketState">) {
  const state = fixtureMode
    ? { label: "Disabled", detail: "Preview has no live stream", tone: "fixture" }
    : !health
      ? { label: "Unavailable", detail: "Waiting for API", tone: "offline" }
      : socketState === "live"
        ? { label: "Connected", detail: "Receiving live events", tone: "ready" }
        : socketState === "connecting"
          ? { label: "Reconnecting", detail: "Persisted views remain usable", tone: "checking" }
          : { label: "Offline", detail: "Persisted views remain usable", tone: "offline" };
  return <div className="shell-status" data-tone={state.tone}><dt>Live stream</dt><dd><i aria-hidden="true"/><span><b>{state.label}</b><small>{state.detail}</small></span></dd></div>;
}

function OperatorIdentity({ fixtureMode, session, authRequired }: Pick<ApplicationShellProps, "fixtureMode" | "session" | "authRequired">) {
  if (fixtureMode) return <><span className="avatar" aria-hidden="true">RO</span><span><b>Read-only preview</b><small>Mutations disabled</small></span></>;
  if (session) return <><span className="avatar" aria-hidden="true">{session.username.slice(0, 2).toUpperCase()}</span><span><b>{session.username}</b><small>Session ends {new Date(session.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></span></>;
  if (authRequired) return <><span className="avatar" aria-hidden="true">—</span><span><b>Signed out</b><small>Sign in for operational data</small></span></>;
  return <><span className="avatar" aria-hidden="true">LO</span><span><b>Local operator</b><small>Authentication disabled</small></span></>;
}

export function ApplicationShell({ page, fixtureMode, health, healthChecked, socketState, queuedAlertCount, session, authRequired, onNavigate, onSignIn, onSignOut, children }: ApplicationShellProps) {
  const [title, subtitle] = pageTitles[page];
  const activate = (event: MouseEvent<HTMLAnchorElement>, nextPage: Page) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(nextPage);
  };

  return <div className="app-shell">
    <aside className="sidebar" aria-label="Sentinel workspace navigation">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <a className="brand" href={navigationHref("overview", fixtureMode)} onClick={(event) => activate(event, "overview")}>
        <span className="brand-mark" aria-hidden="true"><Activity size={18}/></span>
        <span className="brand-copy"><strong>Sentinel</strong><small>Network observability</small></span>
      </a>

      <nav className="primary-nav" aria-label="Primary navigation">
        {navigationGroups.map((group) => <section className="nav-section" aria-labelledby={`nav-${group.label.toLowerCase()}`} key={group.label}>
          <h2 className="nav-group" id={`nav-${group.label.toLowerCase()}`}>{group.label}</h2>
          <ul>{group.items.map((item) => {
            const Icon = item.icon;
            return <li key={item.page}><a
              className="nav-button"
              aria-current={page === item.page ? "page" : undefined}
              aria-label={item.label}
              data-nav-page={item.page}
              href={navigationHref(item.page, fixtureMode)}
              onClick={(event) => activate(event, item.page)}
            >
              <Icon aria-hidden="true" size={17} strokeWidth={1.8}/>
              <span className="nav-label-long">{item.label}</span><span className="nav-label-short">{item.shortLabel}</span>
              {item.page === "alerts" && queuedAlertCount > 0 ? <span className="nav-count" aria-label={`${queuedAlertCount} new alerts`}>{queuedAlertCount}</span> : null}
            </a></li>;
          })}</ul>
        </section>)}
      </nav>

      <div className="sidebar-footer"><OperatorIdentity fixtureMode={fixtureMode} session={session} authRequired={authRequired}/></div>
    </aside>

    <div className="workspace">
      <header className="topbar">
        <div className="page-title"><h1>{title}</h1><p>{subtitle}</p></div>
        <div className="topbar-actions">
          <dl className="shell-status-rail" aria-live="polite">
            <SourceStatus fixtureMode={fixtureMode} health={health} healthChecked={healthChecked}/>
            <StreamStatus fixtureMode={fixtureMode} health={health} socketState={socketState}/>
          </dl>
          {fixtureMode ? <span className="operator-session">Read-only</span> : session ? <div className="operator-session"><span>Signed in as <b>{session.username}</b></span><button className="text-button" type="button" onClick={onSignOut}>Sign out</button></div> : authRequired ? <button className="secondary-button" type="button" onClick={onSignIn}>Operator sign in</button> : <span className="operator-session">Local mutations enabled</span>}
        </div>
      </header>
      {fixtureMode ? <div className="fixture-badge" role="status">Fixture data · not connected evidence</div> : null}
      <main id="main-content" tabIndex={-1}>{children}</main>
    </div>
  </div>;
}
