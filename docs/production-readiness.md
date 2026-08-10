# Production-readiness audit

This document separates implemented engineering safeguards from evidence that
still requires a real deployment environment. A green unit or browser test is
not treated as proof of detection effectiveness or operational capacity.

## Implemented and locally verified

- Authentication fails closed when enabled without an Argon2id password hash or
  a 32-byte signing secret. Mutation APIs use short-lived bearer tokens, login
  attempts are throttled, and authentication responses are marked `no-store`.
  The browser honors the server's `Retry-After` value, states when another
  attempt is allowed, and does not assume or disclose the configured username.
- Redrive and analyst-feedback audit identities are derived from the validated
  token; caller-authored identity fields are never persisted as operator
  evidence.
- The browser expires sessions at the declared token deadline, handles `401`
  responses, bounds HTTP waits, and reconnects WebSockets with capped
  exponential backoff and jitter.
- Operator dialogs contain keyboard focus, close with Escape, and return focus
  to their invoking control. Automated tests cover WCAG 2.1 A/AA Axe findings,
  keyboard operation, mobile reflow, and the authentication dialog behavior.
- React render failures are contained at the application and workspace levels.
  Recovery UI uses an accessible alert, moves focus to the retry action, keeps
  thrown details out of operator-visible copy, and resets when navigation
  changes instead of leaving the dashboard blank.
- The containerized UI uses a same-origin API/WebSocket proxy and emits CSP,
  frame, MIME-sniffing, referrer, and browser-permission headers. The backend
  container runs as UID/GID 10001 and exposes distinct liveness and readiness
  probes. Compose publishes the direct API/debug port on host loopback only;
  external browser traffic enters through the frontend gateway.
- The API rejects unapproved HTTP host headers using an explicit deployment
  allowlist. Local defaults accept only loopback/internal names; deployments
  must set `IOT_IDS_ALLOWED_HOSTS` to their ingress hostname.
- All HTTP request bodies are bounded even when `Content-Length` is absent, and
  each API process enforces a configurable live WebSocket connection ceiling.
  Capacity refusals use close code `1013` and increment a Prometheus counter.
  Browser WebSocket origins use the explicit CORS-origin allowlist, incoming
  application messages use an allowlist, and production Uvicorn caps messages
  at 64 KiB with a bounded queue and compression disabled.
- `/metrics` uses the official Prometheus Python client and exposes normalized
  route counts/latency plus database, queue, dead-letter, outbox, and live
  connection gauges without event-, user-, or device-level labels.
- Application request and authentication logs are structured JSON with
  generated request IDs and normalized route templates. The formatter uses an
  explicit field allowlist and excludes query strings, bodies, credentials,
  tokens, database URLs, and caller-provided identity values.
- The promoted RT-IoT2022 artifacts, schema, dataset checksum, calibration
  metadata, and drift reference are cryptographically bound and checked during
  preflight. Prediction responses label detector and family values with the
  exact serving artifact's calibration declaration rather than relying on
  global UI copy.
- GitHub Actions are configured with full-commit action pins and read-only
  repository permissions. The normal gate is hermetic over the tracked sample
  and model bundle; a separate PostgreSQL 17 job is configured to verify
  migrations, locked claims, and concurrent redrive/claim transition ordering.
  Manual/tag release gates fetch and checksum the full corpus before running
  browser E2E and all preflight checks. They are also configured to build the
  Compose images, exercise the same-origin container route, verify non-root
  users/read-only roots, and remove the disposable database volume afterward.
- CI and release jobs audit the complete hashed backend and machine-learning
  lock exports with a pinned PyPA `pip-audit` tool, and audit the npm lockfile.
  The first Python audit identified and removed the vulnerable pytest 8.4.2
  development dependency instead of excluding development tooling.
- API, ingestion-worker, and model-health-worker startup validate runtime
  settings and refuse uninitialized or stale database schemas. Table creation
  is limited to an explicit programmatic test path; deployed services require
  `alembic upgrade head` to complete first.
- Synchronous SQLAlchemy, model-inference, validation, replay-scan, and
  model-health work on request/background paths runs outside the asyncio event
  loop. Request work uses Starlette's bounded pool; one dedicated outbox thread
  serializes its database work. Database sessions are created and consumed
  within their owning thread, chronology-sensitive health evaluation is
  serialized, and replay state changes share one control lock. A regression
  test holds inference persistence and verifies that liveness remains responsive.
- Outbox delivery commits a conditional lease before network I/O, recovers
  abandoned leases, applies capped retry delay, and finalizes only the matching
  claim token. WebSocket fan-out is concurrent and disconnects an individual
  stalled client after a configurable deadline. Operations APIs expose claimed
  and retry timing without exposing the claim token.
- Dashboard summaries use database-side counts and grouped distributions. The
  exact median reads at most two ordered scores, so the public `range=all`
  endpoint no longer materializes every persisted prediction, alert, or raw
  observation payload in application memory. Legacy alert listing also uses a
  single joined query instead of per-alert lookups.
- The backend container installs the exact committed `uv.lock` graph with
  `uv sync --locked`; local virtual environments, Node modules, test artifacts,
  and repository metadata are excluded from the Docker build context.
