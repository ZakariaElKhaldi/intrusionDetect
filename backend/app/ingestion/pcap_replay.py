from __future__ import annotations


class PcapCompatibilityError(RuntimeError):
    pass


def require_validated_extractor(*_args: object, **_kwargs: object) -> None:
    raise PcapCompatibilityError(
        "caller-authored compatibility evidence is no longer accepted; the ingestion "
        "server verifies checksum-linked evidence embedded in its active native model bundle"
    )
