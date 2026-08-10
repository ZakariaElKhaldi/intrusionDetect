import {
  createContext,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getAuthenticationStatus, getCurrentUser, login, setApiAccessToken, setUnauthorizedHandler } from "./api";
import type { AuthSession } from "./types";

const STORAGE_KEY = "iot-ids-auth-session";

interface AuthValue {
  session: AuthSession | null;
  authenticated: boolean;
  authRequired: boolean;
  openLogin: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthValue>({
  session: null,
  authenticated: false,
  authRequired: true,
  openLogin: () => undefined,
  logout: () => undefined,
});

function storedSession(): AuthSession | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as AuthSession;
    if (!value.access_token || Date.parse(value.expires_at) <= Date.now()) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return value;
  } catch {
    window.sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(() => storedSession());
  const [authRequired, setAuthRequired] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const loginDialog = useRef<HTMLElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  const logout = useCallback(() => {
    setApiAccessToken(null);
    window.sessionStorage.removeItem(STORAGE_KEY);
    setSession(null);
  }, []);

  const openLogin = useCallback(() => {
    returnFocusTo.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setError("");
    setLoginOpen(true);
  }, []);

  const closeLogin = useCallback(() => {
    setLoginOpen(false);
    window.requestAnimationFrame(() => returnFocusTo.current?.focus());
  }, []);

  useEffect(() => {
    void getAuthenticationStatus().then((value) => setAuthRequired(value.enabled)).catch(() => undefined);
  }, []);

  useEffect(() => {
    setApiAccessToken(session?.access_token ?? null);
    setUnauthorizedHandler(() => { logout(); openLogin(); });
    if (session) {
      void getCurrentUser().catch(() => { logout(); openLogin(); });
    }
    return () => setUnauthorizedHandler(null);
  }, [logout, openLogin, session?.access_token]);

  useEffect(() => {
    if (!session) return;
    const remaining = Date.parse(session.expires_at) - Date.now();
    if (remaining <= 0) {
      logout();
      return;
    }
    const expiryTimer = window.setTimeout(logout, remaining);
    return () => window.clearTimeout(expiryTimer);
  }, [logout, session]);

  const containDialogFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeLogin();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(loginDialog.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ) ?? [])].filter((element) => !element.hidden);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    setError("");
    try {
      const next = await login(String(data.get("username")), String(data.get("password")));
      setApiAccessToken(next.access_token);
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSession(next);
      closeLogin();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign in failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const value = useMemo<AuthValue>(() => ({
    session,
    authenticated: !authRequired || Boolean(session),
    authRequired,
    openLogin,
    logout,
  }), [authRequired, logout, openLogin, session]);

  return <AuthContext.Provider value={value}>{children}{loginOpen ? <div className="dialog-backdrop" role="presentation"><section ref={loginDialog} className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title" aria-describedby="auth-description" onKeyDown={containDialogFocus}><h2 id="auth-title">Operator sign in</h2><p id="auth-description">Authentication is required for actions that change system state.</p><form onSubmit={(event) => void submit(event)}><label>Username<input name="username" autoComplete="username" required autoFocus defaultValue="admin"/></label><label>Password<input name="password" type="password" autoComplete="current-password" required/></label>{error ? <div className="data-state data-state--error" role="alert">{error}</div> : null}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={closeLogin}>Cancel</button><button type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button></div></form></section></div> : null}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  return useContext(AuthContext);
}
