# IoT Intrusion Detection System

A research-backed, real-time intrusion detection platform for IoT networks.

The system uses machine learning to classify network flows, detect suspicious activity, explain alerts, and present results through a modern React dashboard. The project is based on the **RT-IoT2022** dataset.

> Academic and experimental project. It must not be treated as a production security control without additional validation.

## Project goals

### AI and machine learning

- Explore and validate the RT-IoT2022 dataset.
- Build binary classification: `normal` vs `attack`.
- Build multiclass classification for attack categories where reliable.
- Compare simple and advanced models.
- Measure class-specific performance, not accuracy alone.
- Add prediction explanations and model-health monitoring.
- Investigate a lightweight model for edge deployment.

### Software engineering

- Build a reproducible traffic-to-prediction pipeline.
- Replay dataset observations as a real-time stream.
- Capture and transform network flows using a compatible feature schema.
- Serve predictions through FastAPI.
- Stream alerts to a React dashboard.
- Store alerts, observations, model versions, and analyst feedback.
- Add a testing harness for normal and malicious scenarios.
- Package the platform with Docker.

## Research-backed architecture

```text
Network / PCAP / Dataset Replay
              |
              v
    Flow Feature Extraction
              |
              v
 Feature Schema Validation
              |
              v
 Preprocessing Pipeline
              |
              v
 ML Classifier + Behavior Rules
              |
              v
 Explanation and Severity Engine
              |
              v
 FastAPI + Database + WebSocket/SSE
              |
              v
       React Investigation UI
```

The feature-extraction stage is a strict compatibility boundary. The UCI page describes Zeek with a Flowmeter plugin, while the introductory paper describes Wireshark PCAP capture followed by CICFlowMeter conversion. The project must verify the actual dataset columns and generated values before choosing a live extractor.

## Recommended stack

### Frontend

- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui and Radix UI
- TanStack Query
- Zustand
- Apache ECharts
- Sigma.js
- TanStack Table and TanStack Virtual
- React Hook Form and Zod
- Motion

### Backend

- Python
- FastAPI
- Pydantic
- SQLAlchemy
- PostgreSQL for the full version, SQLite for the MVP
- WebSocket or Server-Sent Events
- Zeek and/or CICFlowMeter compatibility adapter
- Scapy for controlled traffic generation and testing

### Machine learning

- pandas
- NumPy
- scikit-learn
- XGBoost or LightGBM
- imbalanced-learn
- SHAP
- joblib
- Evidently or custom drift metrics

## Model candidates

Start with models that are fast, explainable, and strong on tabular data:

1. Logistic Regression
2. Decision Tree
3. Random Forest
4. HistGradientBoosting
5. XGBoost or LightGBM
6. Quantized autoencoder as an optional edge/anomaly baseline

Do not begin with Transformers or a large deep-learning architecture. First establish reliable baselines, realistic evaluation, and a correct feature pipeline.

## Evaluation priorities

Required metrics:

- Precision
- Recall
- F1-score
- Macro F1-score
- Weighted F1-score
- Per-class recall
- False-positive rate
- Confusion matrix
- Precision-recall curves
- Training time
- Inference latency
- Model size and memory use

Required evaluation modes:

1. Stratified random split for the initial benchmark.
2. Group-aware or time-aware split for a more realistic test.
3. Chronological dataset replay.
4. Optional cross-dataset or external validation.

All resampling, scaling, encoding, and feature selection must be fitted only on training data.

## Main application pages

### Live overview

- Current traffic rate
- Active IoT devices
- Current threat level
- Attack timeline
- Protocol distribution
- Recent critical alerts
- Model and pipeline health

### Alert investigation

- Virtualized, filterable alert table
- Attack type and confidence
- Source and destination
- Flow features
- Top SHAP factors
- Device behavior violations
- Analyst status and notes

### Network topology

- IoT devices and communication edges
- Suspicious connections
- Risk levels
- Device profile violations
- Time-range filtering

### Model analysis

- Model comparison
- Per-class metrics
- Confusion matrices
- Feature importance
- Error analysis
- Drift indicators
- Model version and training metadata

### Observation testing

- Upload a one-row or batch CSV file
- Select a saved test observation
- Replay a traffic scenario
- View prediction, confidence, severity, and explanation

## Real-time modes

### Phase 1: dataset replay

Replay RT-IoT2022 observations through the same API and event pipeline used by live traffic. This provides a deterministic and safe demonstration.

### Phase 2: PCAP replay

Read captured PCAP files, generate compatible flow features, and compare them with known labels.

### Phase 3: controlled live capture

Capture authorized network traffic and classify completed or periodically updated flows.

### Phase 4: edge deployment

Run a reduced model or quantized anomaly detector on a Raspberry Pi or gateway and forward alerts to the central dashboard.

## Documentation

- [Research foundations](docs/research-foundations.md)
- [System architecture](docs/system-architecture.md)
- [Evaluation protocol](docs/evaluation-protocol.md)
- [Implementation roadmap](docs/implementation-roadmap.md)

## Repository structure

```text
iot-intrusion-detection/
├── frontend/
├── backend/
├── machine-learning/
├── collector/
├── simulator/
├── data/
├── models/
├── tests/
├── docs/
├── docker-compose.yml
└── README.md
```

## References

See [docs/research-foundations.md](docs/research-foundations.md) for the literature review and design implications.
