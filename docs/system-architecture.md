# System Architecture

## 1. Architectural principles

1. Feature compatibility before model complexity.
2. Dataset replay before live capture.
3. Asynchronous ingestion and prediction.
4. Version every schema, model, and preprocessing artifact.
5. Separate detection from alert prioritization.
6. Keep raw evidence for reproducibility.
7. Design the UI for investigation, not decoration.

## 2. Components

```text
                        ┌─────────────────────┐
                        │ Dataset Replay      │
                        │ PCAP Replay         │
                        │ Authorized Capture  │
                        └──────────┬──────────┘
                                   │
                                   v
                        ┌─────────────────────┐
                        │ Flow Extractor      │
                        │ Zeek/CIC adapter    │
                        └──────────┬──────────┘
                                   │
                                   v
                        ┌─────────────────────┐
                        │ Schema Validator    │
                        │ mapping + typing    │
                        └──────────┬──────────┘
                                   │
                                   v
                        ┌─────────────────────┐
                        │ Event Queue         │
                        └──────┬────────┬─────┘
                               │        │
                               v        v
                    ┌──────────────┐  ┌────────────────┐
                    │ ML Inference │  │ Behavior Rules │
                    └──────┬───────┘  └───────┬────────┘
                           └──────────┬─────────┘
                                      v
                           ┌────────────────────┐
                           │ Severity Engine    │
                           │ explanation        │
                           └─────────┬──────────┘
                                     │
                       ┌─────────────┴─────────────┐
                       v                           v
              ┌──────────────────┐       ┌─────────────────┐
              │ PostgreSQL       │       │ WebSocket / SSE │
              └──────────────────┘       └────────┬────────┘
                                                  v
                                       ┌────────────────────┐
                                       │ React Dashboard    │
                                       └────────────────────┘
```

## 3. Data contracts

### Flow observation

```json
{
  "schema_version": "rt-iot2022-v1",
  "event_id": "uuid",
  "flow_started_at": "ISO-8601",
  "flow_ended_at": "ISO-8601",
  "source": "dataset-replay",
  "features": {},
  "ground_truth": null
}
```

### Prediction

```json
{
  "event_id": "uuid",
  "model_version": "rf-2026-01",
  "binary_prediction": "attack",
  "attack_class": "NMAP_TCP_scan",
  "confidence": 0.94,
  "latency_ms": 4.8
}
```

### Alert

```json
{
  "alert_id": "uuid",
  "event_id": "uuid",
  "severity": "high",
  "reasons": [
    "high attack probability",
    "device profile forbids SSH"
  ],
  "top_features": [],
  "status": "new"
}
```

## 4. Backend modules

```text
backend/app/
├── api/
│   ├── predictions.py
│   ├── alerts.py
│   ├── models.py
│   └── live.py
├── ingestion/
│   ├── dataset_replay.py
│   ├── pcap_replay.py
│   └── live_capture.py
├── features/
│   ├── canonical_schema.py
│   ├── zeek_adapter.py
│   ├── cicflowmeter_adapter.py
│   └── validation.py
├── inference/
│   ├── model_registry.py
│   ├── predictor.py
│   ├── calibration.py
│   └── explanations.py
├── detection/
│   ├── device_profiles.py
│   ├── severity.py
│   └── drift.py
└── database/
```

## 5. Frontend modules

```text
frontend/src/
├── app/
├── components/
├── features/
│   ├── live-overview/
│   ├── alerts/
│   ├── topology/
│   ├── model-analysis/
│   └── observation-test/
├── services/
├── stores/
└── types/
```

## 6. Functional UX requirements

- Every chart must support a concrete investigation task.
- Selecting a timeline segment filters the alert table.
- Selecting a topology node filters traffic by device.
- Selecting an alert opens a details drawer without losing context.
- Filters remain encoded in the URL when practical.
- Tables are keyboard-accessible and virtualized.
- Severity uses text and icons, not color alone.
- Live updates must not reorder rows while the analyst is reading.
- The interface must expose data freshness and connection status.
- Motion must respect reduced-motion preferences.

## 7. Deployment modes

### Local development

- Vite frontend
- FastAPI backend
- SQLite
- Dataset replay

### Demonstration

- Docker Compose
- PostgreSQL
- Dataset and PCAP replay
- WebSocket alerts

### Edge experiment

- Raspberry Pi collector or predictor
- Central FastAPI server
- Reduced or quantized model
- Buffered forwarding when offline
