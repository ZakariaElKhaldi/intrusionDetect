from __future__ import annotations

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)


class ApplicationMetrics:
    """Low-cardinality process and pipeline metrics for one API instance."""

    def __init__(self) -> None:
        self.registry = CollectorRegistry(auto_describe=True)
        self.http_requests = Counter(
            "iot_ids_http_requests_total",
            "HTTP requests completed by method, normalized route, and status code.",
            ("method", "route", "status_code"),
            registry=self.registry,
        )
        self.http_latency = Histogram(
            "iot_ids_http_request_duration_seconds",
            "HTTP request duration in seconds by method and normalized route.",
            ("method", "route"),
            buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10),
            registry=self.registry,
        )
        self.http_in_flight = Gauge(
            "iot_ids_http_requests_in_flight",
            "HTTP requests currently being processed.",
            registry=self.registry,
        )
        self.database_up = Gauge(
            "iot_ids_database_up",
            "Whether the API can query its configured database.",
            registry=self.registry,
        )
        self.ingestion_queue_depth = Gauge(
            "iot_ids_ingestion_queue_depth",
            "Ingestion jobs waiting or being processed.",
            registry=self.registry,
        )
        self.ingestion_dead_letter = Gauge(
            "iot_ids_ingestion_dead_letter_jobs",
            "Ingestion jobs currently dead-lettered.",
            registry=self.registry,
        )
        self.outbox_pending = Gauge(
            "iot_ids_outbox_pending_events",
            "Transactional outbox events waiting for publication.",
            registry=self.registry,
        )
        self.live_connections = Gauge(
            "iot_ids_live_websocket_connections",
            "Currently connected WebSocket monitoring clients.",
            registry=self.registry,
        )

    def render(self) -> bytes:
        return generate_latest(self.registry)

    @property
    def content_type(self) -> str:
        return CONTENT_TYPE_LATEST
