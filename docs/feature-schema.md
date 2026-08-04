# Canonical Feature Schema

The compatibility boundary is `rt-iot2022-v1`. Its machine-readable source of
truth is [`data/schema/rt_iot2022_v1.json`](../data/schema/rt_iot2022_v1.json).
The contract freezes names, order, and runtime types; it does not establish that
an external flow extractor produces equivalent values.

## Observation envelope

```json
{
  "schema_version": "rt-iot2022-v1",
  "event_id": "UUID",
  "flow_started_at": "ISO-8601 timestamp",
  "flow_ended_at": "ISO-8601 timestamp",
  "source": "dataset-replay",
  "features": {},
  "ground_truth": null
}
```

The API requires exactly the 83 features in canonical insertion order.
`flow_ended_at` cannot precede `flow_started_at`. Unknown envelope fields,
missing or extra features, blank categorical values, booleans in numeric
fields, non-finite numbers, nested feature values, and unsupported schema
versions are rejected.

`ground_truth` is optional serving metadata. It is never an input feature.

## Dataset and target profile

- Source target: `Attack_type`.
- Categorical model features: `proto` and `service`.
- Numeric model features: the other 81 ordered fields, all finite and
  float-compatible.
- Binary target: known normal aliases map to `normal`; every other label maps to
  `attack`.
- Second-stage target: original attack-family labels from attack rows only.
- Removed source fields: `Unnamed:*` and `no`, which are CSV index artifacts.

The verified archive contains these labels:

| Role | Observed labels |
|---|---|
| Normal | `MQTT_Publish`, `Thing_Speak`, `Wipro_bulb` |
| Attack | `ARP_poisioning`, `DDOS_Slowloris`, `DOS_SYN_Hping`, `Metasploit_Brute_Force_SSH`, `NMAP_FIN_SCAN`, `NMAP_OS_DETECTION`, `NMAP_TCP_scan`, `NMAP_UDP_SCAN`, `NMAP_XMAS_TREE_SCAN` |

The schema retains normal-name aliases found in source descriptions or earlier
variants (`MQTT`, `Thing_speak`, `Wipro_bulb_Dataset`, `Amazon-Alexa`) so binary
mapping is explicit and conservative. Their presence in the alias list does not
claim that those strings occur in the checksummed CSV.

## Training and serving ownership

The packaged scikit-learn pipeline owns imputation, categorical encoding,
scaling where applicable, and feature order. These transformations are fitted
only on training data. The API does not recreate preprocessing independently.

Although candidate pipelines contain imputers, the current dataset and API
contracts reject missing values before inference. The imputer is defensive
pipeline encapsulation, not permission for upstream data loss.

## Time semantics

The source table has no validated observation timestamp. During dataset replay,
the backend assigns current envelope timestamps as each row is emitted. Those
timestamps measure replay processing and do not recover original capture time.
CSV order is deterministic but must not be called chronological.

## Extractor compatibility

The [UCI record](https://archive.ics.uci.edu/dataset/942/rt-iot2022) says Zeek
with a Flowmeter plugin captured bidirectional attributes. The
[introductory paper](https://doi.org/10.1186/s42400-023-00178-5) describes
Wireshark PCAP capture followed by CICFlowMeter CSV extraction. The UCI variable
table also leaves most units unspecified.

Therefore the repository's Zeek and CICFlowMeter modules are placeholders, not
validated adapters. Before PCAP or live ingestion is enabled, controlled TCP,
UDP, MQTT, DNS, SYN, and isolated scan scenarios must compare:

- names, order, types, and categorical vocabulary;
- units, directions, and flow timeout rules;
- TCP flag encoding;
- packet, payload, bulk, active, and idle counters; and
- missing, zero, infinity, and boundary behavior.

Until those experiments pass, prepared-dataset replay and directly validated
observations are the only supported ingestion modes.
