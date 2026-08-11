from __future__ import annotations

import json
import logging

import httpx
import pytest

from app.api.auth import create_access_token, hash_password
from app.config import Settings
from app.main import create_app
from app.operational_logging import JsonEventFormatter


def test_json_formatter_emits_only_allowlisted_context_and_escapes_lines() -> None:
    record = logging.LogRecord(
        "iot_ids.test",
        logging.WARNING,
        __file__,
        1,
        "fixed message\nsecond line",
        (),
        None,
    )
    record.event = "test.event"
    record.request_id = "request-1"
    record.authorization = "Bearer must-not-appear"
    record.password = "must-not-appear"
    record.database_url = "postgresql://secret@database/app"

    rendered = JsonEventFormatter().format(record)
    payload = json.loads(rendered)

    assert payload["event"] == "test.event"
    assert payload["request_id"] == "request-1"
    assert payload["message"] == "fixed message\\nsecond line"
    assert "must-not-appear" not in rendered
    assert "postgresql://" not in rendered


@pytest.mark.anyio
async def test_request_and_auth_logs_use_normalized_routes_without_secrets(
    tmp_path, capsys
) -> None:
    app = create_app(
        Settings(
            database_url=f"sqlite:///{tmp_path / 'logging.db'}",
            allow_fallback=True,
            auth_enabled=True,
            admin_username="admin",
            admin_password_hash=hash_password("correct-password"),
            secret_key="logging-test-secret-key-at-least-32-bytes",
            instance_id="logging-test-instance",
            log_level="INFO",
            log_format="json",
        ),
        initialize_schema_for_tests=True,
    )
    token, _ = create_access_token("admin", app.state.settings.secret_key)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get(
                "/api/v1/alerts?q=sensitive-query-value",
                headers={
                    "Authorization": f"Bearer {token}",
                    "X-Request-ID": "request-42",
                },
            )
            assert response.status_code == 200
            failed = await client.post(
                "/api/v1/auth/login",
                json={"username": "sensitive-username", "password": "secret-password"},
                headers={"X-Request-ID": "request-43"},
            )
            assert failed.status_code == 401

    rendered = capsys.readouterr().err
    records = [json.loads(line) for line in rendered.splitlines() if line.startswith("{")]
    request_record = next(
        item for item in records if item.get("request_id") == "request-42"
    )
    assert request_record["http_route"] == "/alerts"
    assert request_record["http_response_status_code"] == 200
    assert any(item.get("event") == "authentication.failed" for item in records)
    for secret in (
        "sensitive-query-value",
        "sensitive-username",
        "secret-password",
        "Bearer",
        "postgresql://",
    ):
        assert secret not in rendered
