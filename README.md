# IoT Network-Flow Intrusion Detection

A reproducible research system for durably ingesting and classifying versioned
network-flow observations, persisting predictions and alerts,
replaying recorded observations, and investigating the results in a React
dashboard.

> This is an academic prototype, not a validated production security control.

## What exists now

The implemented serving path is a two-stage cascade:

```text
          JSON or NDJSON canonical observation
                    |
                    v
       schema + extractor route validation
                    |
                    v
       durable inbox + ingestion worker
                    |
                    v
      binary detector: normal / attack
                    |
             attack only
                    v
          attack-family classifier
                    |
                    v
 SQLite/PostgreSQL + transactional outbox
                    |
                    v
    prediction.created / alert.created + React UI
```

Dataset replay and `/predict` remain synchronous compatibility paths; durable
ingestion uses the worker and transactional outbox shown above.

Implemented:

- checksum-verified dataset preparation and provenance;
- four leakage-safe scikit-learn candidates evaluated over seeds `42`, `1337`,
  and `2026`;
- attack-only second-stage classification;
- atomic, checksum-verified champion promotion;
- strict FastAPI validation, synchronous prediction compatibility endpoints,
  durable JSON/NDJSON ingestion, idempotency, retries, persistence, analyst
  feedback, and post-commit WebSocket events;
- bounded server-side dataset replay with scenario, offset, limit, pause,
  resume, and speed controls; and
- functional monitoring, alert, topology, model-evidence, and observation-lab
  views, including ingestion job/dead-letter/outbox evidence and authenticated,
  audited manual redrive;
- on-demand TreeSHAP attribution with explicit non-causal language; and
- an offline NFStream extractor with deterministic event IDs, a versioned
  `nfstream-iot-v1` contract, validation reports, corpus-provenance checks,
  session-level splitting, four-candidate training, and checksum-bound promotion
  gates;
- five-minute fast/slow model-health evaluation with calibrated reference
  artifacts, feature/output evidence, 90-day history, and shadow-mode readiness
  semantics.

Not implemented or not validated:

- a collected NFStream-native labelled corpus or promoted native model bundle;
- live network-interface capture (deliberately disabled);
- a distributed broker or horizontally coordinated WebSocket publisher;
- causal explanations, automatic drift response, destination reputation, or
  complete device/MUD policy enforcement; and
- external-network, temporal, group-aware, or hardware validation.

The system therefore monitors **validated network-flow records**, not arbitrary
application or system log text. Recorded CSV order is replay order, not a
verified chronology.

## Current measured baseline

The production bundle in [`models/production`](models/production) was trained
from the verified 123,117-row dataset. Duplicate feature rows are removed before
splitting, leaving 117,915 binary examples; the multiclass stage uses attack
rows only.

| Stage | Champion | Validation macro-F1, 3-seed mean | Seed-42 test macro-F1 | Test FPR | Serialized size |
|---|---|---:|---:|---:|---:|
| Binary detector | HistGradientBoosting | 0.9965 | 0.9955 | 0.9155% | 124,464 B |
| Attack-family classifier | Random Forest | 0.9522 | 0.9873 | N/A | 532,967 B |

The untouched shared seed-42 test partition produces a complete cascade macro-F1
of **0.9931**, with 17 detector false negatives. Across the three declared seeds,
mean cascade macro-F1 is **0.9873**. These are random-split results, not deployment
validation.

These are stratified random-split results from one dataset. The unusually high
scores are useful as a reproducible in-dataset baseline, but they are not
evidence of deployment readiness. The source table has no reliable timestamp,
capture-session, or device grouping field, so the report explicitly marks a
realistic split as unavailable. Both promoted champions use sigmoid calibration
fitted only on the validation partition; the untouched test partition remains
reserved for final evaluation.

See [`models/production/evaluation-report.json`](models/production/evaluation-report.json)
and [the evaluation protocol](docs/evaluation-protocol.md) for the exact
confusion matrices, per-class metrics, limitations, and measurement method.

## Dataset provenance

