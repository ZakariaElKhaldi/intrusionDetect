from __future__ import annotations

import hashlib
import json
import socket
import struct
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.features.canonical_schema import FEATURE_ORDER, FlowObservation
from app.features.cicflowmeter_adapter import (
    UnsupportedCICFlowMeterAdapterError,
    map_cicflowmeter_features,
)
from app.features.nfstream_extractor import (
    MANIFEST,
    _ensure_pcap,
    deterministic_event_id,
    extract_pcap,
    file_sha256,
    flow_to_features,
    synthetic_flow,
    validate_invariants,
)
from app.features.zeek_adapter import UnsupportedZeekAdapterError, map_zeek_features
from app.ingestion import pcap_cli
from app.ingestion.live_capture import LiveCaptureDisabledError, require_authorized_capture
from app.ingestion.pcap_replay import PcapCompatibilityError, require_validated_extractor

FIXTURE = Path(__file__).parent / "fixtures/pcap/golden_flows.json"


def _packet(value: dict, protocol: int) -> SimpleNamespace:
    ip_packet = bytearray(40 if protocol == 6 else 28)
    ip_packet[0] = 0x45
    if protocol == 6:
        ip_packet[34:36] = int(value.get("window", 0)).to_bytes(2, "big")
    return SimpleNamespace(
        time=value["time_ms"],
        direction=value["direction"],
        payload_size=value["payload_size"],
        ip_size=value["ip_size"],
        protocol=protocol,
        ip_packet=bytes(ip_packet),
        **{
            flag: value.get(flag, False)
            for flag in ("fin", "syn", "rst", "psh", "ack", "urg", "cwr", "ece")
        },
    )


def _flow(name: str, spec: dict) -> SimpleNamespace:
    packets = [_packet(item, spec["protocol"]) for item in spec["packets"]]
    return synthetic_flow(
        packets,
        src_ip="192.0.2.10",
        dst_ip="198.51.100.20",
        src_port=spec["src_port"],
        dst_port=spec["dst_port"],
        protocol=spec["protocol"],
        application_name=spec["application_name"],
        bidirectional_first_seen_ms=packets[0].time,
        bidirectional_last_seen_ms=packets[-1].time,
        bidirectional_duration_ms=packets[-1].time - packets[0].time,
        id=name,
    )


def _pcap_packet(spec: dict, packet: dict) -> bytes:
    payload = bytes(packet["payload_size"])
    source = "192.0.2.10" if packet["direction"] == 0 else "198.51.100.20"
    destination = "198.51.100.20" if packet["direction"] == 0 else "192.0.2.10"
    source_port = spec["src_port"] if packet["direction"] == 0 else spec["dst_port"]
    destination_port = spec["dst_port"] if packet["direction"] == 0 else spec["src_port"]
    if spec["protocol"] == 6:
        flags = sum(
            value
            for name, value in {
                "fin": 0x01,
                "syn": 0x02,
                "rst": 0x04,
                "psh": 0x08,
                "ack": 0x10,
                "urg": 0x20,
                "ece": 0x40,
                "cwr": 0x80,
            }.items()
            if packet.get(name)
        )
        transport = struct.pack(
            "!HHIIBBHHH",
            source_port,
            destination_port,
            1,
            0,
            5 << 4,
            flags,
            packet.get("window", 0),
            0,
            0,
        )
    else:
        transport = struct.pack("!HHHH", source_port, destination_port, 8 + len(payload), 0)
    total_length = 20 + len(transport) + len(payload)
    ip = struct.pack(
        "!BBHHHBBH4s4s",
        0x45,
        0,
        total_length,
        1,
        0,
        64,
        spec["protocol"],
        0,
        socket.inet_aton(source),
        socket.inet_aton(destination),
    )
    ethernet = bytes.fromhex("00112233445566778899aabb0800")
    return ethernet + ip + transport + payload


def _write_pcap(path: Path, spec: dict) -> None:
    data = bytearray(struct.pack("<IHHIIII", 0xA1B2C3D4, 2, 4, 0, 0, 65535, 1))
    for packet in spec["packets"]:
        frame = _pcap_packet(spec, packet)
        seconds, millis = divmod(packet["time_ms"], 1000)
        data.extend(struct.pack("<IIII", seconds, millis * 1000, len(frame), len(frame)))
        data.extend(frame)
    path.write_bytes(data)


@pytest.fixture(scope="module")
def golden() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_six_golden_packet_scenarios_produce_exact_canonical_features(golden: dict) -> None:
    expected_hashes = {
        "tcp": "2feaa1b82f56386b61b11cdf6cbb6cb3590b6c046ec7e423c9eb64e34b692c54",
        "udp": "848d63b19c2701e4633b945fd6038c13f9d6688d88b8f97f9d5b60d971fca775",
        "mqtt": "7797fb2ee0684d3d00d03239f61025a4b9e53cd8f288bc7f67dfdb2f52a11220",
        "dns": "3df292a697a65933fea67cb35a4416e8ec60be51f0887e0eb9301d03820fc757",
        "syn_flood": "3f9c268419746d242163d411ed2251796ec4e5cb96b4bcad97956a73b4e153d9",
        "scan": "5e7a29b466e5f820b0f4912e00070a87a441d8adcd6b77194e0767e6035700cb",
    }
    for name, spec in golden.items():
        features = flow_to_features(_flow(name, spec))
        assert tuple(features) == FEATURE_ORDER
        digest = hashlib.sha256(
            json.dumps(features, separators=(",", ":"), sort_keys=False).encode()
        ).hexdigest()
        assert digest == expected_hashes[name]


