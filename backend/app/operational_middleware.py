from __future__ import annotations

import logging
import re
import time
from uuid import uuid4

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import Settings
from app.metrics import ApplicationMetrics

REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


class OperationalMiddleware:
    """Record request telemetry and attach security headers without buffering bodies."""

    def __init__(
        self, app: ASGIApp, *, settings: Settings, logger: logging.Logger
    ) -> None:
        self.app = app
        self.settings = settings
        self.logger = logger

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        metrics: ApplicationMetrics = scope["app"].state.metrics
        metrics.http_in_flight.inc()
        started = time.perf_counter()
        headers = Headers(scope=scope)
        request_id = headers.get("X-Request-ID", "").strip()
        if not REQUEST_ID_PATTERN.fullmatch(request_id):
            request_id = str(uuid4())
        scope.setdefault("state", {})["request_id"] = request_id

        response_status = 500
        error_type: str | None = None

        async def send_with_headers(message: Message) -> None:
            nonlocal response_status
            if message["type"] == "http.response.start":
                response_status = int(message["status"])
                response_headers = MutableHeaders(scope=message)
                response_headers["X-Request-ID"] = request_id
                response_headers["X-Content-Type-Options"] = "nosniff"
                response_headers["Referrer-Policy"] = "no-referrer"
                path = str(scope.get("path", ""))
                if path.endswith(("/auth/login", "/auth/me")):
                    response_headers["Cache-Control"] = "no-store"
            await send(message)

        try:
            await self.app(scope, receive, send_with_headers)
        except Exception as exc:
            error_type = type(exc).__name__
            raise
        finally:
            route = scope.get("route")
            route_path = getattr(route, "path", "unmatched")
            elapsed = time.perf_counter() - started
            metrics.http_requests.labels(
                method=scope["method"],
                route=route_path,
                status_code=str(response_status),
            ).inc()
            metrics.http_latency.labels(
                method=scope["method"],
                route=route_path,
            ).observe(elapsed)
            metrics.http_in_flight.dec()
            log_method = self.logger.warning if response_status >= 500 else self.logger.info
            log_method(
                "HTTP request completed",
                extra={
                    "event": "http.server.request.completed",
                    "request_id": request_id,
                    "instance_id": self.settings.instance_id,
                    "http_request_method": scope["method"],
                    "http_route": route_path,
                    "http_response_status_code": response_status,
                    "duration_ms": round(elapsed * 1_000, 3),
                    "error_type": error_type,
                },
            )
