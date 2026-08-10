from __future__ import annotations

from collections import deque
from collections.abc import Awaitable, Callable

from starlette.responses import JSONResponse
from starlette.types import Message, Receive, Scope, Send


class RequestBodyLimitMiddleware:
    """Reject oversized HTTP bodies, including requests without Content-Length."""

    def __init__(self, app: Callable[..., Awaitable[None]], max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def _respond(
        self, scope: Scope, receive: Receive, send: Send, status_code: int, detail: str
    ) -> None:
        await JSONResponse({"detail": detail}, status_code=status_code)(
            scope, receive, send
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        content_length = headers.get(b"content-length")
        if content_length is not None:
            try:
                declared_length = int(content_length)
            except ValueError:
                await self._respond(
                    scope, receive, send, 400, "invalid Content-Length header"
                )
                return
            if declared_length < 0:
                await self._respond(
                    scope, receive, send, 400, "invalid Content-Length header"
                )
                return
            if declared_length > self.max_bytes:
                await self._respond(
                    scope, receive, send, 413, "request body is too large"
                )
                return

        received = 0
        buffered: deque[Message] = deque()
        while True:
            message = await receive()
            buffered.append(message)
            if message["type"] != "http.request":
                break
            received += len(message.get("body", b""))
            if received > self.max_bytes:
                await self._respond(
                    scope, receive, send, 413, "request body is too large"
                )
                return
            if not message.get("more_body", False):
                break

        async def replay_receive() -> Message:
            if buffered:
                return buffered.popleft()
            return await receive()

        await self.app(scope, replay_receive, send)
