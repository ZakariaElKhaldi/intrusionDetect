# Evaluation Protocol

## 1. Objectives

Evaluation must answer more than “Which model has the highest accuracy?”

It should determine:

- Detection quality for each attack class
- False-alarm behavior
- Robustness under more realistic splits
- Inference speed
- Model size and resource use
- Stability of the feature-extraction pipeline
- Suitability for server and edge deployment

## 2. Data validation

Before training:

- Confirm row and column counts.
- Verify target labels and class frequencies.
- Detect duplicates.
- Verify missing and infinite values.
- Inspect categorical cardinality.
- Identify identifier-like or leakage-prone fields.
- Confirm that train and test rows are not duplicate flows.
- Document every removed feature.

## 3. Split strategies

### Experiment A: stratified random split

Purpose: comparable initial benchmark.

- Stratify by target.
- Fit preprocessing only on the training partition.
- Use validation data for tuning.
- Keep the test set untouched.

### Experiment B: group-aware split

Purpose: reduce leakage between related flows.

Potential grouping keys:

- Capture session
- Device
- Source
- Scenario
- Time window

Use the strongest grouping information actually available in the data.

### Experiment C: temporal split

Purpose: approximate deployment on future traffic.

- Train on earlier observations.
- Validate on a later interval.
- Test on the latest interval.
- Do not shuffle across the time boundary.

If reliable timestamps are absent, document that limitation rather than inventing chronology.

### Experiment D: replay evaluation

Purpose: test the complete software path.

```text
observation
→ schema validation
→ preprocessing
→ inference
→ database
→ live event
→ dashboard
```

Measure prediction correctness and end-to-end latency.

## 4. Imbalance handling

Compare:

- No balancing
- Class weights
- Random undersampling
- SMOTE or another oversampler

Rules:

- Resampling occurs only inside training folds.
- The validation and test distributions remain unchanged.
- Report per-class metrics.
- Prefer class weights as the first baseline.

## 5. Metrics

### Classification

- Accuracy
- Balanced accuracy
- Precision
- Recall
- F1
- Macro F1
- Weighted F1
- Per-class recall
- Matthews correlation coefficient
- Confusion matrix
- One-vs-rest PR-AUC when meaningful

### Operational

- Median latency
- p95 latency
- Predictions per second
- Serialized model size
- Peak RAM
- CPU utilization
- Invalid-observation rate
- Alert rate
- False alerts per time window

### Calibration

When probabilities are shown in the UI:

- Reliability diagram
- Brier score
- Expected calibration error
- Calibrated vs uncalibrated comparison

Do not present an uncalibrated classifier score as guaranteed probability.

## 6. Model comparison table

| Model | Macro F1 | Rare-class recall | FPR | p95 latency | Size | Notes |
|---|---:|---:|---:|---:|---:|---|
| Logistic Regression | | | | | | Baseline |
| Decision Tree | | | | | | Interpretable |
| Random Forest | | | | | | Strong tabular baseline |
| HistGradientBoosting | | | | | | Efficient boosting |
| XGBoost/LightGBM | | | | | | Tuned boosting |
| Quantized Autoencoder | | | | | | Edge/anomaly experiment |

## 7. Error analysis

For every candidate:

- List the most confused class pairs.
- Inspect false positives.
- Inspect false negatives.
- Compare confidence distributions.
- Check whether predictions depend excessively on a few features.
- Test removal of identifier-like features.
- Compare results across split strategies.
- Inspect performance by IoT device or traffic source when available.

## 8. Feature pipeline validation

Create controlled PCAP scenarios:

1. Short TCP connection
2. UDP flow
3. MQTT exchange
4. DNS request
5. Repeated SYN traffic
6. Authorized scan in an isolated lab

For every extractor candidate:

- Compare column names.
- Compare units.
- Compare flow direction rules.
- Compare timeout behavior.
- Compare TCP flag encoding.
- Compare packet and byte counters.
- Compare missing-value behavior.

A model should not be promoted to the live pipeline until feature compatibility is demonstrated.

## 9. Acceptance criteria for the MVP

- At least three models compared.
- Macro F1 and per-class recall reported.
- Random and realistic split results shown separately.
- One model is packaged with its preprocessing pipeline.
- API rejects invalid schemas clearly.
- Dataset replay reaches the dashboard.
- Alert details show model version and feature values.
- End-to-end p95 latency is measured.
- Known limitations are documented.

## 10. Reproducibility

Record:

- Dataset checksum
- Code commit
- Random seed
- Split definition
- Feature schema version
- Library versions
- Training configuration
- Model checksum
- Evaluation output
