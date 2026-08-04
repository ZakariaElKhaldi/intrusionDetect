#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
BACKEND_PORT="${DEMO_BACKEND_PORT:-8000}"
FRONTEND_PORT="${DEMO_FRONTEND_PORT:-4173}"
DEMO_TEMP_DIR="$(mktemp -d /tmp/iot-ids-demo.XXXXXX)"
DEMO_DATABASE_PATH="${DEMO_TEMP_DIR}/jury-demo.sqlite3"
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  trap - EXIT INT TERM
  for process_id in "${FRONTEND_PID}" "${BACKEND_PID}"; do
    if [[ -n "${process_id}" ]] && kill -0 "${process_id}" 2>/dev/null; then
      kill "${process_id}" 2>/dev/null || true
    fi
  done
  wait "${FRONTEND_PID}" "${BACKEND_PID}" 2>/dev/null || true
  if [[ "${DEMO_DATABASE_PATH}" == /tmp/iot-ids-demo.*/* ]]; then
    rm -f -- "${DEMO_DATABASE_PATH}"
    rmdir -- "${DEMO_TEMP_DIR}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

cd "${REPOSITORY_DIR}"
./scripts/preflight.sh --runtime-only

export IOT_IDS_DATABASE_URL="sqlite:///${DEMO_DATABASE_PATH}"
export IOT_IDS_MODEL_DIR="${REPOSITORY_DIR}/models/production"
export IOT_IDS_DATASET_PATH="${DATASET:-${REPOSITORY_DIR}/data/raw/RT_IOT2022.csv}"
export IOT_IDS_ALLOW_FALLBACK=false
export IOT_IDS_CORS_ORIGINS="http://127.0.0.1:${FRONTEND_PORT},http://localhost:${FRONTEND_PORT}"
export UV_CACHE_DIR="${UV_CACHE_DIR:-/tmp/iot-ids-uv-cache}"

(
  cd backend
  exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "${BACKEND_PORT}"
) &
BACKEND_PID=$!

for _ in {1..120}; do
  if curl --silent --fail "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null; then
    break
  fi
  if ! kill -0 "${BACKEND_PID}" 2>/dev/null; then
    echo "demo failed: backend exited during startup" >&2
    exit 1
  fi
  sleep 0.25
done
curl --silent --fail "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null || {
  echo "demo failed: backend did not become ready" >&2
  exit 1
}

(
  cd frontend
  exec npm run preview -- --host 127.0.0.1 --port "${FRONTEND_PORT}" --strictPort
) &
FRONTEND_PID=$!

for _ in {1..80}; do
  if curl --silent --fail "http://127.0.0.1:${FRONTEND_PORT}" >/dev/null; then
    break
  fi
  sleep 0.25
done
curl --silent --fail "http://127.0.0.1:${FRONTEND_PORT}" >/dev/null || {
  echo "demo failed: dashboard did not become ready" >&2
  exit 1
}

echo
echo "Clean jury demo is ready (database: disposable)."
echo "Dashboard: http://127.0.0.1:${FRONTEND_PORT}"
echo "API docs:  http://127.0.0.1:${BACKEND_PORT}/docs"
echo "Press Ctrl-C to stop and remove the demo database."

set +e
wait -n "${BACKEND_PID}" "${FRONTEND_PID}"
exit_status=$?
set -e
echo "A demo service exited; stopping the other service." >&2
exit "${exit_status}"
