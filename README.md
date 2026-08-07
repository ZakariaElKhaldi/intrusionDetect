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
  views, including read-only ingestion job/dead-letter/outbox operations;
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
- calibrated probabilities;
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
| Binary detector | HistGradientBoosting | 0.9965 | 0.9955 | 0.8739% | 123,465 B |
| Attack-family classifier | HistGradientBoosting | 0.9526 | 0.9853 | 0.0087% macro one-vs-rest | 262,289 B |

The untouched shared seed-42 test partition produces a complete cascade macro-F1
of **0.9865**, with 18 detector false negatives. Across the three declared seeds,
mean cascade macro-F1 is **0.9743**. These are random-split results, not deployment
validation.

These are stratified random-split results from one dataset. The unusually high
scores are useful as a reproducible in-dataset baseline, but they are not
evidence of deployment readiness. The source table has no reliable timestamp,
capture-session, or device grouping field, so the report explicitly marks a
realistic split as unavailable. Scores returned by `predict_proba` are also
uncalibrated.

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

Requirements: Python 3.11+, [uv](https://docs.astral.sh/uv/), and Node.js 20+.

```bash
make setup
make prepare-data
make validate-data
make verify-model
make test
```

Start the already-promoted model without retraining:

```bash
./scripts/run_all.sh --skip-setup
```

Run the complete engineering acceptance gate and then start a clean,
disposable local demonstration (also without retraining):

```bash
make project-preflight
make demo
```

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

Run the worker and backend in separate terminals. `./scripts/run_all.sh` and
`make demo` perform the migration and manage all three processes automatically.
To stream canonical NDJSON from stdin or a file, run `make ingest-events` or
`make ingest-events INGESTION_INPUT=/path/to/events.ndjson`. The producer batches
records, honors queue backpressure, retries transient failures, and reports
accepted, duplicate, and rejected counts.

Follow a file that another process is appending to:

```bash
cd backend
uv run python -m app.ingestion.producer /path/to/events.ndjson --follow
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

Inspect queue failures without adding unauthenticated browser mutations:

```bash
make ingestion-ops ARGS='list --state dead_letter'
make ingestion-ops ARGS='redrive --event-id EVENT_ID --operator NAME --reason REASON --dry-run'
```

The API process runs model-health evaluation every five minutes. A standalone
evaluator is also available as `make model-health-worker`; deploy one scheduler,
not both. Model health starts in shadow mode and distribution shift is presented
as changed-traffic evidence, never as proof of accuracy loss.

Open `http://localhost:5173`; OpenAPI documentation is at
`http://localhost:8000/docs`. `make docker-up` starts the PostgreSQL-backed
demonstration stack.

## API and event surface

The API is available both at the root paths and under `/api/v1`:

- `POST /predict` and `POST /predict/batch`
- `POST /ingestion/events` (JSON or NDJSON), `GET /ingestion/events/{event_id}`,
  `GET /ingestion/jobs`, `GET /ingestion/outbox/events`, and `GET /ingestion/status`
- `GET /alerts`, `GET /alerts/{id}`, and `POST /alerts/{id}/feedback`
- `GET /models` and `GET /health`
- `GET /model-health` and `GET /model-health/history`
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
