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
    allowed_hosts: tuple[str, ...] = ("localhost", "127.0.0.1", "test")
    instance_id: str = field(default_factory=lambda: f"iot-ids-{uuid4().hex[:12]}")
    ingestion_queue_limit: int = 10_000
    worker_poll_seconds: float = 0.5
    worker_lease_seconds: int = 60
    outbox_poll_seconds: float = 0.5
    outbox_lease_seconds: int = 30
    model_health_interval_seconds: float = 300.0
    model_health_shadow_mode: bool = True
    model_health_fast_minimum: int = 1_000
    model_health_slow_minimum: int = 5_000
    model_health_retention_days: int = 90
    max_request_body_bytes: int = 50 * 1024 * 1024
    max_live_connections: int = 250
    live_send_timeout_seconds: float = 2.0
    auth_enabled: bool = False
    admin_username: str = "admin"
    admin_password_hash: str = ""
    secret_key: str = ""
    access_token_minutes: int = 30
    sensor_token_hash: str = ""
    sensor_offline_seconds: int = 30
    log_level: str = "WARNING"
    log_format: str = "json"

    @classmethod
    def from_env(cls) -> Settings:
        origins = tuple(
            item.strip()
            for item in os.getenv("IOT_IDS_CORS_ORIGINS", "http://localhost:5173").split(",")
            if item.strip()
        )
        allowed_hosts = tuple(
            item.strip()
            for item in os.getenv(
                "IOT_IDS_ALLOWED_HOSTS", "localhost,127.0.0.1,backend"
            ).split(",")
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
            allowed_hosts=allowed_hosts,
            instance_id=os.getenv("IOT_IDS_INSTANCE_ID") or f"iot-ids-{uuid4().hex[:12]}",
            ingestion_queue_limit=int(
                os.getenv("IOT_IDS_INGESTION_QUEUE_LIMIT", "10000")
            ),
            worker_poll_seconds=float(os.getenv("IOT_IDS_WORKER_POLL_SECONDS", "0.5")),
            worker_lease_seconds=int(os.getenv("IOT_IDS_WORKER_LEASE_SECONDS", "60")),
            outbox_poll_seconds=float(os.getenv("IOT_IDS_OUTBOX_POLL_SECONDS", "0.5")),
            outbox_lease_seconds=int(
                os.getenv("IOT_IDS_OUTBOX_LEASE_SECONDS", "30")
            ),
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
            max_request_body_bytes=int(
                os.getenv("IOT_IDS_MAX_REQUEST_BODY_BYTES", str(50 * 1024 * 1024))
            ),
            max_live_connections=int(
                os.getenv("IOT_IDS_MAX_LIVE_CONNECTIONS", "250")
            ),
            live_send_timeout_seconds=float(
                os.getenv("IOT_IDS_LIVE_SEND_TIMEOUT_SECONDS", "2")
            ),
            auth_enabled=os.getenv("IOT_IDS_AUTH_ENABLED", "true").lower()
            in {"1", "true", "yes"},
            admin_username=os.getenv("IOT_IDS_ADMIN_USERNAME", "admin"),
            admin_password_hash=os.getenv("IOT_IDS_ADMIN_PASSWORD_HASH", ""),
            secret_key=os.getenv("IOT_IDS_SECRET_KEY", ""),
            access_token_minutes=int(os.getenv("IOT_IDS_ACCESS_TOKEN_MINUTES", "30")),
            sensor_token_hash=os.getenv("IOT_IDS_SENSOR_TOKEN_HASH", "").strip().lower(),
            sensor_offline_seconds=int(
                os.getenv("IOT_IDS_SENSOR_OFFLINE_SECONDS", "30")
            ),
            log_level=os.getenv("IOT_IDS_LOG_LEVEL", "INFO").strip().upper(),
            log_format=os.getenv("IOT_IDS_LOG_FORMAT", "json").strip().lower(),
        )

    def validate_authentication(self) -> None:
        if self.sensor_token_hash and (
            len(self.sensor_token_hash) != 64
            or any(character not in "0123456789abcdef" for character in self.sensor_token_hash)
        ):
            raise ValueError("IOT_IDS_SENSOR_TOKEN_HASH must be a lowercase SHA-256 hex digest")
        if not 5 <= self.sensor_offline_seconds <= 3_600:
            raise ValueError("IOT_IDS_SENSOR_OFFLINE_SECONDS must be between 5 and 3600")
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

    def validate(self) -> None:
        if not self.database_url.strip():
            raise ValueError("IOT_IDS_DATABASE_URL must not be empty")
        if not self.instance_id.strip():
            raise ValueError("IOT_IDS_INSTANCE_ID must not be empty")
        if not 1 <= self.ingestion_queue_limit <= 1_000_000:
            raise ValueError("IOT_IDS_INGESTION_QUEUE_LIMIT must be between 1 and 1000000")
        for name, value in (
            ("IOT_IDS_WORKER_POLL_SECONDS", self.worker_poll_seconds),
            ("IOT_IDS_OUTBOX_POLL_SECONDS", self.outbox_poll_seconds),
            ("IOT_IDS_MODEL_HEALTH_INTERVAL_SECONDS", self.model_health_interval_seconds),
        ):
            if not 0 < value <= 86_400:
                raise ValueError(f"{name} must be greater than 0 and at most 86400")
        if not 1 <= self.worker_lease_seconds <= 86_400:
            raise ValueError("IOT_IDS_WORKER_LEASE_SECONDS must be between 1 and 86400")
        if not 3 <= self.outbox_lease_seconds <= 3_600:
            raise ValueError("IOT_IDS_OUTBOX_LEASE_SECONDS must be between 3 and 3600")
        if not 1 <= self.model_health_fast_minimum <= self.model_health_slow_minimum:
            raise ValueError(
                "model-health minimums must be positive and the slow minimum must "
                "not be smaller than the fast minimum"
            )
        if not 1 <= self.model_health_retention_days <= 3_650:
            raise ValueError("IOT_IDS_MODEL_HEALTH_RETENTION_DAYS must be between 1 and 3650")
        if not 1_024 <= self.max_request_body_bytes <= 256 * 1024 * 1024:
            raise ValueError(
                "IOT_IDS_MAX_REQUEST_BODY_BYTES must be between 1024 and 268435456"
            )
        if not 1 <= self.max_live_connections <= 10_000:
            raise ValueError("IOT_IDS_MAX_LIVE_CONNECTIONS must be between 1 and 10000")
        if not 0.1 <= self.live_send_timeout_seconds <= 60:
            raise ValueError(
                "IOT_IDS_LIVE_SEND_TIMEOUT_SECONDS must be between 0.1 and 60"
            )
        if self.outbox_lease_seconds < self.live_send_timeout_seconds + 2:
            raise ValueError(
                "IOT_IDS_OUTBOX_LEASE_SECONDS must be at least two seconds longer "
                "than IOT_IDS_LIVE_SEND_TIMEOUT_SECONDS"
            )
        invalid_origins = [
            origin
            for origin in self.cors_origins
            if origin == "*" or not origin.startswith(("http://", "https://"))
        ]
        if invalid_origins:
            raise ValueError(
                "IOT_IDS_CORS_ORIGINS must contain explicit HTTP(S) origins, never '*'"
            )
        invalid_hosts = [
            host
            for host in self.allowed_hosts
            if host == "*"
            or "://" in host
            or "/" in host
            or any(character.isspace() for character in host)
            or ("*" in host and not host.startswith("*."))
        ]
        if not self.allowed_hosts or invalid_hosts:
            raise ValueError(
                "IOT_IDS_ALLOWED_HOSTS must contain explicit hostnames or '*.example.com' patterns"
            )
        if self.log_level not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
            raise ValueError(
                "IOT_IDS_LOG_LEVEL must be DEBUG, INFO, WARNING, ERROR, or CRITICAL"
            )
        if self.log_format not in {"json", "text"}:
            raise ValueError("IOT_IDS_LOG_FORMAT must be json or text")
        self.validate_authentication()
