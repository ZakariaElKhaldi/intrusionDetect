from __future__ import annotations

import re
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[2]


def test_backend_image_runs_unprivileged_and_has_a_liveness_probe() -> None:
    dockerfile = (REPOSITORY / "backend/Dockerfile").read_text(encoding="utf-8")
    assert re.search(
        r"^FROM python:3\.12-slim@sha256:[0-9a-f]{64}$", dockerfile, re.MULTILINE
    )
    assert re.search(
        r"^COPY --from=ghcr\.io/astral-sh/uv:0\.11\.16@sha256:[0-9a-f]{64} ",
        dockerfile,
        re.MULTILINE,
    )
    assert "COPY backend/uv.lock" in dockerfile
    assert "COPY --chown=10001:10001 data /app/data" in dockerfile
    assert "COPY --chown=10001:10001 models /app/models" in dockerfile
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
    assert re.search(
        r"^FROM node:22-alpine@sha256:[0-9a-f]{64} AS build$",
        dockerfile,
        re.MULTILINE,
    )
    assert re.search(
        r"^FROM nginxinc/nginx-unprivileged:1\.31\.3-alpine3\.24@sha256:[0-9a-f]{64}$",
        dockerfile,
        re.MULTILINE,
    )
    assert "EXPOSE 8080" in dockerfile
    nginx = (REPOSITORY / "frontend/nginx.conf").read_text(encoding="utf-8")
    assert "listen 8080;" in nginx
    assert "proxy_pass http://backend:8000" in nginx
    assert "proxy_set_header Upgrade $http_upgrade" in nginx
    assert "proxy_set_header X-Request-ID $request_id" in nginx
    assert "proxy_set_header X-Forwarded-For $remote_addr" in nginx
    assert "$proxy_add_x_forwarded_for" not in nginx
    assert "client_max_body_size 50m;" in nginx
    assert "Content-Security-Policy" in nginx
    assert "frame-ancestors 'none'" in nginx
    assert "X-Content-Type-Options \"nosniff\"" in nginx


def test_compose_has_no_default_database_password_or_cross_origin_browser_url() -> None:
    compose = (REPOSITORY / "docker-compose.yml").read_text(encoding="utf-8")
    lab_compose = (REPOSITORY / "docker-compose.lab.yml").read_text(encoding="utf-8")
    env_example = (REPOSITORY / ".env.example").read_text(encoding="utf-8")
    assert "POSTGRES_PASSWORD: iot_ids" not in compose
    assert re.search(
        r"^    image: postgres:17-alpine@sha256:[0-9a-f]{64}$",
        compose,
        re.MULTILINE,
    )
    assert "IOT_IDS_POSTGRES_PASSWORD:?" in compose
    assert "VITE_API_URL:" not in compose
    assert "VITE_WS_URL:" not in compose
    assert "condition: service_healthy" in compose
    assert '"${IOT_IDS_FRONTEND_PORT:-5173}:8080"' in compose
    assert '"127.0.0.1:${IOT_IDS_BACKEND_PORT:-8000}:8000"' in compose
    assert (
        'IOT_IDS_CORS_ORIGINS: "http://localhost:${IOT_IDS_FRONTEND_PORT:-5173},'
        'http://127.0.0.1:${IOT_IDS_FRONTEND_PORT:-5173}"'
    ) in lab_compose
    assert 'FORWARDED_ALLOW_IPS: "*"' in compose
    assert '\n      - "8000:8000"' not in compose
    assert "read_only: true" in compose
    assert "no-new-privileges:true" in compose
    assert "cap_drop:\n    - ALL" in compose
    worker_healthcheck = (
        'command: ["python", "-m", "app.ingestion.worker"]\n'
        "    healthcheck:\n"
        "      disable: true"
    )
    assert worker_healthcheck in compose
    assert "IOT_IDS_ADMIN_PASSWORD_HASH=''" in env_example
    assert "single-quoted" in env_example


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


def test_ci_and_release_gate_audit_all_locked_dependency_graphs() -> None:
    audit_script = (REPOSITORY / "scripts/audit_python_dependencies.sh").read_text(
        encoding="utf-8"
    )
    assert 'PIP_AUDIT_VERSION="2.10.1"' in audit_script
    assert '"pip-audit@${PIP_AUDIT_VERSION}"' in audit_script
    assert "--locked" in audit_script
    assert "--all-extras" in audit_script
    assert "--all-groups" in audit_script
    assert "--require-hashes" in audit_script
    assert "export_lock backend" in audit_script
    assert "export_lock machine-learning" in audit_script

    ci = (REPOSITORY / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    release = (REPOSITORY / ".github/workflows/release-gate.yml").read_text(
        encoding="utf-8"
    )
    for workflow in (ci, release):
        assert "./scripts/audit_python_dependencies.sh" in workflow
        assert "npm audit --audit-level=high" in workflow
