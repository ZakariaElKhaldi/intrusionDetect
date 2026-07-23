from __future__ import annotations


class PcapCompatibilityError(RuntimeError):
    pass


def require_validated_extractor() -> None:
    raise PcapCompatibilityError(
        "PCAP replay requires a Zeek/CICFlowMeter adapter validated against rt-iot2022-v1"
    )

