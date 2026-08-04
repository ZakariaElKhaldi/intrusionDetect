from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Settings:
    database_url: str = "sqlite:///./iot_ids.db"
    model_artifact_path: str | None = None
    model_dir: str | None = None
    allow_fallback: bool = False
    replay_dataset_path: str | None = None
    cors_origins: tuple[str, ...] = ("http://localhost:5173",)

    @classmethod
    def from_env(cls) -> Settings:
        origins = tuple(
            item.strip()
            for item in os.getenv("IOT_IDS_CORS_ORIGINS", "http://localhost:5173").split(",")
            if item.strip()
        )
        repository = Path(__file__).resolve().parents[2]
        default_model_dir = repository / "models/production"
        model_dir = os.getenv("IOT_IDS_MODEL_DIR")
        if model_dir is None and (default_model_dir / "manifest.json").is_file():
            model_dir = str(default_model_dir)
        return cls(
            database_url=os.getenv("IOT_IDS_DATABASE_URL", "sqlite:///./iot_ids.db"),
            model_artifact_path=os.getenv("IOT_IDS_MODEL_ARTIFACT"),
            model_dir=model_dir,
            allow_fallback=os.getenv("IOT_IDS_ALLOW_FALLBACK", "false").lower()
            in {"1", "true", "yes"},
            replay_dataset_path=os.getenv(
                "IOT_IDS_REPLAY_DATASET",
                os.getenv(
                    "IOT_IDS_DATASET_PATH", str(repository / "data/raw/RT_IOT2022.csv")
                ),
            ),
            cors_origins=origins,
        )
