# System Architecture

This document describes the code that runs today. Planned components are listed
separately so the architecture is not mistaken for a deployment claim.

## 1. Implemented serving path

```text
Prepared CSV replay                 POST /predict or /predict/batch
       |                                         |
       +--------------------+--------------------+
                            v
                 FlowObservation validation
                exact rt-iot2022-v1 contract
                            |
                            v
             production manifest/checksum registry
                            |
                            v
          HistGradientBoosting binary detector
                    |                 |
                  normal            attack
                    |                 v
                    |       Random Forest attack family
                    |                 |
                    +--------+--------+
                             v
          persist observation + prediction (+ alert for attack)
                  SQLite local / PostgreSQL Docker
                             |
                             v
             prediction.created for every result
                alert.created for alerts only
                             |
                             v
                  React investigation dashboard
```

Inference and database persistence are synchronous within the API/replay
process. WebSocket broadcast happens after commit. There is no Kafka/Redis
queue, worker pool, SSE path, or durable event log.

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
  "classifier_model_version": "multiclass-random_forest-... or null",
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
class score. Neither stage's score is calibrated probability.

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
├── features/        canonical schema; placeholder extractor mappings
├── inference/       strict registry, cascade predictor, raw-value highlighting
├── ingestion/       functional dataset replay; PCAP/live guards only
├── detection/       simple severity; behavior/drift placeholders
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

## 6. Replay behavior

Dataset mode scans the prepared CSV on the server, filters by `all`, `normal`,
`attack`, or `class:<label>`, applies offset and limit, and emits observations at
the requested interval/speed. It does not upload the full dataset through the
browser. The dashboard starts a bounded 100-row replay by default.

The backend assigns current timestamps when rows are emitted. This supports UI
and end-to-end pipeline testing but does not imply original packet chronology.

## 7. Deployment modes

### Local development

- Vite frontend;
- FastAPI backend;
- local SQLite database; and
- verified production artifacts plus prepared dataset replay.

### Docker demonstration

- static frontend container;
- FastAPI backend container;
- PostgreSQL 17; and
- production artifacts and prepared dataset copied into the backend image.

Neither mode currently includes authentication, TLS termination, horizontal
coordination, durable event delivery, secrets management, database migrations,
or observability infrastructure.

## 8. Planned boundaries

Before adding live capture, implement and validate one extractor adapter against
controlled PCAP golden cases. Before claiming behavior-aware or explainable
detection, add device identity outside the 83-feature vector, real policy data,
and model attributions. Before scaling, define queueing, idempotency, retry,
backpressure, and multi-process WebSocket behavior.
