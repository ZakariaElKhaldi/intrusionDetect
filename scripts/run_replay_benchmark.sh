#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
BENCHMARK_TEMP_DIR="$(mktemp -d /tmp/iot-ids-benchmark.XXXXXX)"
BENCHMARK_DATABASE_PATH="${BENCHMARK_TEMP_DIR}/benchmark.sqlite3"
BACKEND_PID=""

cleanup() {
  trap - EXIT INT TERM
  if [[ -n "${BACKEND_PID}" ]] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    kill "${BACKEND_PID}" 2>/dev/null || true
  fi
  wait "${BACKEND_PID}" 2>/dev/null || true
  if [[ "${BENCHMARK_DATABASE_PATH}" == /tmp/iot-ids-benchmark.*/* ]]; then
    rm -f -- "${BENCHMARK_DATABASE_PATH}"
    rmdir -- "${BENCHMARK_TEMP_DIR}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

cd "${REPOSITORY_DIR}"
./scripts/preflight.sh --runtime-only

export IOT_IDS_DATABASE_URL="sqlite:///${BENCHMARK_DATABASE_PATH}"
export IOT_IDS_MODEL_DIR="${REPOSITORY_DIR}/models/production"
export IOT_IDS_DATASET_PATH="${DATASET:-${REPOSITORY_DIR}/data/raw/RT_IOT2022.csv}"
export IOT_IDS_ALLOW_FALLBACK=false
export UV_CACHE_DIR="${UV_CACHE_DIR:-/tmp/iot-ids-uv-cache}"
export IOT_IDS_AUTH_ENABLED=true
export IOT_IDS_ADMIN_USERNAME=admin
BENCHMARK_ADMIN_PASSWORD="benchmark-${RANDOM}-${RANDOM}-$(date +%s)"
export IOT_IDS_ADMIN_PASSWORD_HASH="$(
  printf '%s\n' "${BENCHMARK_ADMIN_PASSWORD}" |
    env PYTHONPATH="${REPOSITORY_DIR}/backend" \
      "${REPOSITORY_DIR}/backend/.venv/bin/python" -m app.api.auth --password-stdin
)"
unset BENCHMARK_ADMIN_PASSWORD
export IOT_IDS_SECRET_KEY="$(
  "${REPOSITORY_DIR}/backend/.venv/bin/python" -c \
    'import secrets; print(secrets.token_urlsafe(48))'
)"
export IOT_IDS_API_TOKEN="$(
  env PYTHONPATH="${REPOSITORY_DIR}/backend" \
    "${REPOSITORY_DIR}/backend/.venv/bin/python" -c \
    'import os; from app.api.auth import create_access_token; print(create_access_token("admin", os.environ["IOT_IDS_SECRET_KEY"], expires_in=1800)[0])'
)"

(
  cd backend
  .venv/bin/alembic upgrade head
)

(
  cd backend
  exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8010 \
    --ws websockets-sansio --ws-max-size 65536 --ws-max-queue 8 \
    --ws-per-message-deflate false \
    --no-access-log --no-server-header
) &
BACKEND_PID=$!

for _ in {1..120}; do
  curl --silent --fail http://127.0.0.1:8010/health >/dev/null && break
  sleep 0.25
done
curl --silent --fail http://127.0.0.1:8010/health >/dev/null || {
  echo "benchmark failed: backend did not become ready" >&2
  exit 1
}

cd backend
.venv/bin/python ../scripts/replay_benchmark.py \
  --database "${BENCHMARK_DATABASE_PATH}" \
  --limit "${BENCHMARK_LIMIT:-200}" \
  --output-json "${REPOSITORY_DIR}/docs/evidence/replay-benchmark.json" \
  --output-markdown "${REPOSITORY_DIR}/docs/evidence/replay-benchmark.md"
