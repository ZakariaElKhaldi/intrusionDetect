from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.api.auth import verify_access_token

router = APIRouter(tags=["live"])
AUTHENTICATION_TIMEOUT_SECONDS = 5.0


async def _authenticate(websocket: WebSocket) -> bool:
    settings = websocket.app.state.settings
    if not settings.auth_enabled:
        return True
    await websocket.accept()
    try:
        raw_message = await asyncio.wait_for(
            websocket.receive_text(), timeout=AUTHENTICATION_TIMEOUT_SECONDS
        )
        message = json.loads(raw_message)
    except (TimeoutError, json.JSONDecodeError, WebSocketDisconnect):
        await websocket.close(code=1008, reason="authentication required")
        return False
    if not isinstance(message, dict) or message.get("type") != "authenticate":
        await websocket.close(code=1008, reason="authentication required")
        return False
    token = message.get("token")
    username = (
        verify_access_token(token, settings.secret_key)
        if isinstance(token, str)
        else None
    )
    if username != settings.admin_username:
        await websocket.close(code=1008, reason="authentication required")
        return False
    return True


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
    auth_enabled = websocket.app.state.settings.auth_enabled
    if auth_enabled and not await manager.reserve():
        await websocket.accept()
        await websocket.close(code=1013, reason="live connection capacity reached")
        websocket.app.state.metrics.live_connection_rejections.inc()
        return
    if not await _authenticate(websocket):
        if auth_enabled:
            await manager.release_reservation()
        return
    if not await manager.connect(
        websocket, accepted=auth_enabled, reserved=auth_enabled
    ):
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
