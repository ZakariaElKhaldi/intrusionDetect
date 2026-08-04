# RT-IoT2022 ML foundation

This package implements reproducible RT-IoT2022 preparation, repeated baseline
evaluation, and verified champion promotion. It runs entirely offline once
dependencies are installed.

```bash
uv sync --extra dev
uv run iot-ids-prepare ../data/raw/rt-iot2022.zip \
  --output-dir ../data/raw \
  --manifest-path ../data/dataset-manifest.json
uv run iot-ids-profile ../data/raw/RT_IOT2022.csv
uv run iot-ids-train ../data/raw/RT_IOT2022.csv \
  --output-dir ../models/runs/latest
uv run iot-ids-promote \
  --run-dir ../models/runs/latest \
  --production-dir ../models/production \
  --expected-dataset-sha256 956956c09c1764584fa08acd0f6876475626bcedcd6a6b1f8c492c2e9a2089ea \
  --expected-row-count 123117
```

The trainer fits four leakage-safe scikit-learn pipelines over three declared
seeds. Binary candidates use all flows; attack-family candidates use attack
rows only. Preprocessing is fitted inside each pipeline using training data
only. The sample CSV remains suitable for tests, but promotion rejects fixture
runs.

## Artifact integration

`models/production/manifest.json` is the serving registry and contains exactly
one `binary` detector plus one attack-only `multiclass` classifier. Promotion
checks the report, metadata, artifacts, schema, dataset hash, row count, and all
referenced checksums before replacing that directory atomically.

The artifact is a direct scikit-learn `Pipeline` containing `preprocess` and
`classifier` steps. Construct inference frames in the metadata's
`feature_order`, then call `predict` or `predict_proba`. Scores are explicitly
marked uncalibrated. `iot_ids_ml.inference.VersionedPredictor` is the reference
checksum-validation and inference implementation.

The official RT-IoT2022 table has no reliable timestamp, capture-session, or
device grouping field. Consequently, the default report marks realistic
evaluation unavailable rather than fabricating chronology. A dataset carrying
extra metadata can opt in with `--group-column` or `--time-column`; those
columns are excluded from model features.

Known limitations:

- The checked-in CSV is a deterministic synthetic contract fixture, not a
  scientific substitute for RT-IoT2022.
- The source literature disagrees about the extractor (Zeek/Flowmeter versus
  Wireshark/CICFlowMeter); schema compatibility does not prove value
  compatibility.
- Probability calibration, SHAP, resampling experiments, PCAP compatibility,
  drift monitoring, and hardware benchmarks belong to later phases.
- Process CPU and traced Python memory are useful local diagnostics, not
  hardware-independent deployment benchmarks.
