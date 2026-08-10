#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
BACKEND_PORT="${DEMO_BACKEND_PORT:-8000}"
FRONTEND_PORT="${DEMO_FRONTEND_PORT:-4173}"
DEMO_TEMP_DIR="$(mktemp -d /tmp/iot-ids-demo.XXXXXX)"
DEMO_DATABASE_PATH="${DEMO_TEMP_DIR}/project-demo.sqlite3"
DEMO_INSTANCE_ID="project-demo-$(date +%s)-$$-${RANDOM}"
BACKEND_PID=""
FRONTEND_PID=""
WORKER_PID=""

validate_port() {
  local value="$1"
  local label="$2"
  if [[ ! "${value}" =~ ^[0-9]+$ ]] || ((value < 1 || value > 65535)); then
    echo "demo failed: invalid ${label} port: ${value}" >&2
    exit 2
  fi
}

port_is_open() {
  local port="$1"
  (exec 9<>"/dev/tcp/127.0.0.1/${port}") >/dev/null 2>&1
}

health_matches_instance() {
  local url="$1"
  local payload
  payload="$(curl --silent --fail --max-time 2 "${url}" 2>/dev/null)" || return 1
  HEALTH_PAYLOAD="${payload}" EXPECTED_INSTANCE_ID="${DEMO_INSTANCE_ID}" \
    "${REPOSITORY_DIR}/backend/.venv/bin/python" -c \
    'import json, os, sys; sys.exit(json.loads(os.environ["HEALTH_PAYLOAD"]).get("instance_id") != os.environ["EXPECTED_INSTANCE_ID"])'
}

wait_for_owned_health() {
  local url="$1"
  local process_id="$2"
  local label="$3"
  local attempts="$4"
  local attempt=0
  while ((attempt < attempts)); do
    if ! kill -0 "${process_id}" 2>/dev/null; then
      echo "demo failed: ${label} exited during startup" >&2
      return 1
    fi
    if health_matches_instance "${url}"; then
      kill -0 "${process_id}" 2>/dev/null || {
        echo "demo failed: ${label} exited after its readiness check" >&2
        return 1
      }
      return 0
    fi
    sleep 0.25
    ((attempt += 1))
  done
  echo "demo failed: ${label} did not expose instance ${DEMO_INSTANCE_ID}" >&2
  return 1
}

cleanup() {
  trap - EXIT INT TERM
  for process_id in "${FRONTEND_PID}" "${BACKEND_PID}" "${WORKER_PID}"; do
    if [[ -n "${process_id}" ]] && kill -0 "${process_id}" 2>/dev/null; then
      kill "${process_id}" 2>/dev/null || true
    fi
  done
  wait "${FRONTEND_PID}" "${BACKEND_PID}" "${WORKER_PID}" 2>/dev/null || true
  if [[ "${DEMO_DATABASE_PATH}" == /tmp/iot-ids-demo.*/* ]]; then
    rm -f -- "${DEMO_DATABASE_PATH}"
    rmdir -- "${DEMO_TEMP_DIR}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

validate_port "${BACKEND_PORT}" "backend"
validate_port "${FRONTEND_PORT}" "frontend"
if [[ "${BACKEND_PORT}" == "${FRONTEND_PORT}" ]]; then
  echo "demo failed: backend and frontend ports must differ" >&2
  exit 2
fi
if port_is_open "${BACKEND_PORT}"; then
  echo "demo failed: backend port ${BACKEND_PORT} is already in use; stop the existing service or set DEMO_BACKEND_PORT" >&2
  exit 2
fi
if port_is_open "${FRONTEND_PORT}"; then
  echo "demo failed: frontend port ${FRONTEND_PORT} is already in use; stop the existing service or set DEMO_FRONTEND_PORT" >&2
  exit 2
fi

cd "${REPOSITORY_DIR}"
./scripts/preflight.sh --runtime-only

export IOT_IDS_DATABASE_URL="sqlite:///${DEMO_DATABASE_PATH}"
export IOT_IDS_MODEL_DIR="${REPOSITORY_DIR}/models/production"
export IOT_IDS_DATASET_PATH="${DATASET:-${REPOSITORY_DIR}/data/raw/RT_IOT2022.csv}"
export IOT_IDS_ALLOW_FALLBACK=false
export IOT_IDS_CORS_ORIGINS="http://127.0.0.1:${FRONTEND_PORT},http://localhost:${FRONTEND_PORT}"
export IOT_IDS_INSTANCE_ID="${DEMO_INSTANCE_ID}"
export IOT_IDS_API_PROXY_TARGET="http://127.0.0.1:${BACKEND_PORT}"
export UV_CACHE_DIR="${UV_CACHE_DIR:-/tmp/iot-ids-uv-cache}"
DEMO_ADMIN_PASSWORD="demo-${RANDOM}-${RANDOM}-$(date +%s)"
export IOT_IDS_AUTH_ENABLED=true
export IOT_IDS_ADMIN_USERNAME=admin
export IOT_IDS_ADMIN_PASSWORD_HASH="$(
  printf '%s\n' "${DEMO_ADMIN_PASSWORD}" |
    env PYTHONPATH="${REPOSITORY_DIR}/backend" \
      "${REPOSITORY_DIR}/backend/.venv/bin/python" -m app.api.auth --password-stdin
)"
export IOT_IDS_SECRET_KEY="$(
  "${REPOSITORY_DIR}/backend/.venv/bin/python" -c 'import secrets; print(secrets.token_urlsafe(48))'
)"

(
  cd backend
  .venv/bin/alembic upgrade head
)

(
  cd backend
  exec .venv/bin/python -m app.ingestion.worker
) &
WORKER_PID=$!

(
  cd backend
  exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "${BACKEND_PORT}" \
    --ws websockets-sansio --ws-max-size 65536 --ws-max-queue 8 \
    --ws-per-message-deflate false \
    --no-access-log --no-server-header
) &
BACKEND_PID=$!
wait_for_owned_health "http://127.0.0.1:${BACKEND_PORT}/health" \
  "${BACKEND_PID}" "backend" 120

(
  cd frontend
  exec npm run preview -- --host 127.0.0.1 --port "${FRONTEND_PORT}" --strictPort
) &
FRONTEND_PID=$!
wait_for_owned_health "http://127.0.0.1:${FRONTEND_PORT}/api/v1/health" \
  "${FRONTEND_PID}" "production dashboard" 80

echo
echo "Clean project demo is ready (database: disposable)."
echo "Instance:  ${DEMO_INSTANCE_ID}"
echo "Dashboard: http://127.0.0.1:${FRONTEND_PORT}"
echo "API docs:  http://127.0.0.1:${BACKEND_PORT}/docs"
echo "Operator:  admin / ${DEMO_ADMIN_PASSWORD} (valid only for this demo)"
echo "Worker:    durable ingestion/outbox processing active"
echo "Press Ctrl-C to stop and remove the demo database."

set +e
wait -n "${WORKER_PID}" "${BACKEND_PID}" "${FRONTEND_PID}"
exit_status=$?
set -e
echo "A demo service exited; stopping the other service." >&2
exit "${exit_status}"
