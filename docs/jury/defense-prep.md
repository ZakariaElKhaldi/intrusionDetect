# Defense preparation

## Why is the dataset imbalanced?

RT-IoT2022 reflects very different volumes per traffic/attack label. Accuracy would hide minority failures, so the project reports macro-F1, per-family recall, confusion matrices and support. Class imbalance remains a limitation, especially for rare families.

## Why remove duplicate rows?

If identical feature vectors cross train and test, memorization can inflate the apparent generalization result. Deduplication happens before the shared split, and the gate verifies that duplicate flows cannot cross partitions.

## Why use one shared split for both stages?

The family classifier sees only attack rows, but they are selected from the same train/validation/test partitions as the detector. Therefore an attack in the cascade test cannot have trained the second stage.

## Why is a random split insufficient?

It measures reproducibility inside this dataset, not transfer to a future time, device, network or capture tool. The distributed table lacks reliable grouping/session/timestamp metadata for a defensible realistic split, so that validation is reported as unavailable rather than simulated.

## Are the displayed scores probabilities?

They are uncalibrated `predict_proba` scores. They rank model confidence but should not be interpreted as a verified real-world probability of attack. Calibration requires separate held-out evidence.

## Why retain the current detector threshold?

The validation threshold curve shows the trade-off among recall, precision, false-positive rate and alert rate. The policy is changed only if validation evidence supports it; the test set is not used to tune the threshold.

## What is the extractor discrepancy?

The backend accepts the exact 83-feature RT-IoT2022-compatible schema. A live PCAP/Zeek/CICFlowMeter adapter has not been shown to reproduce those values. Dataset replay validates the serving loop but does not solve feature parity for live traffic.

## Can you trust rare-class metrics?

Only in proportion to their support. A high recall based on few test examples has high uncertainty. The UI and report expose support beside the metric so the limitation is visible.

## What does SHAP prove?

SHAP decomposes a selected model output into signed feature contributions under a defined explainer. Additivity is tested numerically. It does not establish that a feature caused an attack, and it is kept separate from severity rules and raw evidence.

## Why is replay not live capture?

Replay reads recorded rows in CSV order and submits them to the same inference/persistence/event path. It tests system integration and analyst workflow, but not packet collection, online feature extraction, network timing or deployment robustness.

## Why two stages instead of one ten-class model?

The separation matches the operational decision: first decide whether an alert is warranted, then characterize attacks only. It also makes detector false negatives explicit. The cascade is evaluated end to end so the second-stage score cannot hide routing errors.

## Is this production ready?

No. It is jury-ready when all acceptance checks pass, but production use additionally needs external/temporal validation, live feature parity, access control, operational monitoring, calibration, retention policy, adversarial testing and capacity engineering.
