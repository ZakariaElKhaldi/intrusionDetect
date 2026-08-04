# Evaluation Protocol and Current Evidence

This document distinguishes the evaluation that the repository performs today
from the evidence still required before deployment claims are defensible.

## 1. Questions and target definitions

Evaluation is stage-specific:

1. Can the detector separate normal from attack flows?
2. Conditional on an attack decision, can the classifier identify one of the
   nine observed attack families?
3. Are those results stable across declared random seeds?
4. Can the packaged cascade serve validated observations correctly and fast
   enough on the measured host?

The binary target maps the three observed normal labels to `normal` and all
other labels to `attack`. The multiclass target excludes normal rows entirely.
This mirrors serving behavior and avoids teaching the second stage a redundant
normal class.

## 2. Reproducible data checks

`iot-ids-prepare` and `iot-ids-profile` verify:

- archive and extracted-file SHA-256 values;
- 123,117 source rows and 83 ordered model features;
- target frequencies, missing and infinite values, categorical cardinality;
- index artifacts (`Unnamed: 0` or `no`) and other leakage candidates; and
- exact schema names and order.

There are 5,202 duplicate feature rows. Training drops duplicate feature
vectors before splitting so identical flows cannot cross partitions. That
leaves 117,915 binary examples. This changes the experimental population and is
recorded in every artifact.

## 3. Implemented experiment

The current benchmark compares Logistic Regression, Decision Tree, Random
Forest, and HistGradientBoosting. For each cascade stage it performs stratified
60/20/20 train/validation/test splits for seeds `42`, `1337`, and `2026`.
Preprocessing is inside each scikit-learn `Pipeline` and is fitted only on the
training partition.

Champion ranking is deterministic:

1. highest mean validation macro-F1;
2. lowest mean validation false-positive rate;
3. lowest mean p95 single-row inference latency;
4. smallest mean serialized size; and
5. model name as a final stable tie-break.

The saved champion is the seed-42 estimator. Its test partition remains outside
model selection. This is a repeated holdout benchmark, not cross-validation and
not a nested hyperparameter search.

## 4. Current results

| Stage | Champion | Mean validation macro-F1 | Test macro-F1 | Test error detail | p95 single-row latency* | Size |
|---|---|---:|---:|---|---:|---:|
| Binary | HistGradientBoosting | 0.9960 | 0.9961 | FPR 0.8739% | 9.23 ms | 123,471 B |
| Attack family | Random Forest | 0.9681 | 0.9842 | macro one-vs-rest FPR 0.0076% | 11.33 ms | 547,454 B |

\* Local-host measurement over the first 1,000 rows of the deterministic test
partition after warm-up. It is useful for comparison on this machine, not a
portable service-level objective. Full test partitions are used for all
classification metrics.

The binary test confusion matrix, with rows as actual and columns as predicted,
is:

| | Predicted attack | Predicted normal |
|---|---:|---:|
| Actual attack | 21,167 | 13 |
| Actual normal | 21 | 2,382 |

The attack classifier's rarest test class is `NMAP_FIN_SCAN`: six examples,
five correctly recalled (recall 0.8333). `Metasploit_Brute_Force_SSH` has only
seven test examples. These tiny supports make their apparently strong scores
high-variance and unsuitable for broad claims.

The full report, including all candidates, seed-level results, class metrics,
confusion matrices, and compact precision-recall curves, is
[`models/production/evaluation-report.json`](../models/production/evaluation-report.json).

## 5. What is not yet measured

The source CSV contains no trustworthy capture-session, device identifier, or
timestamp suitable for group-aware or temporal splitting. Accordingly, the
current report does not fabricate either experiment. Dataset order is used only
for deterministic software replay.

Still required:

- group-aware or chronological evaluation on data with reliable metadata;
- external-network or cross-dataset evaluation;
- controlled PCAP-to-feature compatibility testing;
- calibrated probability evaluation (Brier score, reliability diagram, ECE);
- full replay end-to-end latency and sustained-throughput measurement;
- false alerts per real time window;
- robustness to drift, unseen services, and malformed upstream data; and
- hardware-specific server and edge benchmarks.

This matters because cross-dataset NIDS research reports strong within-dataset
results but substantial degradation across collection environments. See
[Cantone, Marrocco, and Bria (2024)](https://doi.org/10.1109/ACCESS.2024.3472907).

## 6. Future experiment rules

For group or temporal evaluation:

- use only grouping or time metadata whose semantics are verified;
- fit imputation, encoding, scaling, resampling, feature selection, and
  calibration inside training folds;
- leave validation and test distributions unchanged;
- report both cascade-stage performance and end-to-end cascade errors; and
- report support alongside every per-class metric.

For imbalance experiments, compare class weights first, then undersampling or
oversampling inside training folds. A higher aggregate score is not sufficient
if rare-class recall or false-positive behavior becomes worse.

For PCAP/live evaluation, compare extractor names, units, directions, timeout
rules, TCP flag encoding, packet/byte counters, categorical values, and missing
value behavior. No extractor may feed production inference until these checks
pass.

## 7. Promotion criteria

Current automated promotion requires:

- exactly one binary and one multiclass artifact;
- compatible schema and exact 83-feature order;
- expected source row count and dataset checksum;
- matching report, metadata, and artifact checksums;
- matching dataset identity across both stages; and
- a non-fixture training role.

Promotion is atomic and explicit. It validates provenance and packaging; it does
not certify real-world detection quality.

## 8. Evidence required for a deployment claim

- realistic or external validation with acceptable class-specific error rates;
- demonstrated extractor value compatibility;
- calibrated thresholds tied to an operational false-alert budget;
- replay/load measurements for the complete API, database, and event path;
- drift and data-quality monitoring with analyst-reviewed escalation; and
- documented authorization, retention, privacy, and failure-handling controls.
