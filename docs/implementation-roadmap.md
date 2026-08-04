# Implementation Roadmap

Status reviewed on 2026-08-04. A file or placeholder does not count as an
implemented capability; phases below are marked by observable behavior and
evidence.

## Phase 0 — Reproducible foundation: complete

- Monorepo environments, linting, tests, Docker Compose, and ordered workflow.
- Safe archive extraction with fixed archive and CSV checksums.
- Dataset manifest and canonical machine-readable schema.
- Fixture isolation: synthetic data can test contracts but cannot be promoted.

**Evidence:** `make prepare-data`, `make validate-data`, and
`data/dataset-manifest.json`.

## Phase 1 — Real-data baseline and promotion: complete

- Binary and attack-only multiclass targets.
- Leakage-safe preprocessing and duplicate-flow isolation.
- Logistic Regression, Decision Tree, Random Forest, and
  HistGradientBoosting over three seeds.
- Class metrics, confusion matrices, compact PR curves, local operational
  measurements, metadata, and checksums.
- Atomic champion promotion and strict production verification.

**Evidence:** `models/production/` and `make verify-model`.

## Phase 2 — Prediction service: complete for the prototype

- `/predict`, `/predict/batch`, `/models`, `/health`, alerts, and feedback.
- Exact Pydantic observation validation.
- Binary detector followed by attack-family classification only for attacks.
- SQLite locally and PostgreSQL in Docker Compose.
- Persisted observations, predictions, stage scores/latencies, alerts, model
  versions, and analyst feedback.

**Boundary:** no authentication, authorization, retention policy, migration
framework, job queue, or production hardening yet.

## Phase 3 — Investigation dashboard: complete for the prototype

- Live overview, alert workspace and detail drawer, model analysis,
  observation upload, and topology view.
- Purpose-specific ECharts and Cytoscape/fcose topology rendering.
- Connection state, data freshness, cascade metadata, and explicit
  uncalibrated-score language.
- Authoritative alert-event handling without manufacturing alerts from normal
  prediction events.

**Boundary:** the topology is inferred from available route labels/ports; the
dataset does not provide verified device identities or IP addresses.

## Phase 4 — Dataset replay: functional, evaluation incomplete

Implemented:

- lazy server-side CSV iteration;
- all/normal/attack/exact-class filters, offset, limit, speed, pause/resume/stop;
- bounded real-data replay from the dashboard;
- `prediction.created` for every observation and `alert.created` for attacks;
- end-to-end latency captured per prediction; and
- stable alert handling while analysts inspect the interface.

Still required:

- a formal sustained-load and end-to-end p95 report;
- replay completion/status polling in the dashboard;
- explicit backpressure and failure-recovery behavior; and
- tests at production-scale concurrency.

## Phase 5 — Explainability and behavior policy: not complete

Current code ranks raw numeric magnitudes and applies score-based severity. A
minimal hook can accept a `device_profile_violation` value, but the canonical
83-feature contract does not currently supply that field. This is not SHAP,
feature attribution, MUD enforcement, or a validated behavior engine.

Next work:

- add global permutation importance for model analysis;
- add local TreeSHAP for selected alerts and label it as attribution, not proof;
- define device identity outside the model feature map;
- implement and test device behavior/MUD policy evaluation; and
- keep model evidence and policy evidence separate in the API and UI.

## Phase 6 — PCAP and live feature compatibility: not started

The Zeek/CICFlowMeter modules deliberately pass through mappings or raise a
compatibility error. Live capture only contains an authorization guard.

Next work:

- generate controlled PCAP scenarios;
- select an extractor based on value comparisons, not name similarity;
- implement the canonical adapter and golden-value tests;
- document units, directionality, timeouts, and unsupported fields; and
- permit only authorized capture in an isolated environment.

## Phase 7 — Model health and drift: partially complete

Completed foundations:

- versioned artifacts and active model records;
- explicit candidate-to-production promotion;
- data/model checksums and fixed training configuration; and
- prediction, latency, alert, and analyst-feedback persistence.

Missing:

- reference distributions and rolling live windows;
- missing/unseen-category telemetry;
- tested PSI, Jensen-Shannon, KS, or streaming change signals;
- a model-health API and evidence-based dashboard; and
- retraining triggers and rollback policy.

The current drift function returns `not_enough_data`; it is not a detector.

## Phase 8 — Edge experiment: optional, not started

- Select a reduced feature set only after compatibility work.
- Export or quantize a candidate.
- Measure accuracy, memory, CPU, latency, power, and throughput on actual target
  hardware.
- Compare edge and central decisions and test buffered forwarding.

## Recommended next milestone

Prioritize Phase 6 compatibility and Phase 4 end-to-end measurement before
adding more model families. The largest validity risk is domain/feature mismatch,
not lack of classifier complexity. After compatible live observations exist,
Phase 7 drift monitoring and Phase 5 behavior/explanation evidence become
meaningful.
