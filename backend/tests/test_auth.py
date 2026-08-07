from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api.auth import (
    create_access_token,
    hash_password,
    verify_access_token,
    verify_password,
)
from app.config import Settings
from app.main import create_app


def test_password_hashing_and_verification():
    password = "secret_admin_pass"
    hashed = hash_password(password)

    assert hashed != password
    assert "$" in hashed
    assert verify_password(password, hashed) is True
    assert verify_password("wrong_password", hashed) is False


def test_token_creation_and_validation():
    secret_key = "test-secret-key"
    username = "admin"

    token = create_access_token(username, secret_key, expires_in=3600)
    assert verify_access_token(token, secret_key) == username
    assert verify_access_token(token, "invalid-secret") is None
    assert verify_access_token("invalid:token:signature", secret_key) is None


def test_login_endpoint_success_and_failure(tmp_path):
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'auth.db'}",
        auth_enabled=True,
        admin_username="admin",
        admin_password="password123",
        secret_key="my-secret-key",
        allow_fallback=True,
    )
    app = create_app(settings)
    client = TestClient(app)

    # Failed login
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "wrongpassword"},
    )
    assert response.status_code == 401
    assert "Invalid username" in response.json()["detail"]

    # Successful login
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "password123"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"

    # Access /auth/me with valid token
    token = data["access_token"]
    me_res = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert me_res.status_code == 200
    assert me_res.json()["username"] == "admin"


def test_protected_endpoints_require_authentication(tmp_path):
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'protected.db'}",
        auth_enabled=True,
        admin_username="admin",
        admin_password="password123",
        secret_key="protected-secret",
        allow_fallback=True,
    )
    app = create_app(settings)
    client = TestClient(app)

    # Attempt mutating ingestion without token
    unauth_res = client.post(
        "/api/v1/ingestion/events",
        json=[
            {
                "schema_version": "rt-iot2022-v1",
                "event_id": "00000000-0000-0000-0000-000000000001",
                "flow_started_at": "2026-08-04T12:00:00Z",
                "flow_ended_at": "2026-08-04T12:00:01Z",
                "source": "test",
                "features": {},
            }
        ],
    )
    assert unauth_res.status_code == 401

    # Login to get valid token
    login_res = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "password123"},
    )
    token = login_res.json()["access_token"]

    # Attempt replay control with valid token
    auth_res = client.post(
        "/api/v1/replay/stop",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert auth_res.status_code in {200, 400}  # Replay may not be running, but auth passes
