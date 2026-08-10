from __future__ import annotations

import re
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[2]


def test_backend_image_runs_unprivileged_and_has_a_liveness_probe() -> None:
    dockerfile = (REPOSITORY / "backend/Dockerfile").read_text(encoding="utf-8")
    assert "ghcr.io/astral-sh/uv:0.11.16" in dockerfile
    assert "COPY backend/uv.lock" in dockerfile
    assert "uv sync --locked --no-dev" in dockerfile
    assert 'pip install --no-cache-dir ".[postgres,pcap]"' not in dockerfile
    assert "USER 10001:10001" in dockerfile
    assert "HEALTHCHECK" in dockerfile
    assert "http://127.0.0.1:8000/livez" in dockerfile
    assert '"--no-access-log"' in dockerfile
    assert '"--no-server-header"' in dockerfile
    assert '"--ws-max-size", "65536"' in dockerfile
    assert '"--ws", "websockets-sansio"' in dockerfile
    assert '"--ws-max-queue", "8"' in dockerfile
    assert '"--ws-per-message-deflate", "false"' in dockerfile

    for relative_path in (
        "scripts/run_all.sh",
        "scripts/run_replay_benchmark.sh",
        "scripts/start_e2e_backend.sh",
        "scripts/demo.sh",
    ):
        startup = (REPOSITORY / relative_path).read_text(encoding="utf-8")
        assert "--ws-max-size 65536" in startup
        assert "--ws websockets-sansio" in startup
        assert "--ws-max-queue 8" in startup
        assert "--ws-per-message-deflate false" in startup

    dockerignore = (REPOSITORY / ".dockerignore").read_text(encoding="utf-8")
    assert "**/.venv" in dockerignore
    assert "frontend/node_modules" in dockerignore


def test_long_running_services_require_migrated_schema_and_valid_settings() -> None:
    api = (REPOSITORY / "backend/app/main.py").read_text(encoding="utf-8")
    ingestion_worker = (REPOSITORY / "backend/app/ingestion/worker.py").read_text(
        encoding="utf-8"
    )
    monitoring_worker = (REPOSITORY / "backend/app/monitoring/worker.py").read_text(
        encoding="utf-8"
    )
    assert "verify_schema_current(engine)" in api
    for service in (ingestion_worker, monitoring_worker):
        assert "settings.validate()" in service
        assert "verify_schema_current(engine)" in service
        assert "Base.metadata.create_all" not in service
    e2e_startup = (REPOSITORY / "scripts/start_e2e_backend.sh").read_text(
        encoding="utf-8"
    )
    assert ".venv/bin/alembic upgrade head" in e2e_startup
    benchmark_startup = (REPOSITORY / "scripts/run_replay_benchmark.sh").read_text(
        encoding="utf-8"
    )
    assert ".venv/bin/alembic upgrade head" in benchmark_startup
    assert "IOT_IDS_API_TOKEN" in benchmark_startup


def test_frontend_gateway_enforces_same_origin_and_browser_security_policy() -> None:
    dockerfile = (REPOSITORY / "frontend/Dockerfile").read_text(encoding="utf-8")
    assert "nginxinc/nginx-unprivileged:1.31.3-alpine3.24" in dockerfile
    assert "EXPOSE 8080" in dockerfile
    nginx = (REPOSITORY / "frontend/nginx.conf").read_text(encoding="utf-8")
    assert "listen 8080;" in nginx
    assert "proxy_pass http://backend:8000" in nginx
    assert "proxy_set_header Upgrade $http_upgrade" in nginx
    assert "proxy_set_header X-Request-ID $request_id" in nginx
    assert "client_max_body_size 50m;" in nginx
    assert "Content-Security-Policy" in nginx
    assert "frame-ancestors 'none'" in nginx
    assert "X-Content-Type-Options \"nosniff\"" in nginx


def test_compose_has_no_default_database_password_or_cross_origin_browser_url() -> None:
    compose = (REPOSITORY / "docker-compose.yml").read_text(encoding="utf-8")
    assert "POSTGRES_PASSWORD: iot_ids" not in compose
    assert "IOT_IDS_POSTGRES_PASSWORD:?" in compose
    assert "VITE_API_URL:" not in compose
    assert "VITE_WS_URL:" not in compose
    assert "condition: service_healthy" in compose
    assert '"5173:8080"' in compose
    assert "read_only: true" in compose
    assert "no-new-privileges:true" in compose
    assert "cap_drop:\n    - ALL" in compose


def test_ci_actions_are_immutable_and_least_privilege() -> None:
    workflows = list((REPOSITORY / ".github/workflows").glob("*.yml"))
    assert workflows
    for workflow in workflows:
        contents = workflow.read_text(encoding="utf-8")
        assert "permissions:\n  contents: read" in contents
        action_references = re.findall(r"uses:\s*([^\s]+)", contents)
        assert action_references
        assert all(re.search(r"@[0-9a-f]{40}$", value) for value in action_references)

    release_gate = (REPOSITORY / ".github/workflows/release-gate.yml").read_text(
        encoding="utf-8"
    )
    assert "docker compose build" in release_gate
    assert "docker compose up --detach" in release_gate
    assert "docker compose down --volumes --remove-orphans" in release_gate
