import { createContext, type FormEvent, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
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
    if (!value.access_token || Date.parse(value.expires_at) <= Date.now()) return null;
    return value;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(() => storedSession());
  const [authRequired, setAuthRequired] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const logout = () => {
    setApiAccessToken(null);
    window.sessionStorage.removeItem(STORAGE_KEY);
    setSession(null);
  };

  useEffect(() => {
    void getAuthenticationStatus().then((value) => setAuthRequired(value.enabled)).catch(() => undefined);
  }, []);

  useEffect(() => {
    setApiAccessToken(session?.access_token ?? null);
    setUnauthorizedHandler(() => { logout(); setLoginOpen(true); });
    if (session) {
      void getCurrentUser().catch(() => { logout(); setLoginOpen(true); });
    }
    return () => setUnauthorizedHandler(null);
  }, [session?.access_token]);

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
      setLoginOpen(false);
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
    openLogin: () => { setError(""); setLoginOpen(true); },
    logout,
  }), [authRequired, session]);

  return <AuthContext.Provider value={value}>{children}{loginOpen ? <div className="dialog-backdrop" role="presentation"><section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title"><h2 id="auth-title">Operator sign in</h2><p>Authentication is required for actions that change system state.</p><form onSubmit={(event) => void submit(event)}><label>Username<input name="username" autoComplete="username" required autoFocus defaultValue="admin"/></label><label>Password<input name="password" type="password" autoComplete="current-password" required/></label>{error ? <div className="data-state data-state--error" role="alert">{error}</div> : null}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setLoginOpen(false)}>Cancel</button><button type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button></div></form></section></div> : null}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  return useContext(AuthContext);
}
