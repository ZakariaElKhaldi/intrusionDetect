import {
  createContext,
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
import { OperatorSignInDialog } from "./features/shell/OperatorSignInDialog";

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
  const fixtureMode = new URLSearchParams(window.location.search).get("fixture") === "true";
  const [session, setSession] = useState<AuthSession | null>(() => storedSession());
  const [authRequired, setAuthRequired] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [retryAvailableAt, setRetryAvailableAt] = useState<Date | null>(null);
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
    if (fixtureMode) return;
    void getAuthenticationStatus().then((value) => setAuthRequired(value.enabled)).catch(() => undefined);
  }, [fixtureMode]);

  useEffect(() => {
    if (fixtureMode) {
      setApiAccessToken(null);
      setUnauthorizedHandler(null);
      return;
    }
    setApiAccessToken(session?.access_token ?? null);
    setUnauthorizedHandler(() => { logout(); openLogin(); });
    if (session) {
      void getCurrentUser().catch(() => { logout(); openLogin(); });
    }
    return () => setUnauthorizedHandler(null);
  }, [fixtureMode, logout, openLogin, session?.access_token]);

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

  useEffect(() => {
    if (!retryAvailableAt) return;
    const remaining = retryAvailableAt.valueOf() - Date.now();
    if (remaining <= 0) {
      setRetryAvailableAt(null);
      return;
    }
    const timer = window.setTimeout(() => setRetryAvailableAt(null), remaining);
    return () => window.clearTimeout(timer);
  }, [retryAvailableAt]);

  const submit = async (username: string, password: string) => {
    setSubmitting(true);
    setError("");
    try {
      const next = await login(username, password);
      setRetryAvailableAt(null);
      setApiAccessToken(next.access_token);
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSession(next);
      closeLogin();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign in failed.");
      if (
        reason && typeof reason === "object"
        && "status" in reason && reason.status === 429
        && "retryAfterSeconds" in reason
        && typeof reason.retryAfterSeconds === "number"
      ) {
        setRetryAvailableAt(new Date(Date.now() + reason.retryAfterSeconds * 1_000));
      }
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

  return <AuthContext.Provider value={value}>{children}{loginOpen ? <OperatorSignInDialog error={error} submitting={submitting} retryAvailableAt={retryAvailableAt} onClose={closeLogin} onSubmit={submit}/> : null}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  return useContext(AuthContext);
}
