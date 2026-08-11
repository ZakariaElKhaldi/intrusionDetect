import { useRef, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";

interface OperatorSignInDialogProps {
  error?: string;
  submitting?: boolean;
  retryAvailableAt?: Date | null;
  onClose: () => void;
  onSubmit: (username: string, password: string) => void | Promise<void>;
}

export function OperatorSignInDialog({ error = "", submitting = false, retryAvailableAt = null, onClose, onSubmit }: OperatorSignInDialogProps) {
  const dialog = useRef<HTMLElement>(null);
  const containFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>(
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
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void onSubmit(String(data.get("username")), String(data.get("password")));
  };

  return <div className="dialog-backdrop" role="presentation">
    <section ref={dialog} className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title" aria-describedby="auth-description" onKeyDown={containFocus}>
      <span className="eyebrow">Authorized action</span>
      <h2 id="auth-title">Operator sign in</h2>
      <p id="auth-description">Sign in to access operational evidence, live telemetry, and controls. Service availability remains visible while signed out.</p>
      <form onSubmit={submit}>
        <label>Username<input name="username" autoComplete="username" required autoFocus/></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required/></label>
        {error ? <div className="data-state data-state--error auth-error" role="alert">{error}</div> : null}
        {retryAvailableAt ? <p className="auth-retry">Attempts are temporarily paused. Try again after <time dateTime={retryAvailableAt.toISOString()}>{retryAvailableAt.toLocaleTimeString()}</time>.</p> : null}
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={submitting || Boolean(retryAvailableAt)}>{submitting ? "Signing in…" : "Sign in"}</button></div>
      </form>
    </section>
  </div>;
}
