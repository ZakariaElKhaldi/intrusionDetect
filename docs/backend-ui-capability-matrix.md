# Backend-to-UI capability matrix

This matrix is the authoritative inventory for the requirement that the
operator frontend use every applicable backend capability. API routes are
available both at their listed path and under `/api/v1`; the browser uses the
versioned prefix.

Authentication bootstrap (`GET /auth/status`, `POST /auth/login`) and machine
probes remain public. When authentication is enabled, every other `Covered`
HTTP capability is protected by the backend's shared bearer dependency, except
the machine-owned Suricata ingestion route, which uses a separate sensor token. The
live WebSocket sends its bearer credential as the first application message
and is not marked live until the server acknowledges authentication; bearer
credentials are never placed in its URL.

“Machine-owned” and “server-owned” do not mean forgotten. They identify routes
whose semantics would become misleading or unsafe if represented as ordinary
browser controls.

| Backend capability | Frontend integration | Operator affordance | Coverage |
|---|---|---|---|
| `GET /health` | `checkHealth` | Global connection state, overview serving-path evidence, component reasons, replay readiness | Covered |
| `GET /auth/status` | `getAuthenticationStatus` | Distinguishes required sign-in from explicitly enabled local mutations in the shared shell | Covered |
| `POST /auth/login` | `login` | Accessible operator sign-in dialog with ready, pending, failure, and server-declared retry timing states | Covered |
| `GET /auth/me` | `getCurrentUser` | Validates the stored session; signed-in identity and exact local expiry time remain visible in the shell | Covered |
| `POST /predict` | `predict` | Observation Lab local 83-feature preflight, focused preview, and immediate analysis for one valid row | Covered |
| `POST /predict/batch` | `predict` | Observation Lab immediate analysis for 2–10,000 locally validated rows with exact result review | Covered |
| `GET /alerts` | `getAlerts` | Initial/replay-completion synchronization; the paged route owns queue browsing; retained as a compatibility path | Covered |
| `GET /alerts/page` | `getAlertsPage` | Search, severity, status, family, relative/custom time filters, pagination | Covered |
| `GET /alerts/{alert_id}` | `getAlert` | Refreshes exact alert detail; investigation exposes event, cascade, route, capture, interface, extractor, feature, model, latency, and feedback evidence | Covered |
| `GET /alerts/{alert_id}/explanation` | `getAlertExplanation` | Retryable stage-aware explanation with interpretation boundary, additive check, summarized waterfall, and every exact signed contribution | Covered |
| `POST /alerts/{alert_id}/feedback` | `submitAlertFeedback` | All backend disposition states, authenticated identity, required reasoning for terminal decisions, review/confirmation, and visible immutable history | Covered |
| `GET /dashboard/summary` | `getDashboardSummary` | Independently loaded persisted range on alert observation time, with exact provenance/window, reconciled totals, model families plus sensor signatures, unified protocols, D3 severity chronology, exact actionable interval table, WebSocket-triggered refresh, stale preservation, and retry | Covered |
| `GET /models` | `getModels` | Runtime detector/classifier identity, active state, schema, calibration meaning, and artifact registration | Covered |
| `GET /evaluation` | `getEvaluation` | Protocol-first detector/classifier workspace with split/seeds, validation selection, held-out test, latency, support, threshold, and cascade evidence | Covered |
| `POST /replay/start` (dataset) | `startReplay` | Exact scenario/family, zero-based pre-filter source offset, 1–1,000,000 row bound, 0.01–100× speed, duration/persistence preview, pending state, and accepted server receipt | Covered |
| `POST /replay/start` (custom) | `startCustomReplay` | Observation Lab replay of up to 100,000 validated uploaded rows at an explicit 0.01–100× speed | Covered |
| `GET /replay/status` | `getReplayStatus` | Server-owned lifecycle, mode, accepted selection/window/speed, exact progress, terminal evidence, stale-snapshot preservation, and retry | Covered |
| `POST /replay/pause` | `replayAction` | Authenticated pause with pending-command protection and explicit paused effect | Covered |
| `POST /replay/resume` | `replayAction` | Authenticated resume with validated 0.01–100× speed adjustment | Covered |
| `POST /replay/stop` | `replayAction` | Focus-managed consequence review that preserves processed-record evidence and quantifies the abandoned remainder | Covered |
| `POST /ingestion/events` | `enqueueObservations` | Observation Lab durable queue mode for up to 1,000 validated rows with batch/event receipt and recovery handoff | Covered |
| `GET /ingestion/status` | `getIngestionStatus` | Queue, throughput, retries, dead letters, worker and outbox status | Covered |
| `GET /ingestion/jobs` | `getIngestionJobs` | State, state-specific lease/availability timing, attempts, error, source, creation range, cursor pagination | Covered |
| `GET /ingestion/events/{event_id}` | `getIngestionEvent` | Focus-managed model route, retryability, recovery audit, and complete immutable transition evidence | Covered |
| `POST /ingestion/jobs/redrive` | `redriveIngestionJobs` | Required audit reason, read-only eligibility preview, focused confirmation, authenticated execution | Covered |
| `GET /ingestion/outbox/events` | `getOutboxEvents` | Publication state, event type, cursor pagination, lease/retry timing | Covered |
| `GET /model-health/cohorts` | `getModelHealthCohorts` | Deployment/cohort selector | Covered |
| `GET /model-health` | `getModelHealth` | Fast/slow snapshot, state/reason, trend and exact evidence | Covered |
| `GET /model-health/history` | `getModelHealthHistory` | Recent cohort history and exact checks | Covered |
| `GET /sensors/status` | `getSensorStatus` | Passive sensor heartbeat, interface, rules, packet/drop counters, accepted live alerts, and a D3 rolling packet/drop-rate chart derived from consecutive authoritative counters | Covered |
| `WS /live` | `socketUrl`, `socketAuthenticationMessage`, `isLiveConnectionMessage`, `isLivePongMessage`, `liveEventFromSocketMessage` | Authenticated connection acknowledgement, heartbeat/watchdog recovery, live prediction count, page-aware alert queue, persisted-summary refresh, last-event and stream state | Covered |
| `POST /ingestion/offline-pcap/events` | Local offline-PCAP command | Server-owned ingestion channel requiring local capture/extraction workflow | Server-owned |
| `POST /sensors/suricata/events` | EVE ingestion agent | Machine-owned authenticated EVE delivery with checkpointing and deduplication | Machine-owned |
| `GET /livez` | Container/orchestrator probe | Process liveness; not an analyst decision surface | Machine-owned |
| `GET /readyz` | Container/orchestrator probe | Traffic readiness; human component evidence comes from `/health` | Machine-owned |
| `GET /metrics` | Prometheus-compatible scraper | Telemetry backend input; relevant aggregates appear in operator workspaces | Machine-owned |

