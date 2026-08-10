# System Architecture

This document describes the code that runs today. Planned components are listed
separately so the architecture is not mistaken for a deployment claim.

## 1. Implemented serving path

```text
POST /ingestion/events (JSON/NDJSON)
               |
    FlowObservation validation
    exact rt-iot2022-v1 contract
               |
    durable ingestion_jobs inbox
               |
       lease/retry worker ------------------+
                                             |
Prepared CSV replay or /predict              |
               |                             |
    FlowObservation validation --------------+
                                             |
                                             v
             production manifest/checksum registry
                            |
                            v
          calibrated HistGradientBoosting binary detector
                    |                 |
                  normal            attack
                    |                 v
                    |   calibrated Random Forest attack family
                    |                 |
                    +--------+--------+
                             v
 persist observation + prediction (+ alert) atomically
       worker transactions also add outbox records
                  SQLite local / PostgreSQL Docker
                             |
                             v
      outbox or direct post-commit live publication
             prediction.created for every result
                alert.created for alerts only
                             |
                             v
                  React investigation dashboard
```

`/predict`, `/predict/batch`, and dataset replay retain their backward-compatible
synchronous behavior. The production-capable ingestion route validates and
enqueues observations before returning `202`; a separate worker claims jobs,
performs inference, and commits the observation, prediction, optional alert,
and outbox events in one transaction. The outbox is published only after that
commit. There is no Kafka/Redis broker or SSE path.

## 2. Model registry and cascade

Startup requires `models/production/manifest.json` unless the explicit
development fallback flag is enabled. The registry requires one binary and one
multiclass artifact, verifies report/artifact/metadata checksums, validates the
schema and feature order, checks that both stages share a dataset, and rejects
fixture-trained production bundles.

The detector always runs. The classifier runs only when the detector returns
`attack`. Consequently, end-to-end family recall is bounded by detector recall;
standalone multiclass metrics do not measure the complete cascade.

## 3. Data contracts

### Observation

```json
{
  "schema_version": "rt-iot2022-v1",
  "event_id": "uuid",
  "flow_started_at": "2026-08-04T12:00:00Z",
  "flow_ended_at": "2026-08-04T12:00:01Z",
  "source": "dataset-replay",
  "network_context": {
    "source_ip": "optional",
    "destination_ip": "optional",
    "source_port": 12345,
    "destination_port": 1883,
    "protocol": "tcp",
    "interface": "optional",
    "capture_id": "optional",
    "extractor_fingerprint": "optional"
  },
  "features": { "83 ordered fields": "..." },
  "ground_truth": "optional label"
}
```

### Prediction

```json
{
  "prediction_id": "uuid",
  "event_id": "uuid",
  "model_version": "binary-hist_gradient_boosting-...",
  "detector_model_version": "binary-hist_gradient_boosting-...",
  "classifier_model_version": "multiclass-hist_gradient_boosting-... or null",
  "binary_prediction": "attack",
  "attack_class": "NMAP_TCP_scan",
  "confidence": 0.94,
  "detection_score": 0.94,
  "attack_class_score": 0.88,
  "latency_ms": 8.2,
  "detector_latency_ms": 3.1,
  "classifier_latency_ms": 5.1,
  "end_to_end_latency_ms": 11.7,
  "total_latency_ms": 11.7,
  "top_features": [],
  "raw_features": {},
  "alert_id": "uuid or null"
}
```

`confidence` is retained as a compatibility alias for the detector's selected
class score. Prediction responses also carry `detection_score_calibrated` and
`attack_class_score_calibrated`, derived from the exact serving artifacts. The
current promoted bundle declares sigmoid-calibrated probabilities; fallback or
future artifacts that do not declare calibration remain labelled as model
scores. Calibration measured on RT-IoT2022 is not proof of calibration on a
deployment network and must be monitored with representative labelled traffic.

### Live events

```json
{ "type": "prediction.created", "data": { "prediction response": "..." } }
```

```json
{ "type": "alert.created", "data": { "persisted alert projection": "..." } }
```

Only `alert.created` belongs in the analyst alert queue. The frontend parses
JSON defensively, deduplicates prediction IDs, and does not synthesize an alert
from a prediction message.

## 4. Backend modules

