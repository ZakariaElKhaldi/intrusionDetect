# RT-IoT2022 ML Pipeline

This package prepares and validates RT-IoT2022, compares leakage-safe tabular
pipelines, publishes a clean candidate run, and atomically promotes a verified
two-stage production bundle.

## Commands

From `machine-learning/`:

```bash
uv sync --extra dev

uv run iot-ids-prepare ../data/raw/rt-iot2022.zip \
  --output-dir ../data/raw \
  --manifest-path ../data/dataset-manifest.json \
  --expected-archive-sha256 bcaa24d62abbb1215be576d5cf9c02dfcb0bb7c4c2f5a00e03055afaa1ed109e \
  --expected-dataset-sha256 956956c09c1764584fa08acd0f6876475626bcedcd6a6b1f8c492c2e9a2089ea

uv run iot-ids-profile ../data/raw/RT_IOT2022.csv

uv run iot-ids-train ../data/raw/RT_IOT2022.csv \
  --output-dir ../models/runs/latest

uv run iot-ids-promote \
  --run-dir ../models/runs/latest \
  --production-dir ../models/production \
  --expected-dataset-sha256 956956c09c1764584fa08acd0f6876475626bcedcd6a6b1f8c492c2e9a2089ea \
  --expected-row-count 123117

uv run iot-ids-verify \
  --production-dir ../models/production \
  --expected-dataset-sha256 956956c09c1764584fa08acd0f6876475626bcedcd6a6b1f8c492c2e9a2089ea \
  --expected-row-count 123117
```

The root `Makefile` wraps the same sequence. Training defaults to seeds `42`,
`1337`, and `2026`; `--seed` is retained for fast fixture tests.

## Experiment design

The trainer:

1. rejects schema, order, missing-value, infinity, and target errors;
2. removes duplicate feature vectors before splitting;
3. creates 60/20/20 stratified train/validation/test partitions;
4. fits Logistic Regression, Decision Tree, Random Forest, and
   HistGradientBoosting with preprocessing inside each pipeline;
5. trains the binary stage on all deduplicated flows and the family stage on
   attack rows only;
6. ranks candidates by mean validation macro-F1, FPR, p95 latency, serialized
   size, and stable name tie-break; and
7. saves the seed-42 champion plus all seed-level evaluation evidence.

Classification metrics use the complete held-out partitions. Single-row
latency uses a deterministic maximum of 1,000 test rows so repeated benchmarking
does not dominate training time. Precision-recall curves are compacted to at
most 256 points without changing PR-AUC or classification metrics.

## Current promoted champions

| Stage | Model | Mean validation macro-F1 | Seed-42 test macro-F1 | Test FPR | Artifact size |
|---|---|---:|---:|---:|---:|
| Binary | HistGradientBoosting | 0.9960 | 0.9961 | 0.8739% | 123,471 B |
| Attack family | Random Forest | 0.9681 | 0.9842 | 0.0076% macro OvR | 547,454 B |

Exact metrics live in
[`../models/production/evaluation-report.json`](../models/production/evaluation-report.json).
The scores are in-dataset, stratified-random results and do not demonstrate
real-network generalization.

## Bundle contract

`models/production/manifest.json` references exactly one `binary` and one
`multiclass` artifact. Every artifact is a scikit-learn `Pipeline` containing
`preprocess` and `classifier` steps. Metadata records feature order, schema,
dataset checksum, code state, seeds, library versions, selection policy,
artifact checksum, and uncalibrated-score status.

Promotion verifies:

- dataset checksum and source row count;
- non-fixture dataset role;
- report and metadata checksums;
- artifact checksums in both manifest and metadata;
- schema version and exact feature order; and
- exactly one model per cascade role.

The destination is replaced through a recoverable directory swap. Normal
application startup verifies and loads production; it does not retrain.

## Known limits

- The source file has no reliable timestamp, device, or capture-session field;
  realistic splitting is unavailable rather than fabricated.
- Exact duplicate feature vectors are removed, but broader scenario artifacts
  and near-duplicates may remain.
- The rarest multiclass test supports are six and seven rows.
- `predict_proba` outputs are not calibrated probabilities.
- Latency, CPU, and memory measurements are host-specific diagnostics.
- Zeek/Flowmeter versus Wireshark/CICFlowMeter provenance remains unresolved;
  column compatibility is not value compatibility.
- The synthetic sample is only a contract fixture and cannot be promoted.