- The frontend runtime uses NGINX's maintained unprivileged image on port 8080;
  neither application container requires root at runtime.
- Stateless application containers use read-only root filesystems, drop all
  Linux capabilities, prohibit privilege escalation, and receive only a
  temporary `/tmp` mount. The stateful PostgreSQL service retains its required
  data-volume permissions.

## Required before an Internet-exposed or defensive production deployment

| Area | Missing authoritative evidence | Release requirement |
|---|---|---|
| Detection validity | RT-IoT2022 random-split scores do not establish performance on the target network. | Collect authorized, session-separated traffic representative of the deployment; run an untouched temporal/external evaluation and approve measured false-positive and per-family recall bounds. |
| NFStream route | No genuine labelled NFStream corpus or promoted native bundle exists. | Complete the isolated capture and label protocol, support gates, provenance checks, and offline-PCAP evaluation. Live-interface capture remains separately disabled. |
| PostgreSQL recovery | CI is configured to test migration compatibility, locked-row claim behavior, and redrive/claim serialization on disposable PostgreSQL 17, but a successful run and sustained recovery evidence remain environment-dependent. | Record the CI result plus termination-before/after-commit, outbox recovery, backup, and restore evidence against the deployed PostgreSQL topology and version. |
| Capacity | Local replay latency is not a capacity test. | Establish expected and peak flow rates; measure p50/p95 intake, queue wait, processing, end-to-end latency, backpressure, and recovery time on production-equivalent hardware. |
| Availability | Compose is a single-site demonstration. | Define SLOs, alert thresholds, rollout/rollback, database high availability, tested backups, disaster recovery, and an on-call runbook. |
| Identity | Authentication is a hardened single-admin design with process-local throttling and no revocation store. | For multiple replicas or operators, use shared throttling, managed identity/RBAC, token revocation or short-session policy, auditable account lifecycle, and centralized secrets. |
| Network security | TLS and perimeter controls are deployment concerns. | Terminate validated TLS at a trusted ingress, restrict hosts/origins and exposed ports, enable HSTS after validation, and run an authorized application/infrastructure security assessment. |
| Observability | Health, queue, outbox, drift, immutable job evidence, and a Prometheus scrape endpoint exist, but no production telemetry backend is configured. | Connect centralized logs and Prometheus-compatible storage/alerts; verify retention, clock synchronization, sensitive-data redaction, dashboards, and alert delivery. |
| Governance | Model drift never proves accuracy loss and automation is intentionally disabled. | Assign owners for feedback review, drift triage, model approval, incident response, evidence retention, and periodic effectiveness review. |

## Release gates

`make project-preflight` is the local engineering gate and the manual/tag
`Release gate` workflow is configured to reproduce it from clean environments. A deployment release
must additionally fail if any applicable row above lacks signed or otherwise
immutable evidence from the target environment. In particular, no UI label,
manifest flag, local compatibility file, or successful demo may be used to
claim NFStream compatibility or production detection effectiveness.

Security-header choices follow the [OWASP HTTP Headers][owasp-headers] and
[Content Security Policy][owasp-csp] cheat sheets. Modal behavior follows the
[W3C WAI-ARIA Authoring Practices dialog pattern][w3c-dialog]. Probe separation
follows [Kubernetes liveness and readiness semantics][k8s-probes], and the
unprivileged runtime follows [Docker's build best practices][docker-build].
Render-failure containment follows [React's Error Boundary guidance][react-errors],
and Python dependency auditing uses the [PyPA `pip-audit` contract][pip-audit].
Concurrency boundaries follow [FastAPI's guidance for blocking I/O][fastapi-async]
and [Starlette's bounded thread-pool behavior][starlette-threadpool]; session
ownership follows SQLAlchemy's [session-per-thread model][sqlalchemy-session].
Outbox semantics follow AWS's [transactional-outbox guidance][aws-outbox],
including commit-before-send, ordering, and idempotent handling of possible
duplicates. Cross-thread WebSocket scheduling uses Python's documented
[`run_coroutine_threadsafe` contract][python-asyncio].
The operations UI exposes “delivering,” lease expiry, and scheduled retry
timing directly, applying Nielsen Norman Group's [visibility-of-status and
recognition-over-recall heuristics][nng-heuristics] rather than asking an
operator to infer those states from an attempt counter.

[owasp-headers]: https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html
[owasp-csp]: https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
[w3c-dialog]: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
[k8s-probes]: https://kubernetes.io/docs/concepts/workloads/pods/probes/
[docker-build]: https://docs.docker.com/build/building/best-practices/
[react-errors]: https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary
[pip-audit]: https://github.com/pypa/pip-audit
[fastapi-async]: https://fastapi.tiangolo.com/async/
[starlette-threadpool]: https://www.starlette.io/threadpool/
[sqlalchemy-session]: https://docs.sqlalchemy.org/en/20/orm/session_basics.html#is-the-session-thread-safe-is-asyncsession-safe-to-share-in-concurrent-tasks
[aws-outbox]: https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html
[python-asyncio]: https://docs.python.org/3.11/library/asyncio-task.html#scheduling-from-other-threads
[nng-heuristics]: https://media.nngroup.com/media/articles/attachments/Heuristic_Summary1_A4_compressed.pdf
