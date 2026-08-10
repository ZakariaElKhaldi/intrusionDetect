# Production-readiness audit

This document separates implemented engineering safeguards from evidence that
still requires a real deployment environment. A green unit or browser test is
not treated as proof of detection effectiveness or operational capacity.

## Implemented and locally verified

- Authentication fails closed when enabled without an Argon2id password hash or
  a 32-byte signing secret. Mutation APIs use short-lived bearer tokens, login
  attempts are throttled, and authentication responses are marked `no-store`.
- The browser expires sessions at the declared token deadline, handles `401`
  responses, bounds HTTP waits, and reconnects WebSockets with capped
  exponential backoff and jitter.
- Operator dialogs contain keyboard focus, close with Escape, and return focus
  to their invoking control. Automated tests cover WCAG 2.1 A/AA Axe findings,
  keyboard operation, mobile reflow, and the authentication dialog behavior.
- The containerized UI uses a same-origin API/WebSocket proxy and emits CSP,
  frame, MIME-sniffing, referrer, and browser-permission headers. The backend
  container runs as UID/GID 10001 and exposes distinct liveness and readiness
  probes.
- The promoted RT-IoT2022 artifacts, schema, dataset checksum, calibration
  metadata, and drift reference are cryptographically bound and checked during
  preflight.

## Required before an Internet-exposed or defensive production deployment

| Area | Missing authoritative evidence | Release requirement |
|---|---|---|
| Detection validity | RT-IoT2022 random-split scores do not establish performance on the target network. | Collect authorized, session-separated traffic representative of the deployment; run an untouched temporal/external evaluation and approve measured false-positive and per-family recall bounds. |
| NFStream route | No genuine labelled NFStream corpus or promoted native bundle exists. | Complete the isolated capture and label protocol, support gates, provenance checks, and offline-PCAP evaluation. Live-interface capture remains separately disabled. |
| PostgreSQL recovery | The repository contains queue and benchmark tooling, but a sustained multi-worker fault/recovery run is environment-dependent. | Record concurrent claim, termination-before/after-commit, redrive race, outbox recovery, backup, and restore evidence against the deployed PostgreSQL version. |
| Capacity | Local replay latency is not a capacity test. | Establish expected and peak flow rates; measure p50/p95 intake, queue wait, processing, end-to-end latency, backpressure, and recovery time on production-equivalent hardware. |
| Availability | Compose is a single-site demonstration. | Define SLOs, alert thresholds, rollout/rollback, database high availability, tested backups, disaster recovery, and an on-call runbook. |
| Identity | Authentication is a hardened single-admin design with process-local throttling and no revocation store. | For multiple replicas or operators, use shared throttling, managed identity/RBAC, token revocation or short-session policy, auditable account lifecycle, and centralized secrets. |
| Network security | TLS and perimeter controls are deployment concerns. | Terminate validated TLS at a trusted ingress, restrict hosts/origins and exposed ports, enable HSTS after validation, and run an authorized application/infrastructure security assessment. |
| Observability | Health, queue, outbox, drift, and immutable job evidence exist, but no production telemetry backend is configured. | Export centralized structured logs, metrics and alerts; verify retention, clock synchronization, sensitive-data redaction, dashboards, and alert delivery. |
| Governance | Model drift never proves accuracy loss and automation is intentionally disabled. | Assign owners for feedback review, drift triage, model approval, incident response, evidence retention, and periodic effectiveness review. |

## Release gates

`make project-preflight` is the local engineering gate. A deployment release
must additionally fail if any applicable row above lacks signed or otherwise
immutable evidence from the target environment. In particular, no UI label,
manifest flag, local compatibility file, or successful demo may be used to
claim NFStream compatibility or production detection effectiveness.

Security-header choices follow the [OWASP HTTP Headers][owasp-headers] and
[Content Security Policy][owasp-csp] cheat sheets. Modal behavior follows the
[W3C WAI-ARIA Authoring Practices dialog pattern][w3c-dialog]. Probe separation
follows [Kubernetes liveness and readiness semantics][k8s-probes], and the
unprivileged runtime follows [Docker's build best practices][docker-build].

[owasp-headers]: https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html
[owasp-csp]: https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
[w3c-dialog]: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
[k8s-probes]: https://kubernetes.io/docs/concepts/workloads/pods/probes/
[docker-build]: https://docs.docker.com/build/building/best-practices/
