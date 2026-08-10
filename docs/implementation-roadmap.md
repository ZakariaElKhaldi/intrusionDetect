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

**Boundary:** single-operator authentication protects mutations; database user
management, RBAC, retention policy, distributed brokers, and production
hardening remain outside the prototype.

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
- post-commit at-least-once publication with atomic claim leases, expired-claim
  recovery, capped retry backoff, and bounded concurrent WebSocket sends; and
- queue, worker, and outbox evidence in health and Monitor; and
- authenticated manual dead-letter redrive with dry-run eligibility evidence,
  mandatory audit reason, explicit browser confirmation, and immutable history.

**Boundary:** duplicate delivery remains possible after a send succeeds but its
publication acknowledgement is interrupted, so browser consumers deduplicate
stable event identities. There is no distributed broker or horizontally
coordinated WebSocket publisher; production security and retention remain
separate work.

## Phase 7 — NFStream-native offline PCAP path: tooling implemented, evidence gate blocked

NFStream computes the complete `nfstream-iot-v1` shape under a fingerprinted
manifest. It is intentionally distinct from `rt-iot2022-v1`. Validation/export,
deterministic IDs, invariants, manifest checks, and controlled fixtures exist.
The repository does not itself prove that a capture lab was isolated or that
manifest labels match genuine generator traffic; those claims require the
authorized external collection environment and its actual evidence files.
Training remains session-split and promotion remains checksum/support/metric
gated. Caller-authored serving approval is rejected; live capture remains disabled.

External work still required:

- run the authorized isolated capture lab and collect the required genuine
  sessions and labels;
- execute `make native-corpus` and `make native-train` on those captures; and
- install a native bundle only if every automated gate passes.

## Phase 8 — Model health and drift: implemented in shadow mode

Implemented:

- checksum-bound `drift-reference-v1` artifacts generated from the exact fit
  partition with held-out output baselines;
- calibrated Jensen-Shannon thresholds, KS tests with Benjamini-Hochberg
  correction, ranges, quantile movement, and unseen-category evidence;
- bounded 24-hour and seven-day cohort windows, persisted for 90 days;
- collecting, healthy, warning, and three-consecutive-alarm critical states;
- read-only API, WebSocket aggregate updates, health integration, and exact-value
  frontend tables; and
- strict channel/schema/model/extractor cohort isolation.

Only server-assigned, approved `live_capture` cohorts can affect deployment
health. Replay, HTTP uploads, tests, and offline PCAP observations remain
non-deployment evidence. Shadow mode is enabled by default; no drift result
re-trains, promotes, rolls back, or stops inference.

## Phase 9 — Edge experiment: optional, not started

- Select a reduced feature set only after compatibility work.
- Export or quantize a candidate.
- Measure accuracy, memory, CPU, latency, power, and throughput on actual target
  hardware.
- Compare edge and central decisions and test buffered forwarding.

## Recommended next milestone

Prioritize genuine NFStream-native capture collection and gate evaluation. The
software path is ready, but no native serving claim is valid until the required
session support and untouched-test thresholds pass. After the two-week
model-health shadow period, review observed false alarms before enabling its
readiness degradation behavior.
