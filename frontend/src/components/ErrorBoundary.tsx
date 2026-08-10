import {
  Component,
  createRef,
  type ErrorInfo,
  type ReactNode,
} from "react";

type ErrorBoundaryProps = {
  children: ReactNode;
  resetKey?: string | number | null;
  title?: string;
  message?: string;
  resetLabel?: string;
  onReset?: () => void;
  applicationFallback?: boolean;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

/**
 * Keeps a render failure inside the affected UI surface. Error details stay out
 * of the operator-facing fallback because thrown values can contain sensitive
 * observation data.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };
  private readonly resetButton = createRef<HTMLButtonElement>();

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const errorName = error instanceof Error ? error.name : "UnknownThrownValue";
    console.error("Frontend render failure", {
      errorName,
      componentStack: info.componentStack,
    });
    this.resetButton.current?.focus();
  }

  componentDidUpdate(previous: ErrorBoundaryProps) {
    if (
      this.state.hasError
      && previous.resetKey !== this.props.resetKey
    ) {
      this.setState({ hasError: false });
    }
  }

  private reset = () => {
    this.setState({ hasError: false });
    this.props.onReset?.();
  };

  private reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const title = this.props.title ?? "This workspace could not be displayed";
    const message = this.props.message
      ?? "The failure was contained. Retry this view, or reload the dashboard if the problem continues.";
    const content = (
      <div className="error-boundary-copy">
        {this.props.applicationFallback ? <h1>{title}</h1> : <h2>{title}</h2>}
        <p>{message}</p>
        <div className="error-boundary-actions">
          <button
            ref={this.resetButton}
            className="primary-button"
            type="button"
            onClick={this.reset}
          >
            {this.props.resetLabel ?? "Try again"}
          </button>
          <button className="secondary-button" type="button" onClick={this.reload}>
            Reload dashboard
          </button>
        </div>
      </div>
    );

    if (this.props.applicationFallback) {
      return (
        <main className="fatal-error-boundary" id="main-content" role="alert">
          {content}
        </main>
      );
    }

    return (
      <section className="panel error-boundary" role="alert">
        {content}
      </section>
    );
  }
}
