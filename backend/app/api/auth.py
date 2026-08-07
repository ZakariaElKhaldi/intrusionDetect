from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

security = HTTPBearer(auto_error=False)


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)
    return f"{salt.hex()}:{derived.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        parts = stored_hash.split(":")
        if len(parts) != 2:
            return False
        salt_hex, derived_hex = parts
        salt = bytes.fromhex(salt_hex)
        check = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)
        return secrets.compare_digest(check.hex(), derived_hex)
    except Exception:
        return False


def create_access_token(username: str, secret_key: str, expires_in: int = 86400) -> str:
    expires_at = int(time.time()) + expires_in
    payload = f"{username}:{expires_at}"
    signature = hmac.new(
        secret_key.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return f"{payload}:{signature}"


def verify_access_token(token: str, secret_key: str) -> str | None:
    try:
        parts = token.split(":")
        if len(parts) != 3:
            return None
        username, expires_at_str, signature = parts
        expires_at = int(expires_at_str)
        if time.time() > expires_at:
            return None
        payload = f"{username}:{expires_at}"
        expected_sig = hmac.new(
            secret_key.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256
        ).hexdigest()
        if secrets.compare_digest(signature, expected_sig):
            return username
        return None
    except Exception:
        return None


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int = 86400


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, request: Request) -> TokenResponse:
    settings = getattr(request.app.state, "settings", None)
    admin_user = getattr(settings, "admin_username", "admin") if settings else "admin"
    admin_pass = getattr(settings, "admin_password", "admin") if settings else "admin"
    secret_key = getattr(settings, "secret_key", "intrusion-detect-secret-key-change-in-production") if settings else "intrusion-detect-secret-key-change-in-production"

    stored_hash = getattr(request.app.state, "admin_password_hash", None)
    if not stored_hash:
        stored_hash = hash_password(admin_pass)
        request.app.state.admin_password_hash = stored_hash

    if body.username != admin_user or not verify_password(body.password, stored_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = create_access_token(body.username, secret_key)
    return TokenResponse(access_token=token)


@router.get("/me")
def me(
    credentials: HTTPAuthorizationCredentials | None = Security(security),
    request: Request = None,  # type: ignore[assignment]
) -> dict[str, Any]:
    username = get_current_admin(credentials, request)
    return {"username": username, "role": "admin"}


def get_current_admin(
    credentials: HTTPAuthorizationCredentials | None = Security(security),
    request: Request = None,  # type: ignore[assignment]
) -> str:
    if request is not None:
        settings = getattr(request.app.state, "settings", None)
        if settings and not getattr(settings, "auth_enabled", True):
            return "admin"
        secret_key = (
            getattr(settings, "secret_key", "intrusion-detect-secret-key-change-in-production")
            if settings
            else "intrusion-detect-secret-key-change-in-production"
        )
    else:
        secret_key = "intrusion-detect-secret-key-change-in-production"

    token = credentials.credentials if credentials else None
    if not token and request is not None:
        token = request.headers.get("X-API-Key")

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    username = verify_access_token(token, secret_key)
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return username
