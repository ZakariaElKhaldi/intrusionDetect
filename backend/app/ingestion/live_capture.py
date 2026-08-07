from __future__ import annotations


class LiveCaptureDisabledError(RuntimeError):
    pass


def require_authorized_capture(authorized: bool) -> None:
    del authorized
    raise LiveCaptureDisabledError(
        "live network-interface capture is disabled until offline PCAP feature "
        "compatibility is demonstrated and a separate capture authorization is implemented"
    )