The project uses the [UCI RT-IoT2022 dataset](https://archive.ics.uci.edu/dataset/942/rt-iot2022),
licensed CC BY 4.0. Raw files are intentionally excluded from Git.

| Item | Expected value |
|---|---|
| Archive | `data/raw/rt-iot2022.zip` |
| Archive SHA-256 | `bcaa24d62abbb1215be576d5cf9c02dfcb0bb7c4c2f5a00e03055afaa1ed109e` |
| Prepared CSV | `data/raw/RT_IOT2022.csv` |
| CSV SHA-256 | `956956c09c1764584fa08acd0f6876475626bcedcd6a6b1f8c492c2e9a2089ea` |
| Rows / model features | 123,117 / 83 |

The downloaded file contains 12 observed labels: three normal traffic labels
(`MQTT_Publish`, `Thing_Speak`, and `Wipro_bulb`) and nine attack labels. This
differs from parts of the UCI descriptive text, which mention Amazon Alexa and
publish inconsistent class counts. This repository treats the checksummed file,
not the prose table, as the experimental source of truth.

## Run the project

Requirements: Python 3.12–3.14, [uv](https://docs.astral.sh/uv/), and Node.js 20+.
The repository pins Python 3.12 for local development and CI so those environments
match the backend container runtime; `uv sync` installs that interpreter automatically.

```bash
make setup
make prepare-data
make validate-data
make verify-model
make test
```

### Docker demonstration on Arch Linux

Install Docker Engine, Compose, and the current BuildKit builder as separate
Arch packages, then enable the daemon:

```bash
sudo pacman -S --needed docker docker-compose docker-buildx
sudo systemctl enable --now docker.service
sudo usermod -aG docker "$USER"
```

Log out and back in before using Docker without `sudo`. Membership in the
`docker` group is root-equivalent; review the [ArchWiki Docker guidance](https://wiki.archlinux.org/title/Docker)
before granting it on a shared system.

Create the ignored local environment file, generate independent secrets, and
generate the administrator password hash interactively:

```bash
cp .env.example .env
openssl rand -hex 24  # IOT_IDS_POSTGRES_PASSWORD
openssl rand -hex 32  # IOT_IDS_SECRET_KEY
cd backend && .venv/bin/python -m app.api.auth && cd ..
```

Store the Argon2id output in `IOT_IDS_ADMIN_PASSWORD_HASH` inside single quotes;
[Docker Compose applies interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)
to unquoted `$` characters but treats single-quoted values literally. Then
start and verify the stack:

```bash
docker compose config --quiet
docker compose up --build --detach
docker compose ps
```

The dashboard is served at `http://localhost:5173`; stop it with
`docker compose down` (add `--volumes` only when intentionally deleting the
demonstration database).

Start the already-promoted model without retraining:

```bash
./scripts/run_all.sh --skip-setup
```

Run the complete engineering acceptance gate and then start a clean,
disposable local demonstration (also without retraining). The launcher seeds a
small normal/attack replay through the authenticated API so the initial screen
contains real model output; see the [presentation runbook](docs/demo-runbook.md)
for the verified walkthrough and recovery steps:

```bash
make project-preflight
make demo
```

Pull requests and pushes to `main` run the pinned, read-only-permission CI
workflow for lint, unit tests, builds, artifact verification, migrations, and
hashed-lock vulnerability audits for npm, backend Python, and ML Python
dependencies. A separate PostgreSQL 17 job runs migrations and
exercises `SKIP LOCKED` claims plus concurrent redrive/claim serialization. Tag
builds and manual release-gate runs additionally download the checksummed UCI
dataset and execute `make project-preflight`, including browser E2E.

Storybook is also an executable component-test catalog. Its Vitest browser
project smoke-tests every story, runs story `play` interactions, and treats
automated accessibility violations as failures:

```bash
cd frontend
npx playwright install chromium # once, unless a system Chrome is available
npm run test:storybook
npm run storybook               # optional interactive catalog
```

To run only the PostgreSQL integration evidence against an existing disposable
database:

```bash
cd backend
IOT_IDS_TEST_POSTGRES_URL='postgresql+psycopg://user:password@localhost/test_db' \
  .venv/bin/pytest -m postgres tests/test_postgres_ingestion.py
```

The integration suite creates only uniquely identified test jobs and removes
them afterward. Do not point it at a production database.

`make benchmark` records the fixed normal/attack replay evidence in
`docs/evidence/`.

Intentionally rerun the complete benchmark and atomically replace production:

```bash
./scripts/run_all.sh --skip-setup --retrain
```

Use `--check-only` to stop after validation, artifact verification, lint, tests,
and build. Retraining is compute-intensive and is never implicit.

For separate development servers:

```bash
make migrate
cd backend && uv run python -m app.ingestion.worker
cd backend && uv run uvicorn app.main:app --reload
cd frontend && npm run dev
```

Run `make migrate` after checkout and whenever migrations change; API and worker
startup fail closed when the database is not at every declared Alembic head.
Run the worker and backend in separate terminals. `./scripts/run_all.sh` and
`make demo` perform the migration and manage all three processes automatically.
To stream canonical NDJSON from stdin or a file, run `make ingest-events` or
`make ingest-events INGESTION_INPUT=/path/to/events.ndjson`. The producer batches
records, honors queue backpressure, retries transient failures, and reports
accepted, duplicate, and rejected counts.

Business-data APIs and live telemetry require an operator token when
authentication is enabled. Only authentication bootstrap (`/auth/status` and
`/auth/login`) and operational probes (`/livez`, `/readyz`, `/health`, and
`/metrics`) remain public. The browser sends the bearer token in the first
WebSocket message after opening the connection, never in the URL.
Generate credentials without putting a plaintext password in configuration:

```bash
cd backend
.venv/bin/python -m app.api.auth
# copy the Argon2id output to IOT_IDS_ADMIN_PASSWORD_HASH in single quotes
# set IOT_IDS_SECRET_KEY to at least 32 random bytes
```

The browser keeps its short-lived token only for the current tab session. CLI
ingestion accepts `--token` or the `IOT_IDS_API_TOKEN` environment variable.

Follow a file that another process is appending to:

```bash
cd backend
.venv/bin/python -m app.ingestion.producer /path/to/events.ndjson --follow --token "$IOT_IDS_API_TOKEN"
```

Validate an offline capture without inference:

```bash
make pcap-validate PCAP=/path/to/capture.pcap
```

PCAP inference is deliberately blocked until a newly labelled NFStream-native
corpus passes the support and performance gates. Approval is read only from the
server-controlled model bundle; callers cannot grant compatibility. Build the
content-addressed corpus manifest with `make native-corpus`, train/evaluate it
with `make native-train`, and use `make pcap-ingest PCAP=...` only after a valid
native bundle is installed through `IOT_IDS_NFSTREAM_MODEL_DIR`.

Inspect queue failures and perform audited redrive from either the authenticated
browser job detail or the local operator CLI:

```bash
make ingestion-ops ARGS='list --state dead_letter'
make ingestion-ops ARGS='redrive EVENT_ID --operator NAME --reason REASON --dry-run'
```

The API process runs model-health evaluation every five minutes. A standalone
evaluator is also available as `make model-health-worker`; deploy one scheduler,
not both. Model health starts in shadow mode and distribution shift is presented
as changed-traffic evidence, never as proof of accuracy loss.

Open `http://localhost:5173`; OpenAPI documentation is at
`http://localhost:8000/docs`. `make docker-up` starts the PostgreSQL-backed
demonstration stack after the required secrets in `.env` are configured. The
containerized frontend serves API and WebSocket traffic through its same-origin
Nginx proxy, so browser deployments do not need cross-origin API URLs. Compose
binds the direct port `8000` to host loopback only; remote clients must use the
frontend gateway or an explicitly configured trusted ingress.

## Deployment and security boundary

The container baseline fails closed when authentication secrets or the
PostgreSQL password are absent. Generate a long URL-safe
`IOT_IDS_POSTGRES_PASSWORD`, an Argon2id administrator hash, and an independent
random `IOT_IDS_SECRET_KEY`; keep all three outside source control. The API image
runs as an unprivileged UID. Its `/livez` endpoint checks only that the process
can serve HTTP, while `/readyz` returns `503` when required runtime components
are blocked. `/health` remains the detailed public monitoring view. `/metrics`
exports low-cardinality Prometheus request count/latency, in-flight request,
database, ingestion queue, dead-letter, outbox, and live-connection metrics.
The API enforces a configurable body-size ceiling for declared and streamed
request bodies, and the authenticated monitoring stream rejects connections above its
configured per-process capacity with WebSocket close code `1013`. Browser
WebSocket handshakes require an exact configured `Origin`; the production
server caps inbound messages at 64 KiB, limits the receive queue, and disables
per-message compression.
Application logs default to structured JSON with request IDs and normalized
route templates; raw Uvicorn access logs are disabled in the production image
to avoid duplicating or accidentally widening the logged request surface.

The production frontend sends a restrictive Content Security Policy,
clickjacking, MIME-sniffing, referrer, and browser-permission headers. TLS must
terminate at a trusted ingress or load balancer; configure HSTS there only after
HTTPS and certificate renewal have been validated. Do not expose the backend or
PostgreSQL ports directly to untrusted networks.

The built-in login throttle is intentionally process-local for this
single-operator, single-API prototype. A multi-replica deployment requires a
shared rate-limit store or enforcement at a trusted gateway, coordinated
WebSocket delivery, centralized logs/metrics, backups with restore testing, and
an external secrets manager. These are deployment requirements, not features
silently provided by Docker Compose.

In the Compose topology, NGINX is the only remote edge: it replaces rather than
extends `X-Forwarded-For`, and Uvicorn trusts forwarding metadata because the
backend is otherwise limited to the private container network and host
loopback. If the backend is deployed behind a different ingress, replace the
Compose `FORWARDED_ALLOW_IPS=*` setting with that ingress's exact IP addresses
or networks. Never combine a publicly reachable backend with wildcard proxy
trust.

Known readiness blockers and the evidence required to close them are tracked in
[the production-readiness audit](docs/production-readiness.md). Passing the
engineering preflight does not waive those external validation requirements.

## API and event surface

The API is available both at the root paths and under `/api/v1`:

- `POST /auth/login` and `GET /auth/me`
- `POST /predict` and `POST /predict/batch` (authenticated)
- `POST /ingestion/events` (JSON or NDJSON), `GET /ingestion/events/{event_id}`,
  `GET /ingestion/jobs`, `POST /ingestion/jobs/redrive`,
  `GET /ingestion/outbox/events`, and `GET /ingestion/status`
- `GET /alerts`, `GET /alerts/{id}`, and `POST /alerts/{id}/feedback`
- `GET /models`, `GET /health`, `/livez`, `/readyz`, and `/metrics`
- `GET /model-health`, `GET /model-health/history`, and `GET /model-health/cohorts`
- `POST /replay/start`, `/pause`, `/resume`, and `/stop`; `GET /replay/status`
- `WS /live`

Every successfully processed observation emits `prediction.created`. Only a
binary `attack` prediction creates an alert and emits `alert.created`; this
prevents normal telemetry from being inserted into the investigation queue.

## Repository map

```text
backend/             FastAPI, SQLAlchemy, cascade inference, replay, tests
backend/alembic/     versioned database migrations
frontend/            React/TypeScript dashboard and component tests
machine-learning/    preparation, evaluation, training, promotion, tests
data/schema/         canonical machine-readable feature contract
data/sample/         deterministic test fixture only
data/raw/            ignored local archive and prepared CSV
models/production/   tracked, verified serving bundle
models/runs/         ignored candidate runs
docs/                architecture, protocol, roadmap, schema, research
scripts/run_all.sh   ordered validation/startup workflow
```

## Documentation

- [Research foundations and source audit](docs/research-foundations.md)
- [Implemented architecture](docs/system-architecture.md)
- [Evaluation protocol and current evidence](docs/evaluation-protocol.md)
- [Status-based implementation roadmap](docs/implementation-roadmap.md)
- [Canonical feature schema](docs/feature-schema.md)
