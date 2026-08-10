from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx
import pytest

from app.api.auth import (
    create_access_token,
    hash_password,
    verify_access_token,
    verify_password,
)
from app.config import Settings
from app.main import create_app

SECRET = "test-secret-key-that-is-at-least-32-bytes"


def authenticated_settings(tmp_path, name: str = "auth.db") -> Settings:
    return Settings(
        database_url=f"sqlite:///{tmp_path / name}",
        auth_enabled=True,
        admin_username="admin",
        admin_password_hash=hash_password("password123"),
        secret_key=SECRET,
        allow_fallback=True,
    )


def test_password_hashing_and_verification() -> None:
    password = "secret_admin_pass"
    hashed = hash_password(password)
    assert hashed.startswith("$argon2id$")
    assert verify_password(password, hashed) is True
    assert verify_password("wrong_password", hashed) is False


def test_token_creation_validation_tampering_and_expiry() -> None:
    token, expires_at = create_access_token("admin", SECRET, expires_in=3600)
    assert expires_at > datetime.now(UTC)
    assert verify_access_token(token, SECRET) == "admin"
    assert verify_access_token(token, "different-secret-that-is-32-bytes!!") is None
    assert verify_access_token(f"{token}tampered", SECRET) is None
    expired, _ = create_access_token(
        "admin",
        SECRET,
        expires_in=1,
        now=datetime.now(UTC) - timedelta(minutes=1),
    )
    assert verify_access_token(expired, SECRET) is None


@pytest.mark.anyio
async def test_authenticated_startup_rejects_insecure_configuration(tmp_path) -> None:
    app = create_app(
        Settings(
            database_url=f"sqlite:///{tmp_path / 'bad.db'}",
            auth_enabled=True,
            admin_password_hash="admin",
            secret_key=SECRET,
            allow_fallback=True,
        )
    )
    with pytest.raises(ValueError, match="Argon2id"):
        async with app.router.lifespan_context(app):
            pass


@pytest.mark.anyio
async def test_login_me_and_protected_mutations(tmp_path) -> None:
    app = create_app(authenticated_settings(tmp_path))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            failed = await client.post(
                "/api/v1/auth/login",
                json={"username": "admin", "password": "wrongpassword"},
            )
            assert failed.status_code == 401
            unauthenticated = await client.post("/api/v1/replay/stop")
            assert unauthenticated.status_code == 401

            login = await client.post(
                "/api/v1/auth/login",
                json={"username": "admin", "password": "password123"},
            )
            assert login.status_code == 200
            body = login.json()
            assert body["expires_in"] == 1800
            headers = {"Authorization": f"Bearer {body['access_token']}"}
            me = await client.get("/api/v1/auth/me", headers=headers)
            assert me.json() == {"username": "admin", "role": "admin"}
            replay = await client.post("/api/v1/replay/stop", headers=headers)
            assert replay.status_code == 200


@pytest.mark.anyio
async def test_failed_login_rate_limit(tmp_path) -> None:
    app = create_app(authenticated_settings(tmp_path, "limit.db"))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            for _ in range(5):
                response = await client.post(
                    "/auth/login", json={"username": "admin", "password": "wrong"}
                )
                assert response.status_code == 401
            limited = await client.post(
                "/auth/login", json={"username": "admin", "password": "password123"}
            )
            assert limited.status_code == 429
            assert int(limited.headers["Retry-After"]) > 0
