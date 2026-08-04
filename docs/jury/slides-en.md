# IoT Intrusion Detection — Jury Deck

Core deck target: 10–12 minutes. Slides after “Questions” are optional appendix material.

---

## 1 — The question

Can a reproducible two-stage model turn validated IoT network-flow records into useful, inspectable alerts?

- Research prototype, not a production security control
- Recorded dataset replay, not live packet capture
- Functionality and evidence before visual decoration

Speaker cue: state the boundary in the first 20 seconds.

---

## 2 — What the system does

```text
RT-IoT2022 row → schema validation → binary detector
                                      ├─ normal → prediction only
                                      └─ attack → family classifier → alert
                                                        ↓
                                           database + WebSocket + UI
```

Show the architecture diagram or live health panel. Do not describe deferred components.

---

## 3 — Data provenance matters

- UCI RT-IoT2022, CC BY 4.0
- 123,117 rows, 83 model features, 12 observed source labels
- SHA-256 verified archive and CSV
- Verified discrepancy: the distributed file’s normal labels do not match parts of the descriptive prose
- Duplicate feature vectors removed before splitting

---

## 4 — Leakage-safe experiment

- One split stratified by the original 12 labels
- Binary model uses every row in each partition
- Family model uses only attack rows from those same partitions
- Test partition is untouched by candidate selection
- Three declared seeds for selection stability

Visual: shared train/validation/test bands feeding both stages.

---

## 5 — Candidates and selection

- Logistic Regression
- Decision Tree
- Random Forest
- Histogram Gradient Boosting

Show detector and classifier tabs separately. Point to the selection metric, test metric, class support and selected champion. Never compare unlike tasks in one ranking.

---

## 6 — Complete cascade evidence

Seed-42 shared test result:

- 0.9980 accuracy and 0.9865 macro-F1;
- 18 attacks missed by the detector;
- 0.9743 mean cascade macro-F1 across three seeds;
- rarest test family has only 6 observations.

Use the generated ten-class confusion matrix and per-family recall from the production evaluation report.

Say explicitly:

- detector false negatives propagate to the final output;
- macro-F1 gives each family equal weight;
- support counts reveal where evidence is weak;
- random-split performance is not deployment validation.

---

## 7 — From model output to analyst workflow

Show, do not narrate:

1. replay normal records and show predictions with zero alerts;
2. replay attacks and open one persisted alert;
3. identify detector and classifier versions;
4. inspect signed SHAP contributions;
5. change analyst status and reload.

---

## 8 — Interpretability with boundaries

- Detector explanation is available for every alert
- Classifier explanation is available for routed attacks
- Signed impacts, raw values, base value and output value are reported
- SHAP explains the model output; it is not causal proof
- Severity reasons remain separate from model attribution

---

## 9 — End-to-end engineering evidence

| Replay | Rows | Alerts | Failures | Throughput | p95 latency |
|---|---:|---:|---:|---:|---:|
| Normal | 200 | 0 | 0 | 75.7 obs/s | 15.98 ms |
| Attack | 200 | 192 | 0 | 31.25 obs/s | 32.09 ms |

- Real promoted models
- Disposable database
- Prediction and alert event counts
- Failures, throughput, p50/p95 end-to-end latency
- Playwright covers the jury path

---

## 10 — What the result proves

It proves a reproducible in-dataset research baseline and a working full-stack replay/investigation loop.

It does not prove live-network accuracy, cross-site generalization, calibrated risk, production capacity or autonomous response safety.

---

## 11 — Future work

After the jury, validate each separately:

- live capture and PCAP feature parity;
- temporal/device/external validation;
- drift and calibrated operating thresholds;
- identity/MUD policies and edge deployment;
- authentication, queues and horizontal scale.

---

## 12 — Questions

Repository evidence: dataset manifest, evaluation report, benchmark report, automated preflight.

---

# Appendix A — Threshold policy

Show validation recall, precision, FPR and alert rate across detector thresholds. Explain why the deployed threshold was retained or changed using validation evidence only.

---

# Appendix B — Rare-class support

Show support and recall for every attack family. Give confidence intervals if calculated; otherwise state that small support makes estimates unstable.

---

# Appendix C — Reproducibility commands

```bash
make jury-preflight
make benchmark
make demo
```

Training is intentionally separate and never happens during demo startup.
