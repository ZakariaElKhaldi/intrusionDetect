import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./auth";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary
      applicationFallback
      title="The dashboard could not start"
      message="The failure was contained. Retry startup, or reload the dashboard if the problem continues."
    >
      <AuthProvider><App /></AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);
