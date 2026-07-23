# Implementation Roadmap

## Phase 0 — Reproducible foundation

- Create monorepo structure.
- Add Python and frontend environments.
- Add formatting, linting, tests, and Docker.
- Download the dataset and record its checksum.
- Create the canonical feature-schema document.

**Exit condition:** one command validates the dataset and prints a reproducible profile.

## Phase 1 — Machine-learning baseline

- Perform exploratory analysis.
- Build binary and multiclass targets.
- Create leakage-safe preprocessing pipelines.
- Train Logistic Regression, Decision Tree, Random Forest, and one boosting model.
- Generate the full evaluation report.
- Save model and preprocessing artifacts.

**Exit condition:** a versioned model can predict a validated observation through Python code.

## Phase 2 — Prediction API

- Build FastAPI.
- Add `/predict`, `/predict/batch`, `/models`, and health endpoints.
- Add Pydantic schema validation.
- Add model registry and artifact loading.
- Add database models for observations and alerts.

**Exit condition:** the API accepts a dataset row and stores a prediction.

## Phase 3 — Functional dashboard

- Build application shell.
- Add live overview.
- Add virtualized alert table.
- Add alert detail drawer.
- Add model comparison page.
- Add observation upload and testing.

**Exit condition:** a user can investigate a prediction from summary to raw features.

## Phase 4 — Real-time dataset replay

- Stream observations at configurable speed.
- Add WebSocket or SSE updates.
- Add pause, resume, and scenario controls.
- Measure end-to-end latency.
- Prevent disruptive UI reordering.

**Exit condition:** dataset observations appear as live alerts in the dashboard.

## Phase 5 — Explainability and behavior rules

- Add SHAP for selected alerts.
- Add global feature importance.
- Create device profile format.
- Add rule violations and severity scoring.
- Display explanation and rule evidence together.

**Exit condition:** every high-severity alert has understandable evidence.

## Phase 6 — PCAP and feature compatibility

- Generate controlled PCAP scenarios.
- Evaluate Zeek/CICFlowMeter-compatible extraction.
- Build the canonical adapter.
- Add automated schema and value checks.
- Document incompatibilities.

**Exit condition:** replayed PCAP produces model-compatible observations.

## Phase 7 — Drift and model health

- Add feature-distribution monitoring.
- Track confidence and alert-rate shifts.
- Add model-health dashboard.
- Define retraining and promotion process.

**Exit condition:** the system distinguishes pipeline health from attack alerts.

## Phase 8 — Optional edge deployment

- Select a reduced feature set.
- Export or quantize the edge candidate.
- Benchmark on Raspberry Pi.
- Forward edge alerts to the backend.
- Compare edge and central predictions.

**Exit condition:** resource use, latency, and accuracy are measured on actual hardware.

## Recommended MVP boundary

Complete Phases 0–4 first.

Phases 5–7 create a strong final academic project.

Phase 8 is an optional advanced extension and should not block the core system.
