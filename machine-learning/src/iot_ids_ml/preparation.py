"""Safe, reproducible preparation of the RT-IoT2022 archive."""

from __future__ import annotations

import json
import os
import shutil
import stat
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

from .validation import sha256_file, validate_dataset


def _portable_path(path: Path) -> str:
    repository = Path(__file__).resolve().parents[3]
    try:
        return path.relative_to(repository).as_posix()
    except ValueError:
        return str(path)


def _safe_csv_member(archive: zipfile.ZipFile) -> zipfile.ZipInfo:
    files = [item for item in archive.infolist() if not item.is_dir()]
    if len(files) != 1:
        raise ValueError("RT-IoT2022 archive must contain exactly one dataset file")
    member = files[0]
    path = PurePosixPath(member.filename)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"Unsafe archive member path: {member.filename!r}")
    mode = member.external_attr >> 16
    if stat.S_ISLNK(mode):
        raise ValueError(f"Archive member must not be a symbolic link: {member.filename!r}")
    return member


def prepare_dataset(
    archive_path: str | Path,
    output_dir: str | Path,
    *,
    manifest_path: str | Path | None = None,
    expected_archive_sha256: str | None = None,
    expected_dataset_sha256: str | None = None,
) -> dict[str, Any]:
    """Safely extract and validate one archive member, then write provenance atomically."""

    source = Path(archive_path).expanduser().resolve()
    if not source.is_file():
        raise ValueError(f"Dataset archive does not exist: {source}")
    archive_sha = sha256_file(source)
    if expected_archive_sha256 and archive_sha != expected_archive_sha256:
        raise ValueError("Dataset archive checksum does not match the expected checksum")

    destination_dir = Path(output_dir).expanduser().resolve()
    destination_dir.mkdir(parents=True, exist_ok=True)
    destination = destination_dir / "RT_IOT2022.csv"
    temporary_path: Path | None = None
    try:
        with zipfile.ZipFile(source) as archive:
            member = _safe_csv_member(archive)
            with tempfile.NamedTemporaryFile(
                prefix=".rt-iot2022-", suffix=".csv", dir=destination_dir, delete=False
            ) as temporary:
                temporary_path = Path(temporary.name)
                with archive.open(member) as extracted:
                    shutil.copyfileobj(extracted, temporary)

        dataset_sha = sha256_file(temporary_path)
        if expected_dataset_sha256 and dataset_sha != expected_dataset_sha256:
            raise ValueError("Extracted dataset checksum does not match the expected checksum")
        validated = validate_dataset(temporary_path)
        os.replace(temporary_path, destination)
        temporary_path = None
        manifest = {
            "dataset": "RT-IoT2022",
            "schema_version": validated.profile["schema_version"],
            "archive": {
                "path": _portable_path(source),
                "bytes": source.stat().st_size,
                "sha256": archive_sha,
                "member": member.filename,
            },
            "extracted": {
                "path": _portable_path(destination),
                "bytes": destination.stat().st_size,
                "sha256": dataset_sha,
                "rows": validated.profile["row_count"],
                "features": validated.profile["feature_count"],
            },
        }
        manifest_path = (
            Path(manifest_path).expanduser().resolve()
            if manifest_path is not None
            else destination_dir.parent / "dataset-manifest.json"
        )
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_temp = manifest_path.with_name(f".{manifest_path.name}.tmp")
        manifest_temp.write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        os.replace(manifest_temp, manifest_path)
        return {**manifest, "manifest": str(manifest_path)}
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
