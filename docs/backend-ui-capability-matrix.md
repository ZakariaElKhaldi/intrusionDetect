# Backend-to-UI capability matrix

This matrix is the authoritative inventory for the requirement that the
operator frontend use every applicable backend capability. Public routes are
available both at their listed path and under `/api/v1`; the browser uses the
versioned prefix.

“Machine-owned” and “server-owned” do not mean forgotten. They identify routes
whose semantics would become misleading or unsafe if represented as ordinary
browser controls.

| Backend capability | Frontend integration | Operator affordance | Coverage |
|---|---|---|---|
| `GET /health` | `checkHealth` | Global connection state, overview serving-path evidence, component reasons, replay readiness | Covered |
| `GET /auth/status` | `getAuthenticationStatus` | Determines whether mutation controls require sign-in | Covered |
| `POST /auth/login` | `login` | Accessible operator sign-in dialog with retry timing | Covered |
| `GET /auth/me` | `getCurrentUser` | Validates the stored session; signed-in identity is visible in the shell | Covered |
| `POST /predict` | `predict` | Observation Lab “Analyze now” for one valid row | Covered |
| `POST /predict/batch` | `predict` | Observation Lab “Analyze now” for multiple valid rows | Covered |
| `GET /alerts` | `getAlerts` | Initial/replay-completion synchronization; the paged route owns queue browsing | Covered, compatibility path |
| `GET /alerts/page` | `getAlertsPage` | Search, severity, status, family, relative/custom time filters, pagination | Covered |
| `GET /alerts/{id}` | `getAlert` | Refreshes exact alert detail before investigation | Covered |
| `GET /alerts/{id}/explanation` | `getAlertExplanation` | Stage-aware explanation, waterfall, exact signed contributions | Covered |
| `POST /alerts/{id}/feedback` | `submitAlertFeedback` | Authenticated analyst disposition, notes, and visible history | Covered |
| `GET /dashboard/summary` | `getDashboardSummary` | Persisted range selector, metrics, distributions, and alert-time navigation | Covered |
| `GET /models` | `getModels` | Runtime detector/classifier serving bundle | Covered |
| `GET /evaluation` | `getEvaluation` | Separate detector/classifier offline evaluation workspace | Covered |
| `POST /replay/start` (dataset) | `startReplay` | Scenario/family, speed, row offset, and bounded row count | Covered |
| `POST /replay/start` (custom) | `startCustomReplay` | Observation Lab replay of validated uploaded rows | Covered |
| `GET /replay/status` | `getReplayStatus` | Progress, lifecycle, processed/total, and errors | Covered |
| `POST /replay/pause` | `replayAction` | Pause active replay | Covered |
| `POST /replay/resume` | `replayAction` | Resume with selected speed | Covered |
| `POST /replay/stop` | `replayAction` | Stop active replay | Covered |
| `POST /ingestion/events` | `enqueueObservations` | Observation Lab durable queue mode with batch/event receipt | Covered |
| `GET /ingestion/status` | `getIngestionStatus` | Queue, throughput, retries, dead letters, worker and outbox status | Covered |
| `GET /ingestion/jobs` | `getIngestionJobs` | State, error, source, creation range, cursor pagination | Covered |
| `GET /ingestion/events/{id}` | `getIngestionEvent` | Focus-managed immutable transition history | Covered |
| `POST /ingestion/jobs/redrive` | `redriveIngestionJobs` | Eligibility preview, reason, confirmation, authenticated execution | Covered |
| `GET /ingestion/outbox/events` | `getOutboxEvents` | Publication state, event type, cursor pagination, lease/retry timing | Covered |
| `GET /model-health/cohorts` | `getModelHealthCohorts` | Deployment/cohort selector | Covered |
| `GET /model-health` | `getModelHealth` | Fast/slow snapshot, state/reason, trend and exact evidence | Covered |
| `GET /model-health/history` | `getModelHealthHistory` | Recent cohort history and exact checks | Covered |
| `WS /live` | `socketUrl`, `liveEventFromSocketMessage` | Live prediction count, alert queue, last-event and stream state | Covered |
| `POST /ingestion/offline-pcap/events` | Local offline-PCAP command | Server-owned ingestion channel requiring local capture/extraction workflow | Server-owned by contract |
| `GET /livez` | Container/orchestrator probe | Process liveness; not an analyst decision surface | Machine-owned |
| `GET /readyz` | Container/orchestrator probe | Traffic readiness; human component evidence comes from `/health` | Machine-owned |
| `GET /metrics` | Prometheus-compatible scraper | Telemetry backend input; relevant aggregates appear in operator workspaces | Machine-owned |

## Parameter design decisions

- Replay `interval_ms` remains a bounded 250 ms base cadence. The operator-facing
  speed control expresses the same timing concern in understandable terms and
  supports live resume changes; exposing both controls would create overlapping
  rate settings.
- List limits are bounded product defaults with pagination. They are not exposed
  as arbitrary page-size controls because that does not add an operational task.
- The legacy list-alert route is retained for bootstrap compatibility, while
  the paged route exposes the complete investigation filter contract.
- Exact health component evidence comes from `/health`; liveness, readiness,
  and Prometheus routes retain their machine contracts rather than being
  imitated as browser actions.
