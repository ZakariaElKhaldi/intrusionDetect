# Research Foundations

This document connects the literature directly to implementation decisions.

## 1. RT-IoT2022 dataset

RT-IoT2022 is a tabular, sequential, multivariate dataset containing **123,117 instances** and **83 features**. It contains normal IoT traffic and adversarial scenarios involving devices and services such as ThingSpeak, MQTT, smart bulbs, Amazon Alexa, SSH brute force, DDoS, Slowloris, Hping, and Nmap activity.

### Design implications

- Treat the target as both a binary problem and a multiclass problem.
- Inspect class counts before training.
- Use macro F1 and per-class recall because rare classes can be hidden by overall accuracy.
- Save the exact feature order, data types, units, categorical mappings, and preprocessing version.
- Build a schema-validation layer before every prediction.

### Important extraction discrepancy

The UCI dataset page states that bidirectional features were captured with **Zeek and a Flowmeter plugin**. The introductory paper describes packet capture with **Wireshark**, conversion to PCAP, and feature extraction with **CICFlowMeter**.

These descriptions are not identical. Therefore:

1. Do not assume Zeek, CICFlowMeter, and a custom Scapy extractor generate equivalent values.
2. Inspect the downloaded dataset and original metadata.
3. Generate controlled PCAP traffic.
4. Compare candidate extractor outputs against the expected columns.
5. Freeze a canonical internal schema and document every transformation.

### Sources

- UCI Machine Learning Repository, RT-IoT2022:  
  https://archive.ics.uci.edu/dataset/942/rt-iot2022
- Sharmila and Nagapadma, 2023:  
  https://doi.org/10.1186/s42400-023-00178-5

---

## 2. Lightweight and edge-compatible detection

The introductory RT-IoT2022 paper proposes quantized autoencoder variants for constrained IoT edge devices. It reports substantial reductions in memory size, average memory use, and peak CPU use for its uint8 variant compared with the unoptimized autoencoder.

### Design implications

The project should compare two deployment tracks:

#### Central classifier

- Random Forest, HistGradientBoosting, XGBoost, or LightGBM
- Full multiclass output
- SHAP explanations
- Runs on the backend server

#### Edge detector

- Reduced-feature tree model, ONNX model, or quantized autoencoder
- Binary anomaly output
- Strict latency and memory targets
- Runs on Raspberry Pi or gateway hardware

Record:

- Serialized model size
- Peak RAM
- Average CPU
- Median and p95 inference latency
- Throughput
- F1 and false-positive rate

### Source

- Quantized autoencoder IDS using RT-IoT2022:  
  https://doi.org/10.1186/s42400-023-00178-5

---

## 3. Generalization is a core risk

Cross-dataset NIDS studies show that models can perform extremely well when trained and tested on one dataset but degrade heavily when evaluated on traffic from a different network or collection process.

### Design implications

- Never describe a high random-split score as proof of real-world effectiveness.
- Separate dataset performance from deployment readiness.
- Add grouped, temporal, and replay-based evaluation.
- Keep an optional external-dataset experiment.
- Show a clear limitations panel in the UI and report.
- Monitor real traffic distributions after deployment.

### Sources

- Cantone, Marrocco, and Bria, cross-dataset generalization study:  
  https://doi.org/10.1109/ACCESS.2024.3472907
- Preprint version:  
  https://arxiv.org/abs/2402.10974
- Layeghy et al., explainable cross-domain evaluation:  
  https://doi.org/10.1016/j.compeleceng.2023.108648

---

## 4. Device behavior profiles

NIST IR 8349 presents a methodology for capturing and documenting the expected network communication behavior of IoT devices. It connects this behavior characterization to Manufacturer Usage Description, or MUD, policies.

### Design implications

The platform should not rely only on a machine-learning label. Add a behavior-rule layer:

```text
Final risk =
    model prediction
  + confidence
  + device profile violation
  + destination reputation or policy
  + alert recurrence
```

Example profile:

```yaml
device_type: smart-bulb
allowed_protocols:
  - dns
  - ntp
  - https
allowed_destinations:
  - vendor-cloud.example
forbidden_services:
  - ssh
  - telnet
```

A smart bulb opening an SSH session should raise severity even when the classifier confidence is moderate.

### Source

- NIST IR 8349, final publication, August 2025:  
  https://doi.org/10.6028/NIST.IR.8349

---

## 5. Explainability

Explainability is useful for IDS error analysis and analyst trust, but it must not be presented as proof that the prediction is correct.

### Design implications

For each important alert, display:

- Predicted class
- Confidence or calibrated probability
- Top positive and negative feature contributions
- Raw feature values
- Comparison with normal ranges
- Device-profile violations
- Model version

Use:

- Global permutation importance for model analysis
- TreeSHAP for supported tree models
- Local SHAP explanations for individual alerts
- Error analysis grouped by class and traffic source

Avoid exposing only a generic feature-importance chart. Analysts need a local explanation for the selected alert.

### Suggested reading

- Explainable AI for comparative analysis of intrusion detection models:  
  https://arxiv.org/abs/2406.09684
- Explainable cross-domain evaluation of ML-based NIDS:  
  https://doi.org/10.1016/j.compeleceng.2023.108648

---

## 6. Concept drift and model health

IoT networks change when firmware, cloud endpoints, user behavior, topology, and attack techniques change. A static model may lose accuracy even when the software remains operational.

### Design implications

Monitor:

- Missing or invalid feature rate
- Feature distribution shift
- Unseen categorical values
- Prediction distribution
- Confidence distribution
- Alert rate per device
- Analyst-confirmed false positives
- Inference latency and errors

Suggested drift signals:

- Population Stability Index
- Jensen-Shannon divergence
- Kolmogorov-Smirnov test for selected numeric features
- ADWIN for streaming statistics
- Alert when several signals move together

Do not automatically replace the production model. Retraining should produce a candidate model that is evaluated and promoted explicitly.

---

## 7. Research questions for the report

1. Which tabular classifier gives the best balance of macro F1, latency, and model size?
2. How much does performance change between random and time/group-aware splits?
3. Which attack classes are consistently confused?
4. How many features are required to retain acceptable performance?
5. Can a lightweight edge model maintain useful recall?
6. Do device behavior rules reduce false negatives or improve alert prioritization?
7. How stable are predictions under dataset replay and PCAP-derived features?
8. Which features drift most between training data and live or simulated traffic?

---

## 8. Final research-backed scope

The recommended final system is:

> A real-time, explainable, behavior-aware, and drift-monitored IoT intrusion detection platform with a reproducible feature pipeline and an optional lightweight edge detector.

This scope is more defensible than claiming that a notebook classifier with high accuracy is a complete IDS.
