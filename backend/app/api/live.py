from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["live"])


@router.websocket("/live")
async def live(websocket: WebSocket) -> None:
    origin = websocket.headers.get("origin")
    allowed_origins = websocket.app.state.settings.cors_origins
    if origin is not None and origin not in allowed_origins:
        await websocket.accept()
        await websocket.close(code=1008, reason="origin is not allowed")
        websocket.app.state.metrics.live_origin_rejections.inc()
        return
    manager = websocket.app.state.live
    if not await manager.connect(websocket):
        websocket.app.state.metrics.live_connection_rejections.inc()
        return
    try:
        while True:
            message = await websocket.receive_text()
            if message == "ping":
                await websocket.send_json({"type": "pong"})
            else:
                await websocket.close(code=1008, reason="unsupported live message")
                manager.disconnect(websocket)
                return
    except WebSocketDisconnect:
        manager.disconnect(websocket)
