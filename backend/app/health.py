from __future__ import annotations

import csv
import hashlib
from pathlib import Path
from typing import Any

from app.features.canonical_schema import FEATURE_ORDER


class DatasetHealthCache:
    """Cache the expensive dataset checksum until filesystem metadata changes."""

    def __init__(self, dataset_path: str | None, expected_checksum: str | None) -> None:
        self.path = Path(dataset_path).expanduser().resolve() if dataset_path else None
        self.expected_checksum = expected_checksum
        self._signature: tuple[int, int, int] | None = None
        self._cached: dict[str, Any] | None = None

    def status(self) -> dict[str, Any]:
        if self.path is None:
            return self._unavailable("dataset path is not configured")
        try:
            stat = self.path.stat()
            if not self.path.is_file():
                return self._unavailable("dataset path is not a file")
        except OSError as exc:
            self._signature = None
            self._cached = None
            return self._unavailable(f"dataset file is unavailable: {exc}")

        signature = (stat.st_ino, stat.st_size, stat.st_mtime_ns)
        if signature == self._signature and self._cached is not None:
            return dict(self._cached)

        try:
            checksum = self._sha256(self.path)
            with self.path.open(newline="", encoding="utf-8") as handle:
                fields = set(csv.DictReader(handle).fieldnames or ())
            missing = [name for name in (*FEATURE_ORDER, "Attack_type") if name not in fields]
            checksum_matches = (
                checksum == self.expected_checksum if self.expected_checksum else None
            )
            error = f"dataset schema mismatch; missing={missing}" if missing else None
            if error is None and checksum_matches is False:
                error = "dataset checksum does not match the promoted training dataset"
            result = {
                "status": "ready" if error is None else "blocked",
                "ready": error is None,
                "path": str(self.path),
                "checksum": checksum,
                "expected_checksum": self.expected_checksum,
                "checksum_matches_training": checksum_matches,
                "bytes": stat.st_size,
                "error": error,
            }
        except (OSError, UnicodeError, csv.Error) as exc:
            result = self._unavailable(f"dataset cannot be read: {exc}")
        self._signature = signature
        self._cached = dict(result)
        return result

    def _unavailable(self, error: str) -> dict[str, Any]:
        return {
            "status": "blocked",
            "ready": False,
            "path": str(self.path) if self.path else None,
            "checksum": None,
            "expected_checksum": self.expected_checksum,
            "checksum_matches_training": None,
            "bytes": None,
            "error": error,
        }

    @staticmethod
    def _sha256(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