```text
backend/app/
├── api/             predictions, alerts/feedback, models, replay, WebSocket
├── database/        SQLAlchemy records and engine/session setup
├── features/        canonical schema, NFStream plugin, unsupported adapters
├── inference/       strict registry, cascade predictor, TreeSHAP attribution
├── detection/       severity, behavior checks, calibrated drift primitives
├── ingestion/       durable queue, worker, producer, replay, and PCAP CLI
├── live.py          in-process WebSocket connection manager
├── service.py       validate-to-persist-to-broadcast orchestration
└── main.py          FastAPI construction and lifecycle
```

## 5. Frontend modules

```text
frontend/src/
├── components/      headings, severity labels, ECharts wrappers/options
├── features/
│   ├── alerts/      filterable investigation table and detail drawer
│   ├── models/      serving metrics and confusion matrix
│   ├── overview/    workload, timeline, composition, pipeline facts
│   ├── testing/     schema-aware CSV observation testing
│   └── topology/    Cytoscape/fcose graph and graph derivation
├── api.ts           REST and live-event wire adapters
├── types.ts         UI contracts
└── App.tsx          navigation, live state, replay controls
```

Because RT-IoT2022 omits source/destination IP identities, topology labels may
fall back to port-derived routes. The graph is an investigation projection of
available alert data, not a discovered physical network map.

## 6. Durable ingestion behavior

`POST /ingestion/events` accepts 1–1,000 canonical observations as a JSON array,
an `observations` wrapper, or NDJSON. The entire request is validated before any
job is stored. `event_id` is the idempotency key: an identical resubmission
reports a duplicate, while changed content under the same ID returns `409`.
Queue saturation returns `429` with `Retry-After`.

PostgreSQL workers claim rows with `FOR UPDATE SKIP LOCKED`; SQLite is restricted
to one local worker. Processing leases expire after 60 seconds by default.
Transient failures retry after 1, 5, then 30 seconds and become `dead_letter`
after the third failed attempt. Worker heartbeat, queue age/depth, retry/dead
letter counts, and outbox backlog are available through `/ingestion/status`,
`/health`, and the Monitor page.

## 7. Offline PCAP extraction

The `nfstream-iot-v1` plugin calculates all 83 schema fields and records
direction, timeouts, accounting mode, time units, service fallbacks, and
zero/statistical rules in a fingerprinted manifest. Event IDs derive from the
PCAP checksum, five-tuple, and flow timestamps. Validation reports include
per-flow features and invariant failures.

This is schema-compatible extraction, not proven model-input compatibility.
The manifest therefore sets `inference_compatible` to false, and PCAP ingestion
requires external compatibility evidence that matches the extractor fingerprint
and active detector/classifier versions; the active artifacts must also approve
that fingerprint. Zeek and CICFlowMeter adapters fail explicitly instead of
guessing mappings. Live-interface capture remains disabled.

## 8. Replay behavior

Dataset mode scans the prepared CSV on the server, filters by `all`, `normal`,
`attack`, or `class:<label>`, applies offset and limit, and emits observations at
the requested interval/speed. It does not upload the full dataset through the
browser. The dashboard starts a bounded 100-row replay by default.

The backend assigns current timestamps when rows are emitted. This supports UI
and end-to-end pipeline testing but does not imply original packet chronology.

Dataset counting and synchronous inference/persistence run in the bounded
application worker pool. Replay start, pause, resume, and stop transitions are
serialized so a dataset scan cannot race another control request. A database
session is opened and fully consumed by the worker thread that owns it; live
events are broadcast only after the transaction commits. Dashboard summaries
are computed with database-side grouped aggregates and an exact, constant-memory
median query rather than loading the full observation history.

## 9. Deployment modes

### Local development

- Vite frontend;
- FastAPI backend;
- local SQLite database; and
- verified production artifacts plus prepared dataset replay.

### Docker demonstration

- static frontend container;
- FastAPI backend container;
- one-shot Alembic migration container;
- durable ingestion/outbox worker container;
- PostgreSQL 17; and
- production artifacts and prepared dataset copied into the backend image.

Both modes support the hardened single-admin authentication configuration.
Neither mode supplies TLS termination, managed or multi-user identity,
distributed broker infrastructure, horizontally coordinated WebSocket
publication, centralized secrets management, or production observability
infrastructure.

## 10. Planned boundaries

Before enabling live capture or PCAP inference, validate the NFStream values
against paired source evidence or newly labelled extractor data. Before
claiming behavior-aware detection, add device identity outside the 83-feature
vector and real policy data. Before horizontal scaling, introduce coordinated
event publication and load-test PostgreSQL queue contention.
