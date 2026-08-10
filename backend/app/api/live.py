from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["live"])


@router.websocket("/live")
async def live(websocket: WebSocket) -> None:
    manager = websocket.app.state.live
    if not await manager.connect(websocket):
        websocket.app.state.metrics.live_connection_rejections.inc()
        return
    try:
        while True:
            message = await websocket.receive_text()
            if message == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        manager.disconnect(websocket)
