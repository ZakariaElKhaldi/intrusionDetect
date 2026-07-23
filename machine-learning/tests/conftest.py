from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture(scope="session")
def repository_root() -> Path:
    return Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session")
def fixture_csv(repository_root: Path) -> Path:
    return repository_root / "data" / "sample" / "rt_iot2022_sample.csv"