def test_six_scenarios_generate_deterministic_valid_pcap_files(
    golden: dict, tmp_path: Path
) -> None:
    for name, spec in golden.items():
        first = tmp_path / f"{name}.pcap"
        second = tmp_path / f"{name}-copy.pcap"
        _write_pcap(first, spec)
        _write_pcap(second, spec)
        _ensure_pcap(first)
        assert file_sha256(first) == file_sha256(second)


def test_actual_nfstream_offline_extraction_for_all_golden_pcaps(
    golden: dict, tmp_path: Path
) -> None:
    pytest.importorskip("nfstream")
    expected_hashes = {
        "tcp": "2feaa1b82f56386b61b11cdf6cbb6cb3590b6c046ec7e423c9eb64e34b692c54",
        "udp": "f29fb442372d6e4d276547b7ed28bf92cdd477838479255d81dfedffe26f8d14",
        "mqtt": "7797fb2ee0684d3d00d03239f61025a4b9e53cd8f288bc7f67dfdb2f52a11220",
        "dns": "3df292a697a65933fea67cb35a4416e8ec60be51f0887e0eb9301d03820fc757",
        "syn_flood": "3f9c268419746d242163d411ed2251796ec4e5cb96b4bcad97956a73b4e153d9",
        "scan": "5e7a29b466e5f820b0f4912e00070a87a441d8adcd6b77194e0767e6035700cb",
    }
    for name, spec in golden.items():
        capture = tmp_path / f"{name}.pcap"
        _write_pcap(capture, spec)
        extracted = list(extract_pcap(capture))
        assert len(extracted) == 1
        observation, context = extracted[0]
        assert observation.network_context is not None
        assert observation.network_context.extractor_fingerprint == MANIFEST.fingerprint
        assert context["capture_id"] == file_sha256(capture)
        assert validate_invariants(observation) == []
        digest = hashlib.sha256(
            json.dumps(observation.features, separators=(",", ":")).encode()
        ).hexdigest()
        assert digest == expected_hashes[name]


def test_feature_semantics_and_invariants(golden: dict) -> None:
    tcp = flow_to_features(_flow("tcp", golden["tcp"]))
    assert tcp["flow_duration"] == pytest.approx(0.02)
    assert tcp["flow_iat.tot"] == 20_000
    assert tcp["fwd_init_window_size"] == 64_240
    assert tcp["bwd_init_window_size"] == 65_535
    assert tcp["fwd_last_window_size"] == 64_000
    assert tcp["service"] == "ssl"
    observation = FlowObservation(
        event_id="ecf71904-6d5a-4fa8-a5db-9a8cb5947d15",
        flow_started_at="2026-01-01T00:00:00Z",
        flow_ended_at="2026-01-01T00:00:01Z",
        source="pcap-validation",
        features=tcp,
    )
    assert validate_invariants(observation) == []


def test_deterministic_event_id_uses_checksum_tuple_and_timestamps(golden: dict) -> None:
    flow = _flow("mqtt", golden["mqtt"])
    first = deterministic_event_id("a" * 64, flow)
    assert deterministic_event_id("a" * 64, flow) == first
    assert deterministic_event_id("b" * 64, flow) != first


def test_manifest_is_versioned_deterministic_and_not_inference_compatible() -> None:
    assert MANIFEST.schema_version == "nfstream-iot-v1"
    assert MANIFEST.extractor_version == "2.0.0"
    assert len(MANIFEST.fingerprint) == 64
    assert MANIFEST.inference_compatible is False


def test_inference_gate_rejects_caller_authored_evidence() -> None:
    with pytest.raises(PcapCompatibilityError, match="caller-authored"):
        require_validated_extractor()
    evidence = {
        "schema_version": MANIFEST.schema_version,
        "extractor_fingerprint": MANIFEST.fingerprint,
        "inference_compatible": True,
        "validated_fixture_checksums": ["a" * 64],
        "compatible_model_versions": {"detector": "detector-v1", "classifier": "classifier-v1"},
    }
    with pytest.raises(PcapCompatibilityError, match="server verifies"):
        require_validated_extractor(evidence)


def test_unvalidated_legacy_adapters_and_live_capture_fail_explicitly() -> None:
    with pytest.raises(UnsupportedZeekAdapterError):
        map_zeek_features({"proto": "tcp"})
    with pytest.raises(UnsupportedCICFlowMeterAdapterError):
        map_cicflowmeter_features({"Protocol": "6"})
    with pytest.raises(LiveCaptureDisabledError, match="disabled"):
        require_authorized_capture(True)


def test_pcap_ingest_cli_counts_api_dispositions(
    golden: dict, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    capture = tmp_path / "approved.pcap"
    _write_pcap(capture, golden["mqtt"])
    flow = _flow("mqtt", golden["mqtt"])
    observation = FlowObservation(
        event_id=deterministic_event_id(file_sha256(capture), flow),
        flow_started_at="2026-01-01T00:00:00Z",
        flow_ended_at="2026-01-01T00:00:01Z",
        source="pcap-validation",
        features=flow_to_features(flow),
    )
    output = tmp_path / "result.json"
    monkeypatch.setattr(pcap_cli, "extract_pcap", lambda _path: iter([(observation, {})]))
    monkeypatch.setattr(
        pcap_cli,
        "_post_batch",
        lambda _url, _batch: {
            "events": [
                {"disposition": "accepted"},
                {"disposition": "duplicate"},
            ]
        },
    )
    assert (
        pcap_cli.main(
            [
                "ingest",
                str(capture),
                "--output",
                str(output),
            ]
        )
        == 0
    )
    result = json.loads(output.read_text(encoding="utf-8"))
    assert result["accepted"] == 1
    assert result["duplicates"] == 1
    assert result["rejected"] == 0
