from __future__ import annotations

from collections.abc import AsyncIterator

import httpx
import pytest

from app.config import Settings
from app.main import create_app


@pytest.mark.anyio
async def test_request_body_limit_rejects_declared_and_streamed_oversize_bodies(
    tmp_path,
) -> None:
    app = create_app(
        Settings(
            database_url=f"sqlite:///{tmp_path / 'limits.db'}",
            allow_fallback=True,
            auth_enabled=False,
            allowed_hosts=("test",),
            max_request_body_bytes=1_024,
        ),
        initialize_schema_for_tests=True,
    )

    async def oversized_stream() -> AsyncIterator[bytes]:
        yield b"x" * 700
        yield b"y" * 700

    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            declared = await client.post(
                "/predict",
                content=b"x" * 1_025,
                headers={"Content-Type": "application/json"},
            )
            assert declared.status_code == 413
            assert declared.json() == {"detail": "request body is too large"}
            assert declared.headers["x-request-id"]

            streamed = await client.post(
                "/predict",
                content=oversized_stream(),
                headers={"Content-Type": "application/json"},
            )
            assert streamed.status_code == 413
            assert streamed.json() == {"detail": "request body is too large"}


def test_resource_limit_configuration_is_bounded() -> None:
    with pytest.raises(ValueError, match="MAX_REQUEST_BODY_BYTES"):
        Settings(max_request_body_bytes=1_023).validate()
    with pytest.raises(ValueError, match="MAX_LIVE_CONNECTIONS"):
        Settings(max_live_connections=0).validate()

