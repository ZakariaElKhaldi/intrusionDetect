# Implementation Roadmap

Status reviewed on 2026-08-07. A file or placeholder does not count as an
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

**Boundary:** no authentication, authorization, retention policy, distributed
broker, or production hardening yet.

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

## Phase 4 — Dataset replay: complete for the prototype

Implemented:

- lazy server-side CSV iteration;
- all/normal/attack/exact-class filters, offset, limit, speed, pause/resume/stop;
- bounded real-data replay from the dashboard;
- `prediction.created` for every observation and `alert.created` for attacks;
- end-to-end latency captured per prediction;
- completion/status hydration and polling in the dashboard;
- fixed normal/attack replay benchmark evidence with throughput and p50/p95; and
- stable alert handling while analysts inspect the interface.

**Boundary:** replay is a deterministic demonstration input, not original
chronology or a production-scale concurrency benchmark.

## Phase 5 — Explainability complete; behavior policy not complete

Selected alerts have on-demand TreeSHAP detector and classifier explanations,
additivity checks, signed cumulative waterfalls, exact-value tables, model
versions, output units, and explicit non-causal wording. Score-based severity
remains separate from model attribution.

Next work:

- optionally add global permutation importance for model analysis;
- define device identity outside the model feature map;
- implement and test device behavior/MUD policy evaluation; and
- keep model evidence and policy evidence separate in the API and UI.

## Phase 6 — Durable canonical ingestion: complete for local/single-node use

- JSON and NDJSON intake for batches of 1–1,000 observations;
- durable PostgreSQL inbox with SQLite single-worker development mode;
- event-ID idempotency, queue capacity, leases, retry/dead-letter handling;
- transactional observation/prediction/alert/outbox persistence;
- post-commit event publication and restart recovery; and
- queue, worker, and outbox evidence in health and Monitor.

**Boundary:** no distributed broker or horizontally coordinated WebSocket
publisher; production security and retention remain separate work.

## Phase 7 — PCAP and live feature compatibility: extractor implemented, compatibility blocked

NFStream now computes the complete canonical shape under a fingerprinted
manifest. Validation/export, deterministic IDs, invariants, and controlled
golden fixtures exist. Zeek/CICFlowMeter fail explicitly and live capture is
disabled. Inference remains blocked because field-shape agreement does not
prove value compatibility with the training extractor.

Next work:

- obtain paired source PCAP/RT-IoT2022 rows or build newly labelled NFStream data;
- compare values, units, categorical vocabularies, and distributions;
- approve a fingerprinted compatibility-evidence record only if tests pass; and
- consider authorized live-interface capture in an isolated environment.

## Phase 8 — Model health and drift: partially complete

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

## Phase 9 — Edge experiment: optional, not started

- Select a reduced feature set only after compatibility work.
- Export or quantize a candidate.
- Measure accuracy, memory, CPU, latency, power, and throughput on actual target
  hardware.
- Compare edge and central decisions and test buffered forwarding.

## Recommended next milestone

Prioritize PCAP value-compatibility evidence before live capture or additional
model families. The largest validity risk is still domain/feature mismatch, not
lack of classifier complexity. After compatible live observations exist, drift
monitoring and behavior-policy evidence become meaningful.
