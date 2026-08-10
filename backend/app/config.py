from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from uuid import uuid4


@dataclass(frozen=True, slots=True)
class Settings:
    database_url: str = "sqlite:///./iot_ids.db"
    model_artifact_path: str | None = None
    model_dir: str | None = None
    nfstream_model_dir: str | None = None
    allow_fallback: bool = False
    replay_dataset_path: str | None = None
    cors_origins: tuple[str, ...] = ("http://localhost:5173",)
    instance_id: str = field(default_factory=lambda: f"iot-ids-{uuid4().hex[:12]}")
    ingestion_queue_limit: int = 10_000
    worker_poll_seconds: float = 0.5
    worker_lease_seconds: int = 60
    outbox_poll_seconds: float = 0.5
    model_health_interval_seconds: float = 300.0
    model_health_shadow_mode: bool = True
    model_health_fast_minimum: int = 1_000
    model_health_slow_minimum: int = 5_000
    model_health_retention_days: int = 90
    auth_enabled: bool = False
    admin_username: str = "admin"
    admin_password_hash: str = ""
    secret_key: str = ""
    access_token_minutes: int = 30

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
            nfstream_model_dir=os.getenv("IOT_IDS_NFSTREAM_MODEL_DIR"),
            allow_fallback=os.getenv("IOT_IDS_ALLOW_FALLBACK", "false").lower()
            in {"1", "true", "yes"},
            replay_dataset_path=os.getenv(
                "IOT_IDS_REPLAY_DATASET",
                os.getenv(
                    "IOT_IDS_DATASET_PATH", str(repository / "data/raw/RT_IOT2022.csv")
                ),
            ),
            cors_origins=origins,
            instance_id=os.getenv("IOT_IDS_INSTANCE_ID") or f"iot-ids-{uuid4().hex[:12]}",
            ingestion_queue_limit=int(
                os.getenv("IOT_IDS_INGESTION_QUEUE_LIMIT", "10000")
            ),
            worker_poll_seconds=float(os.getenv("IOT_IDS_WORKER_POLL_SECONDS", "0.5")),
            worker_lease_seconds=int(os.getenv("IOT_IDS_WORKER_LEASE_SECONDS", "60")),
            outbox_poll_seconds=float(os.getenv("IOT_IDS_OUTBOX_POLL_SECONDS", "0.5")),
            model_health_interval_seconds=float(
                os.getenv("IOT_IDS_MODEL_HEALTH_INTERVAL_SECONDS", "300")
            ),
            model_health_shadow_mode=os.getenv(
                "IOT_IDS_MODEL_HEALTH_SHADOW_MODE", "true"
            ).lower()
            in {"1", "true", "yes"},
            model_health_fast_minimum=int(
                os.getenv("IOT_IDS_MODEL_HEALTH_FAST_MINIMUM", "1000")
            ),
            model_health_slow_minimum=int(
                os.getenv("IOT_IDS_MODEL_HEALTH_SLOW_MINIMUM", "5000")
            ),
            model_health_retention_days=int(
                os.getenv("IOT_IDS_MODEL_HEALTH_RETENTION_DAYS", "90")
            ),
            auth_enabled=os.getenv("IOT_IDS_AUTH_ENABLED", "true").lower()
            in {"1", "true", "yes"},
            admin_username=os.getenv("IOT_IDS_ADMIN_USERNAME", "admin"),
            admin_password_hash=os.getenv("IOT_IDS_ADMIN_PASSWORD_HASH", ""),
            secret_key=os.getenv("IOT_IDS_SECRET_KEY", ""),
            access_token_minutes=int(os.getenv("IOT_IDS_ACCESS_TOKEN_MINUTES", "30")),
        )

    def validate_authentication(self) -> None:
        if not self.auth_enabled:
            return
        if not self.admin_username.strip():
            raise ValueError("IOT_IDS_ADMIN_USERNAME must not be empty")
        if not self.admin_password_hash.startswith("$argon2id$"):
            raise ValueError(
                "IOT_IDS_ADMIN_PASSWORD_HASH must contain an Argon2id password hash"
            )
        if len(self.secret_key.encode("utf-8")) < 32:
            raise ValueError("IOT_IDS_SECRET_KEY must contain at least 32 UTF-8 bytes")
        if not 1 <= self.access_token_minutes <= 1_440:
            raise ValueError("IOT_IDS_ACCESS_TOKEN_MINUTES must be between 1 and 1440")
