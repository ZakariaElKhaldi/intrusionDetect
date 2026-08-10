from __future__ import annotations

import asyncio

from fastapi import WebSocket


class LiveConnectionManager:
    def __init__(self, max_connections: int = 250) -> None:
        self.max_connections = max_connections
        self.connections: set[WebSocket] = set()
        self._connect_lock = asyncio.Lock()

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
        stale: list[WebSocket] = []
        for connection in list(self.connections):
            try:
                await connection.send_json(message)
            except Exception:
                stale.append(connection)
        for connection in stale:
            self.disconnect(connection)
