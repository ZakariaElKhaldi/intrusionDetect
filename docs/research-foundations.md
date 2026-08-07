# Research Foundations and Source Audit

Research and implementation status reviewed on 2026-08-04. This document uses
primary sources where possible and separates source claims, locally verified
facts, implementation decisions, and untested hypotheses.

## 1. Evidence hierarchy

For this project, evidence is ordered as follows:

1. the checksum-verified downloaded CSV for row-level experimental facts;
2. generated profiles, evaluation reports, and executable tests for repository
   behavior;
3. the UCI record and introductory paper for provenance and collection context;
4. external research for risks and candidate methods; and
5. future design proposals, which must not be described as implemented results.

This ordering matters because the public metadata and the downloaded file are
not fully consistent.

## 2. RT-IoT2022: source claims versus verified artifact

The [UCI repository record](https://archive.ics.uci.edu/dataset/942/rt-iot2022)
describes RT-IoT2022 as tabular, sequential, and multivariate, with 123,117
instances and 83 features. It lists IoT traffic and attacks including MQTT,
ThingSpeak, a Wipro bulb, SSH brute force, Hping/Slowloris, ARP poisoning, and
Nmap activity. The dataset DOI is
[10.24432/C5P338](https://doi.org/10.24432/C5P338), and UCI publishes it under
CC BY 4.0.

The repository verified the official archive and extracted file:

| Artifact | SHA-256 |
|---|---|
| UCI ZIP | `bcaa24d62abbb1215be576d5cf9c02dfcb0bb7c4c2f5a00e03055afaa1ed109e` |
| Extracted CSV | `956956c09c1764584fa08acd0f6876475626bcedcd6a6b1f8c492c2e9a2089ea` |

Observed class counts in that CSV are:

| Label | Rows | Role |
|---|---:|---|
| `DOS_SYN_Hping` | 94,659 | attack |
| `Thing_Speak` | 8,108 | normal |
| `ARP_poisioning` | 7,750 | attack |
| `MQTT_Publish` | 4,146 | normal |
| `NMAP_UDP_SCAN` | 2,590 | attack |
| `NMAP_XMAS_TREE_SCAN` | 2,010 | attack |
| `NMAP_OS_DETECTION` | 2,000 | attack |
| `NMAP_TCP_scan` | 1,002 | attack |
| `DDOS_Slowloris` | 534 | attack |
| `Wipro_bulb` | 253 | normal |
| `Metasploit_Brute_Force_SSH` | 37 | attack |
| `NMAP_FIN_SCAN` | 28 | attack |

The verified table therefore contains 12,507 normal and 110,610 attack rows;
attacks are 89.84% of the source data. No `Amazon-Alexa` label occurs in the
file. The UCI prose and class list mention Alexa and show counts that do not
reconcile with the stated total, so this project records that discrepancy
instead of silently repeating it.

The table also contains 5,202 duplicate feature vectors. Exact duplicates are
removed before splitting, but near-duplicate or scenario-specific signatures
may remain. Combined with the extreme `DOS_SYN_Hping` concentration, this is a
major reason not to interpret random-split scores as generalization.

## 3. Extraction provenance is unresolved

The UCI page says bidirectional attributes were captured with Zeek and a
Flowmeter plugin. The
[introductory RT-IoT2022 paper](https://doi.org/10.1186/s42400-023-00178-5)
describes Wireshark capture to PCAP followed by CICFlowMeter CSV extraction.
These are materially different accounts, and the UCI variable table leaves most
feature units blank.

Consequences:

- matching 83 column names is insufficient;
- Zeek, CICFlowMeter, and custom code must not be assumed equivalent;
- source/destination addresses and FlowID were removed before publication, so
  the table cannot reconstruct device identity or a physical topology; and
- there is no trustworthy timestamp, device, or capture-session column for a
  temporal or group-aware split.

The next ingestion research must generate controlled PCAPs and compare values,
units, direction rules, timeout behavior, TCP flags, and counters before one
adapter is selected.

## 4. What the current benchmark establishes

The repository compares four tabular pipelines over three stratified seeds and
serves a binary HistGradientBoosting detector followed by an attack-only Random
Forest family classifier. It demonstrates:

- reproducible preparation and packaging;
- strong within-dataset separation after exact-duplicate removal;
- a functioning two-stage software contract; and
- local feasibility of the selected artifact sizes and latency.

It does not establish:

- accuracy on another network, extractor, device population, or time period;
- the end-to-end attack-family recall of the complete cascade;
- calibrated probabilities or an operationally optimized threshold;
- resilience to evasion, poisoning, label error, or drift; or
- production availability and security.

The multiclass stage's test score is conditional on attack rows already reaching
that stage. A detector false negative has no family prediction, so future work
must report end-to-end cascade metrics in addition to standalone stage metrics.

## 5. Generalization is the central validity risk

[Cantone, Marrocco, and Bria (2024)](https://doi.org/10.1109/ACCESS.2024.3472907)
evaluate four classifiers across four network-intrusion datasets. Their
cross-dataset study reports nearly perfect within-dataset results but performance
near random chance for many cross-dataset combinations, linked to dataset
heterogeneity and artifacts.

That study is not an evaluation of RT-IoT2022 itself, but its finding directly
challenges the assumption that this project's 0.996 binary test macro-F1 implies
real-network effectiveness.

Research implications:

- prioritize feature compatibility and external validation over more complex
  classifiers;
- preserve support counts and confusion structure, especially for rare classes;
- obtain reliable session/device/time metadata for realistic splitting;
- evaluate unseen categorical values and distribution changes; and
- keep in-dataset performance visibly separate from deployment readiness.

## 6. Edge detection remains a separate experiment

The RT-IoT2022 paper proposes an autoencoder trained on normal traffic and
post-training quantization for constrained IoT devices. That supports studying
a lightweight anomaly detector, but it does not show that this repository's
83-feature extraction can run correctly on a gateway or that the current
cascade should be quantized.

An edge experiment must include the cost of flow generation, not just model
inference, and measure on actual target hardware:

- model and runtime storage;
- peak and sustained RAM/CPU;
- energy or power where practical;
- median/p95 latency and throughput; and
- recall, false-positive rate, and disagreement with the central model.

Until those measurements exist, “edge compatible” is a research direction, not
a current system property.

## 7. Device behavior and MUD

[NIST IR 8349](https://doi.org/10.6028/NIST.IR.8349), finalized in August 2025,
defines a methodology for capturing and documenting expected IoT network
behavior and using it to support Manufacturer Usage Description policies.
[RFC 8520](https://www.rfc-editor.org/info/rfc8520/) specifies MUD as a way for
devices/manufacturers to describe intended network access.

These sources support a policy layer that is separate from statistical attack
classification. They do not justify inventing device profiles from ports or
claiming that a policy violation proves compromise.

A defensible implementation needs:

- a trustworthy device identity outside the 83-feature vector;
- sourced and versioned expected-communication profiles;
- explicit allow/deny and uncertainty semantics;
- separate model and policy evidence in alerts; and
- analyst feedback measuring whether policy evidence improves prioritization.

The current `device_profiles.py` hook is not such a system and is unreachable
through the strict canonical feature map.

## 8. Explainability

[Lundberg and Lee (2017)](https://proceedings.neurips.cc/paper_files/paper/2017/hash/8a20a8621978632d76c43dfd28b67767-Abstract.html)
define SHAP as an additive feature-attribution framework assigning importance
values to features for a prediction. Attribution can help inspect model
behavior, but it is not causal evidence and does not prove the prediction is
correct.

The current backend returns the largest raw numeric feature values. The UI
correctly labels these as highlighted values, not contributions. Future work
should add:

- permutation importance on held-out data for global analysis;
- local TreeSHAP for the selected tree models;
- the transformed/model feature name alongside the original field;
- direction and baseline/reference value; and
- tests that prevent raw values from being presented as attribution.

## 9. Drift and operational monitoring

Drift cannot be evaluated until compatible observations and stable identity/time
windows exist. A useful first version should monitor data quality before adding
a composite health score:

- schema rejection and missing/non-finite rates;
- unseen categorical values;
- selected feature distributions against a fixed training reference;
- prediction, alert, and score distributions;
- latency and error rates; and
- analyst-confirmed false positives by model version.

Population Stability Index, Jensen-Shannon divergence, KS tests, or streaming
change detectors are candidate signals—not interchangeable proof of harmful
drift. Thresholds must be validated against known changes, and model promotion
must remain explicit rather than automatic.

The implemented model-health path compares bounded, isolated cohorts with a
checksum-bound training reference using calibrated Jensen-Shannon effect limits,
KS tests with multiple-test correction, range/quantile movement, categorical
novelty, and model-output summaries. It remains in shadow mode: distribution
change is evidence of changed traffic, not proof of accuracy loss.

## 10. Updated research questions

1. How much do cascade metrics degrade under capture-session, device, temporal,
   or external-network splits?
2. Can a validated extractor reproduce the published feature values within
   defined tolerances?
3. Which errors arise from the binary gate versus the family classifier?
4. How stable are rare-class results when test support is only 6–7 examples?
5. What threshold meets an explicit false-alert budget after calibration?
6. Do sourced device/MUD policies improve analyst prioritization beyond the ML
   score alone?
7. Which data-quality or drift signals predict confirmed performance loss?
8. What is the full extraction-plus-inference cost on server and edge hardware?

## 11. Current defensible scope

The project is best described as:

> A reproducible, two-stage RT-IoT2022 network-flow classification and replay
> prototype with strict artifact provenance, persistence, live investigation,
> and an explicit path toward extractor, generalization, behavior-policy,
> explanation, and drift validation.

It should not yet be described as a live, explainable, behavior-aware,
drift-monitored, or edge-deployed IDS.

## Primary sources

- [UCI RT-IoT2022 record and dataset DOI](https://archive.ics.uci.edu/dataset/942/rt-iot2022)
- [Sharmila and Nagapadma, RT-IoT2022/QAE paper (2023)](https://doi.org/10.1186/s42400-023-00178-5)
- [Cantone, Marrocco, and Bria, cross-dataset NIDS study (2024)](https://doi.org/10.1109/ACCESS.2024.3472907)
- [NIST IR 8349, IoT device network behavior methodology (2025)](https://doi.org/10.6028/NIST.IR.8349)
- [IETF RFC 8520, Manufacturer Usage Description](https://www.rfc-editor.org/info/rfc8520/)
- [Lundberg and Lee, SHAP (2017)](https://proceedings.neurips.cc/paper_files/paper/2017/hash/8a20a8621978632d76c43dfd28b67767-Abstract.html)
