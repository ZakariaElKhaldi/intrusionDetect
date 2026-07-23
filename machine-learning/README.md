# RT-IoT2022 ML foundation

This package implements the reproducible Phase 0–1 baseline. It runs entirely
offline once dependencies are installed.

```bash
uv sync --extra dev
uv run iot-ids-profile ../data/sample/rt_iot2022_sample.csv
uv run iot-ids-train ../data/sample/rt_iot2022_sample.csv \
  --output-dir ../models/artifacts
```

Both commands accept a real RT-IoT2022 CSV path. The trainer fits four
leakage-safe scikit-learn pipelines for both binary and multiclass targets.
Preprocessing is fitted inside each pipeline using training data only.

## Artifact integration

`models/artifacts/manifest.json` is the registry. Select the entry whose
`target` is `binary`, then resolve its `artifact` and `metadata` filenames
relative to the manifest. Verify the artifact SHA-256 against
`artifact_sha256` before calling `joblib.load`.

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
