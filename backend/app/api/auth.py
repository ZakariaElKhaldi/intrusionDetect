from __future__ import annotations

import argparse
import asyncio
import getpass
import logging
import secrets
import threading
from collections import OrderedDict, deque
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any
from uuid import uuid4

import jwt
from fastapi import APIRouter, HTTPException, Request, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import InvalidTokenError
from pwdlib import PasswordHash
from pydantic import BaseModel, Field

TOKEN_ISSUER = "iot-intrusion-detection"
TOKEN_AUDIENCE = "iot-ids-api"
PASSWORD_HASH = PasswordHash.recommended()
SECURITY_LOGGER = logging.getLogger("iot_ids.security")
PASSWORD_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="password-verify")
security = HTTPBearer(auto_error=False)
BearerCredentials = Annotated[HTTPAuthorizationCredentials | None, Security(security)]


def hash_password(password: str) -> str:
    if not password:
        raise ValueError("password must not be empty")
    return PASSWORD_HASH.hash(password)


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        return PASSWORD_HASH.verify(password, stored_hash)
    except (TypeError, ValueError):
        return False


def create_access_token(
    username: str,
    secret_key: str,
    *,
    expires_in: int = 1_800,
    now: datetime | None = None,
) -> tuple[str, datetime]:
    issued_at = now or datetime.now(UTC)
    expires_at = issued_at + timedelta(seconds=expires_in)
    payload = {
        "sub": username,
        "iss": TOKEN_ISSUER,
        "aud": TOKEN_AUDIENCE,
        "iat": issued_at,
        "exp": expires_at,
        "jti": str(uuid4()),
    }
    return jwt.encode(payload, secret_key, algorithm="HS256"), expires_at


def verify_access_token(token: str, secret_key: str) -> str | None:
    try:
        payload = jwt.decode(
            token,
            secret_key,
            algorithms=["HS256"],
            audience=TOKEN_AUDIENCE,
            issuer=TOKEN_ISSUER,
            options={"require": ["sub", "iss", "aud", "iat", "exp", "jti"]},
        )
    except InvalidTokenError:
        return None
    subject = payload.get("sub")
    return subject if isinstance(subject, str) and subject else None


class LoginRateLimiter:
    def __init__(
        self, *, maximum: int = 5, window_seconds: int = 300, max_keys: int = 10_000
    ) -> None:
        self.maximum = maximum
        self.window_seconds = window_seconds
        self.max_keys = max_keys
        self._failures: OrderedDict[str, deque[float]] = OrderedDict()
        self._lock = threading.Lock()

    def retry_after(self, key: str, now: float) -> int | None:
        with self._lock:
            failures = self._failures.get(key)
            if failures is None:
                return None
            cutoff = now - self.window_seconds
            while failures and failures[0] <= cutoff:
                failures.popleft()
            if not failures:
                self._failures.pop(key, None)
                return None
            self._failures.move_to_end(key)
            if len(failures) < self.maximum:
                return None
            return max(1, int(failures[0] + self.window_seconds - now) + 1)

    def failed(self, key: str, now: float) -> None:
        with self._lock:
            failures = self._failures.setdefault(key, deque())
            failures.append(now)
            self._failures.move_to_end(key)
            while len(self._failures) > self.max_keys:
                self._failures.popitem(last=False)

    def succeeded(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)

    @property
    def tracked_keys(self) -> int:
        with self._lock:
            return len(self._failures)


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=1024)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    expires_at: datetime


router = APIRouter(prefix="/auth", tags=["auth"])


def _throttle_keys(request: Request, username: str) -> tuple[str, str]:
    host = request.client.host if request.client else "unknown"
    return f"client:{host}", f"account:{username.casefold()}"


@router.get("/status")
async def authentication_status(request: Request) -> dict[str, bool]:
    return {"enabled": bool(request.app.state.settings.auth_enabled)}


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, request: Request) -> TokenResponse:
    settings = request.app.state.settings
    limiter: LoginRateLimiter = request.app.state.login_rate_limiter
    now = datetime.now(UTC)
    keys = _throttle_keys(request, body.username)
    retry_after_values = [
        value
        for key in keys
        if (value := limiter.retry_after(key, now.timestamp())) is not None
    ]
    if retry_after_values:
        SECURITY_LOGGER.warning(
            "Authentication rate limit applied",
            extra={
                "event": "authentication.rate_limited",
                "request_id": getattr(request.state, "request_id", None),
                "instance_id": settings.instance_id,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed login attempts",
            headers={"Retry-After": str(max(retry_after_values))},
        )

    username_matches = secrets.compare_digest(body.username, settings.admin_username)
    password_matches = await asyncio.get_running_loop().run_in_executor(
        PASSWORD_EXECUTOR, verify_password, body.password, settings.admin_password_hash
    )
    if not username_matches or not password_matches:
        for key in keys:
            limiter.failed(key, now.timestamp())
        SECURITY_LOGGER.warning(
            "Authentication failed",
            extra={
                "event": "authentication.failed",
                "request_id": getattr(request.state, "request_id", None),
                "instance_id": settings.instance_id,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    for key in keys:
        limiter.succeeded(key)
    SECURITY_LOGGER.info(
        "Authentication succeeded",
        extra={
            "event": "authentication.succeeded",
            "request_id": getattr(request.state, "request_id", None),
            "instance_id": settings.instance_id,
        },
    )
    expires_in = settings.access_token_minutes * 60
    token, expires_at = create_access_token(
        body.username, settings.secret_key, expires_in=expires_in, now=now
    )
    return TokenResponse(
        access_token=token,
        expires_in=expires_in,
        expires_at=expires_at,
    )


async def get_current_admin(
    request: Request,
    credentials: BearerCredentials = None,
) -> str:
    settings = request.app.state.settings
    if not settings.auth_enabled:
        return settings.admin_username
    token = credentials.credentials if credentials else None
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    username = verify_access_token(token, settings.secret_key)
    if username != settings.admin_username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return username


@router.get("/me")
async def me(request: Request, credentials: BearerCredentials = None) -> dict[str, Any]:
    username = await get_current_admin(request, credentials)
    return {"username": username, "role": "admin"}


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate an Argon2id administrator hash")
    parser.add_argument("--password-stdin", action="store_true")
    args = parser.parse_args(argv)
    if args.password_stdin:
        import sys

        password = sys.stdin.readline().rstrip("\n")
    else:
        password = getpass.getpass("Administrator password: ")
    print(hash_password(password))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
