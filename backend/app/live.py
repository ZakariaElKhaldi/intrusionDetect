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
        self._connect_lock = asyncio.Lock()
        self._broadcast_lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> bool:
        async with self._connect_lock:
            await websocket.accept()
            if len(self.connections) >= self.max_connections:
                await websocket.close(
                    code=1013, reason="live connection capacity reached"
                )
                return False
            self.connections.add(websocket)
        await websocket.send_json({"type": "connection", "status": "connected"})
        return True

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
