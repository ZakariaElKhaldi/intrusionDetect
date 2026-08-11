from __future__ import annotations

import asyncio

from fastapi import WebSocket


class LiveConnectionManager:
    def __init__(
        self, max_connections: int = 250, send_timeout_seconds: float = 2.0
    ) -> None:
        self.max_connections = max_connections
        self.send_timeout_seconds = send_timeout_seconds
        self.connections: set[WebSocket] = set()
        self._pending_connections = 0
        self._connect_lock = asyncio.Lock()
        self._broadcast_lock = asyncio.Lock()

    async def reserve(self) -> bool:
        """Bound accepted sockets while they wait for first-message authentication."""
        async with self._connect_lock:
            if len(self.connections) + self._pending_connections >= self.max_connections:
                return False
            self._pending_connections += 1
            return True

    async def release_reservation(self) -> None:
        async with self._connect_lock:
            self._pending_connections = max(0, self._pending_connections - 1)

    async def connect(
        self, websocket: WebSocket, *, accepted: bool = False, reserved: bool = False
    ) -> bool:
        async with self._connect_lock:
            if not accepted:
                await websocket.accept()
            if reserved:
                self._pending_connections = max(0, self._pending_connections - 1)
            elif len(self.connections) + self._pending_connections >= self.max_connections:
                await websocket.close(
                    code=1013, reason="live connection capacity reached"
                )
                return False
            self.connections.add(websocket)
        await websocket.send_json({"type": "connection", "status": "connected"})
        return True

    @property
    def pending_connections(self) -> int:
        return self._pending_connections

    def disconnect(self, websocket: WebSocket) -> None:
        self.connections.discard(websocket)

    async def broadcast(self, message: dict) -> None:
        async def send(connection: WebSocket) -> WebSocket | None:
            try:
                await asyncio.wait_for(
                    connection.send_json(message), timeout=self.send_timeout_seconds
                )
            except Exception:
                return connection
            return None

        async with self._broadcast_lock:
            connections = list(self.connections)
            stale = await asyncio.gather(
                *(send(connection) for connection in connections)
            )
        for connection in stale:
            if connection is not None:
                self.disconnect(connection)
