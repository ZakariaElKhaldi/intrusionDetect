# Canonical Feature Schema

The compatibility boundary is versioned as `rt-iot2022-v1`. Its
machine-readable definition is
[`data/schema/rt_iot2022_v1.json`](../data/schema/rt_iot2022_v1.json), which is
the source of truth for feature names and order.

## Observation envelope

Every replayed or live observation uses the same contract:

```json
{
  "schema_version": "rt-iot2022-v1",
  "event_id": "UUID",
  "flow_started_at": "ISO-8601",
  "flow_ended_at": "ISO-8601",
  "source": "dataset-replay",
  "features": {},
  "ground_truth": null
}
```

The end timestamp must not precede the start timestamp. Unknown top-level
fields, blank feature names, nested feature values, missing model features,
extra model features, non-finite numeric values, and unsupported schema
versions are invalid.

## Model feature profile

- Target column: `Attack_type`.
- Model inputs: the 83 ordered fields in the machine-readable schema.
- Categorical fields: `proto` and `service`.
- Numeric fields: every other model input, accepted only when finite and
  float-compatible.
- Removed field: `Unnamed: 0`, because it is a CSV index artifact and an
  identifier-like leakage risk.
- Binary target: labels in `normal_labels` map to `normal`; all other labels
  map to `attack`.
- Multiclass target: the original `Attack_type` value.

The preprocessing artifact owns categorical mappings, missing-value handling,
scaling, and feature order. It is fitted only on a training partition and is
packaged with the estimator. API inference must not recreate transformations
independently.

## Units and extractor compatibility

The available UCI metadata does not reliably specify units for every field.
The UCI description also names Zeek with a Flowmeter plugin while the
introductory paper describes Wireshark/PCAP followed by CICFlowMeter. This
project therefore freezes the dataset column contract but does **not** claim
that either live extractor produces equivalent values.

Before a PCAP or live adapter is promoted, controlled TCP, UDP, MQTT, DNS, SYN,
and isolated scan scenarios must compare:

- names and order;
- units and direction rules;
- timeout behavior;
- TCP flag encoding;
- packet and byte counters; and
- missing-value behavior.

Until those Phase 6 checks pass, dataset replay is the only validated ingestion
mode.