## Parameter design decisions

- Replay `interval_ms` remains a bounded 250 ms base cadence. The operator-facing
  speed control expresses the same timing concern in understandable terms and
  supports 0.01–100× custom starts and live resume changes; exposing both
  controls would create overlapping rate settings.
- Observation Lab preflight mirrors the backend's canonical feature shape and
  value constraints to provide corrective row-level feedback. It does not claim
  server acceptance: the authenticated API remains authoritative, and its exact
  error is retained in the workspace if submission fails.
- List limits are bounded product defaults with pagination. They are not exposed
  as arbitrary page-size controls because that does not add an operational task.
- Dataset replay's `limit` is an operational safety bound rather than a list
  page size, so the browser exposes the backend's full 1–1,000,000 range and an
  estimated upper duration before submission.
- The legacy list-alert route is retained for bootstrap compatibility, while
  the paged route exposes the complete investigation filter contract.
- Dashboard summaries and the loaded/live alert context are intentionally
  separate: `/dashboard/summary` owns persisted-window evidence, `/alerts`
  supplies a bounded browser cache for recent handoff, and `WS /live` supplies
  session-only activity. A range change refreshes only its owning summary.
- Exact health component evidence comes from `/health`; liveness, readiness,
  and Prometheus routes retain their machine contracts rather than being
  imitated as browser actions.
- Connected workspaces do not call protected list, evaluation, health, or
  operations routes before operator authentication. Public health remains
  visible, and each protected workspace provides an explicit sign-in handoff.
