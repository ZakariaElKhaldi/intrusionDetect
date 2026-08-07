from __future__ import annotations

import hashlib
import json
import math
import statistics
from collections.abc import Iterable, Iterator
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid5

from app.features.canonical_schema import FEATURE_ORDER, SCHEMA_VERSION, FlowObservation

try:  # NFStream is an explicit optional dependency.
    from nfstream import NFPlugin, NFStreamer
except ImportError:  # pragma: no cover - exercised through the explicit dependency error
    NFPlugin = object  # type: ignore[assignment,misc]
    NFStreamer = None

EXTRACTOR_NAME = "nfstream-rt-iot2022-v1"
EXTRACTOR_VERSION = "1.0.0"
EVENT_NAMESPACE = UUID("9594e62d-68ae-579b-ad86-47af4148f4e1")


@dataclass(frozen=True, slots=True)
class ExtractorManifest:
    extractor: str = EXTRACTOR_NAME
    extractor_version: str = EXTRACTOR_VERSION
    schema_version: str = SCHEMA_VERSION
    direction: str = "first packet defines src2dst"
    idle_timeout_seconds: int = 120
    active_timeout_seconds: int = 1800
    activity_gap_microseconds: int = 5_000_000
    subflow_gap_microseconds: int = 1_000_000
    bulk_gap_microseconds: int = 1_000_000
    bulk_min_payload_packets: int = 4
    accounting_mode: int = 0
    duration_unit: str = "seconds"
    iat_active_idle_unit: str = "microseconds"
    size_unit: str = "bytes"
    dispersion: str = "population standard deviation; singleton is zero"
    payload_policy: str = "NFPacket payload_size; zero-payload packets remain in packet statistics"
    header_policy: str = "ip_size minus payload_size"
    service_policy: str = "nDPI application root, TLS normalized to ssl, then known-port fallback"
    zero_value_policy: str = "missing direction or undefined rate/statistic is represented as 0"
    subflow_policy: str = "new subflow after a strictly greater than one-second packet gap"
    bulk_policy: str = (
        "at least four positive-payload same-direction packets within one-second gaps"
    )
    unknown_service: str = "-"
    inference_compatible: bool = False
    compatibility_reason: str = (
        "RT-IoT2022 source PCAPs and authoritative extractor settings are unavailable; "
        "schema compatibility does not prove value compatibility"
    )

    @property
    def fingerprint(self) -> str:
        encoded = json.dumps(asdict(self), sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(encoded).hexdigest()


MANIFEST = ExtractorManifest()


class NFStreamUnavailableError(RuntimeError):
    pass


class ExtractorCompatibilityError(RuntimeError):
    pass


def _stats(values: Iterable[float]) -> tuple[float, float, float, float, float]:
    items = [float(value) for value in values]
    if not items:
        return (0.0, 0.0, 0.0, 0.0, 0.0)
    return (
        min(items),
        max(items),
        sum(items),
        statistics.fmean(items),
        statistics.pstdev(items) if len(items) > 1 else 0.0,
    )


def _tcp_window(packet: Any) -> int:
    raw = bytes(getattr(packet, "ip_packet", b""))
    if not raw or getattr(packet, "protocol", 0) != 6:
        return 0
    version = raw[0] >> 4
    if version == 4:
        offset = (raw[0] & 0x0F) * 4
    elif version == 6:
        offset = 40
    else:
        return 0
    return int.from_bytes(raw[offset + 14 : offset + 16], "big") if len(raw) >= offset + 16 else 0


def _new_accumulator() -> dict[str, Any]:
    return {
        "packets": [],
        "payloads": [[], []],
        "headers": [[], []],
        "iats": [[], []],
        "flow_iats": [],
        "last_direction_time": [None, None],
        "last_time": None,
        "flags": {
            flag: [0, 0] for flag in ("fin", "syn", "rst", "psh", "ack", "urg", "cwr", "ece")
        },
        "windows": [[], []],
    }


def _record_packet(acc: dict[str, Any], packet: Any) -> None:
    direction = int(packet.direction)
    when_us = int(packet.time) * 1_000
    payload = max(0, int(packet.payload_size))
    header = max(0, int(packet.ip_size) - payload)
    previous = acc["last_time"]
    if previous is not None:
        acc["flow_iats"].append(when_us - previous)
    direction_previous = acc["last_direction_time"][direction]
    if direction_previous is not None:
        acc["iats"][direction].append(when_us - direction_previous)
    acc["last_time"] = when_us
    acc["last_direction_time"][direction] = when_us
    acc["payloads"][direction].append(payload)
    acc["headers"][direction].append(header)
    acc["packets"].append((when_us, direction, payload))
    for flag in acc["flags"]:
        acc["flags"][flag][direction] += int(bool(getattr(packet, flag, False)))
    if getattr(packet, "protocol", 0) == 6:
        acc["windows"][direction].append(_tcp_window(packet))


class RTIoT2022Plugin(NFPlugin):  # type: ignore[misc]
    """Packet-level measurements that NFStream's core flow does not expose."""

    def on_init(self, packet: Any, flow: Any) -> None:
        flow.udps.rt_iot = _new_accumulator()
        _record_packet(flow.udps.rt_iot, packet)

    def on_update(self, packet: Any, flow: Any) -> None:
        _record_packet(flow.udps.rt_iot, packet)


def _period_metrics(times: list[int], gap: int) -> tuple[list[float], list[float]]:
    if not times:
        return [], []
    starts = [times[0]]
    ends: list[int] = []
    idle: list[float] = []
    for before, after in zip(times, times[1:], strict=False):
        delta = after - before
        if delta > gap:
            ends.append(before)
            idle.append(float(delta))
            starts.append(after)
    ends.append(times[-1])
    return [float(end - start) for start, end in zip(starts, ends, strict=True)], idle


def _subflow_metrics(packets: list[tuple[int, int, int]]) -> tuple[float, float, float, float]:
    if not packets:
        return (0.0, 0.0, 0.0, 0.0)
    groups: list[list[tuple[int, int, int]]] = [[packets[0]]]
    for packet in packets[1:]:
        if packet[0] - groups[-1][-1][0] > MANIFEST.subflow_gap_microseconds:
            groups.append([])
        groups[-1].append(packet)
    count = len(groups)
    fwd_pkts = sum(direction == 0 for group in groups for _, direction, _ in group) / count
    bwd_pkts = sum(direction == 1 for group in groups for _, direction, _ in group) / count
    fwd_bytes = (
        sum(payload for group in groups for _, direction, payload in group if direction == 0)
        / count
    )
    bwd_bytes = (
        sum(payload for group in groups for _, direction, payload in group if direction == 1)
        / count
    )
    return (fwd_pkts, bwd_pkts, fwd_bytes, bwd_bytes)


def _bulk_metrics(
    packets: list[tuple[int, int, int]], direction: int
) -> tuple[float, float, float]:
    payload_packets = [packet for packet in packets if packet[1] == direction and packet[2] > 0]
    runs: list[list[tuple[int, int, int]]] = []
    for packet in payload_packets:
        if not runs or packet[0] - runs[-1][-1][0] > MANIFEST.bulk_gap_microseconds:
            runs.append([])
        runs[-1].append(packet)
    qualifying = [run for run in runs if len(run) >= MANIFEST.bulk_min_payload_packets]
    byte_count = float(sum(packet[2] for run in qualifying for packet in run))
    packet_count = float(sum(len(run) for run in qualifying))
    duration = sum(max(0, run[-1][0] - run[0][0]) for run in qualifying) / 1_000_000
    return byte_count, packet_count, byte_count / duration if duration > 0 else 0.0


def _service(flow: Any) -> str:
    application = str(getattr(flow, "application_name", "") or "").split(".", 1)[0].lower()
    if application in {"tls", "ssl"}:
        return "ssl"
    if application and application not in {"unknown", "unspecified"}:
        return application
    port = int(getattr(flow, "dst_port", 0))
    return {22: "ssh", 53: "dns", 80: "http", 443: "ssl", 1883: "mqtt"}.get(
        port, MANIFEST.unknown_service
    )


def flow_to_features(flow: Any) -> dict[str, Any]:
    acc = flow.udps.rt_iot
    packets = acc["packets"]
    fwd_payload = acc["payloads"][0]
    bwd_payload = acc["payloads"][1]
    all_payload = fwd_payload + bwd_payload
    duration = max(0.0, float(flow.bidirectional_duration_ms) / 1_000)
    fwd_count = float(len(fwd_payload))
    bwd_count = float(len(bwd_payload))
    fwd_payload_stats = _stats(fwd_payload)
    bwd_payload_stats = _stats(bwd_payload)
    flow_payload_stats = _stats(all_payload)
    fwd_iat = _stats(acc["iats"][0])
    bwd_iat = _stats(acc["iats"][1])
    flow_iat = _stats(acc["flow_iats"])
    active, idle = _period_metrics(
        [packet[0] for packet in packets], MANIFEST.activity_gap_microseconds
    )
    active_stats = _stats(active)
    idle_stats = _stats(idle)
    subflow = _subflow_metrics(packets)
    fwd_bulk = _bulk_metrics(packets, 0)
    bwd_bulk = _bulk_metrics(packets, 1)
    fwd_headers = acc["headers"][0]
    bwd_headers = acc["headers"][1]
    flags = acc["flags"]
    values: dict[str, Any] = {
        "id.orig_p": float(flow.src_port),
        "id.resp_p": float(flow.dst_port),
        "proto": {6: "tcp", 17: "udp"}.get(int(flow.protocol), str(flow.protocol)),
        "service": _service(flow),
        "flow_duration": duration,
        "fwd_pkts_tot": fwd_count,
        "bwd_pkts_tot": bwd_count,
        "fwd_data_pkts_tot": float(sum(value > 0 for value in fwd_payload)),
        "bwd_data_pkts_tot": float(sum(value > 0 for value in bwd_payload)),
        "fwd_pkts_per_sec": fwd_count / duration if duration else 0.0,
        "bwd_pkts_per_sec": bwd_count / duration if duration else 0.0,
        "flow_pkts_per_sec": (fwd_count + bwd_count) / duration if duration else 0.0,
        "down_up_ratio": bwd_count / fwd_count if fwd_count else 0.0,
        "fwd_header_size_tot": float(sum(fwd_headers)),
        "fwd_header_size_min": float(min(fwd_headers, default=0)),
        "fwd_header_size_max": float(max(fwd_headers, default=0)),
        "bwd_header_size_tot": float(sum(bwd_headers)),
        "bwd_header_size_min": float(min(bwd_headers, default=0)),
        "bwd_header_size_max": float(max(bwd_headers, default=0)),
        "flow_FIN_flag_count": float(sum(flags["fin"])),
        "flow_SYN_flag_count": float(sum(flags["syn"])),
        "flow_RST_flag_count": float(sum(flags["rst"])),
        "fwd_PSH_flag_count": float(flags["psh"][0]),
        "bwd_PSH_flag_count": float(flags["psh"][1]),
        "flow_ACK_flag_count": float(sum(flags["ack"])),
        "fwd_URG_flag_count": float(flags["urg"][0]),
        "bwd_URG_flag_count": float(flags["urg"][1]),
        "flow_CWR_flag_count": float(sum(flags["cwr"])),
        "flow_ECE_flag_count": float(sum(flags["ece"])),
        "payload_bytes_per_second": sum(all_payload) / duration if duration else 0.0,
        "fwd_subflow_pkts": subflow[0],
        "bwd_subflow_pkts": subflow[1],
        "fwd_subflow_bytes": subflow[2],
        "bwd_subflow_bytes": subflow[3],
        "fwd_bulk_bytes": fwd_bulk[0],
        "bwd_bulk_bytes": bwd_bulk[0],
        "fwd_bulk_packets": fwd_bulk[1],
        "bwd_bulk_packets": bwd_bulk[1],
        "fwd_bulk_rate": fwd_bulk[2],
        "bwd_bulk_rate": bwd_bulk[2],
        "fwd_init_window_size": float(acc["windows"][0][0] if acc["windows"][0] else 0),
        "bwd_init_window_size": float(acc["windows"][1][0] if acc["windows"][1] else 0),
        "fwd_last_window_size": float(acc["windows"][0][-1] if acc["windows"][0] else 0),
    }
    for prefix, stat_values in (
        ("fwd_pkts_payload", fwd_payload_stats),
        ("bwd_pkts_payload", bwd_payload_stats),
        ("flow_pkts_payload", flow_payload_stats),
        ("fwd_iat", fwd_iat),
        ("bwd_iat", bwd_iat),
        ("flow_iat", flow_iat),
        ("active", active_stats),
        ("idle", idle_stats),
    ):
        for suffix, value in zip(("min", "max", "tot", "avg", "std"), stat_values, strict=True):
            values[f"{prefix}.{suffix}"] = value
    return {name: values[name] for name in FEATURE_ORDER}


def deterministic_event_id(pcap_checksum: str, flow: Any) -> UUID:
    identity = "|".join(
        str(value)
        for value in (
            pcap_checksum,
            flow.src_ip,
            flow.src_port,
            flow.dst_ip,
            flow.dst_port,
            flow.protocol,
            flow.bidirectional_first_seen_ms,
            flow.bidirectional_last_seen_ms,
        )
    )
    return uuid5(EVENT_NAMESPACE, identity)


def _ensure_pcap(path: Path) -> None:
    if not path.is_file():
        raise FileNotFoundError(path)
    with path.open("rb") as handle:
        magic = handle.read(4)
    if magic not in {
        b"\xd4\xc3\xb2\xa1",
        b"\xa1\xb2\xc3\xd4",
        b"\x4d\x3c\xb2\xa1",
        b"\xa1\xb2\x3c\x4d",
        b"\x0a\x0d\x0d\x0a",
    }:
        raise ValueError("capture is not a recognized PCAP or PCAP-NG file")


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def extract_pcap(path: str | Path) -> Iterator[tuple[FlowObservation, dict[str, Any]]]:
    capture = Path(path).expanduser().resolve()
    _ensure_pcap(capture)
    if NFStreamer is None:
        raise NFStreamUnavailableError(
            "NFStream is required for PCAP extraction; install the backend 'pcap' extra"
        )
    checksum = file_sha256(capture)
    streamer = NFStreamer(
        source=str(capture),
        decode_tunnels=True,
        idle_timeout=MANIFEST.idle_timeout_seconds,
        active_timeout=MANIFEST.active_timeout_seconds,
        accounting_mode=MANIFEST.accounting_mode,
        udps=RTIoT2022Plugin(),
        n_dissections=20,
        statistical_analysis=True,
        splt_analysis=0,
        n_meters=1,
    )
    for flow in streamer:
        started = datetime.fromtimestamp(flow.bidirectional_first_seen_ms / 1000, tz=UTC)
        ended = datetime.fromtimestamp(flow.bidirectional_last_seen_ms / 1000, tz=UTC)
        context = {
            "source_ip": flow.src_ip,
            "destination_ip": flow.dst_ip,
            "source_port": flow.src_port,
            "destination_port": flow.dst_port,
            "protocol": {6: "tcp", 17: "udp"}.get(int(flow.protocol), str(flow.protocol)),
            "capture_id": checksum,
            "extractor_fingerprint": MANIFEST.fingerprint,
        }
        observation = FlowObservation(
            event_id=deterministic_event_id(checksum, flow),
            flow_started_at=started,
            flow_ended_at=ended,
            source="pcap-validation",
            features=flow_to_features(flow),
            network_context=context,
        )
        yield observation, context


def validate_invariants(observation: FlowObservation) -> list[str]:
    values = observation.features
    failures: list[str] = []
    if tuple(values) != FEATURE_ORDER:
        failures.append("feature order does not match canonical schema")
    if any(
        not math.isfinite(float(values[name]))
        for name in FEATURE_ORDER
        if name not in {"proto", "service"}
    ):
        failures.append("numeric features must be finite")
    for name in FEATURE_ORDER:
        if name.endswith(("_tot", "_count", "_size", ".min", ".max", ".tot", ".avg", ".std")):
            if name not in {"proto", "service"} and float(values[name]) < 0:
                failures.append(f"{name} must be non-negative")
    if values["flow_pkts_payload.tot"] != (
        values["fwd_pkts_payload.tot"] + values["bwd_pkts_payload.tot"]
    ):
        failures.append("bidirectional payload total is inconsistent")
    return failures


def validation_report(path: str | Path) -> dict[str, Any]:
    capture = Path(path).expanduser().resolve()
    checksum = file_sha256(capture)
    flows = []
    failures: list[str] = []
    for observation, context in extract_pcap(capture):
        flow_failures = validate_invariants(observation)
        failures.extend(f"{observation.event_id}: {failure}" for failure in flow_failures)
        flows.append(
            {
                "event_id": str(observation.event_id),
                "flow_started_at": observation.flow_started_at.isoformat(),
                "flow_ended_at": observation.flow_ended_at.isoformat(),
                "network_context": context,
                "features": observation.features,
                "invariant_failures": flow_failures,
            }
        )
    return {
        "capture": str(capture),
        "pcap_checksum": checksum,
        "extractor_manifest": asdict(MANIFEST),
        "extractor_fingerprint": MANIFEST.fingerprint,
        "schema_version": SCHEMA_VERSION,
        "flow_count": len(flows),
        "inference_compatible": False,
        "invariant_failures": failures,
        "flows": flows,
    }


def synthetic_flow(packets: Iterable[Any], **overrides: Any) -> Any:
    """Build a deterministic flow from packet-like values for golden unit fixtures."""
    packet_list = list(packets)
    if not packet_list:
        raise ValueError("a synthetic flow requires at least one packet")
    flow = SimpleNamespace(udps=SimpleNamespace(), **overrides)
    plugin = RTIoT2022Plugin()
    plugin.on_init(packet_list[0], flow)
    for packet in packet_list[1:]:
        plugin.on_update(packet, flow)
    return flow
