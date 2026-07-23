from __future__ import annotations


def require_authorized_capture(authorized: bool) -> None:
    if not authorized:
        raise PermissionError("live capture must be explicitly authorized")

