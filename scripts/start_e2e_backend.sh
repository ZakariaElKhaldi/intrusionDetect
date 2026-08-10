#!/usr/bin/env bash

set -Eeuo pipefail

REPOSITORY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
E2E_DATABASE_PATH="/tmp/iot-ids-e2e.sqlite3"

rm -f -- "${E2E_DATABASE_PATH}"
export IOT_IDS_DATABASE_URL="sqlite:///${E2E_DATABASE_PATH}"
export IOT_IDS_MODEL_DIR="${REPOSITORY_DIR}/models/production"
export IOT_IDS_DATASET_PATH="${REPOSITORY_DIR}/data/raw/RT_IOT2022.csv"
export IOT_IDS_ALLOW_FALLBACK=false
export IOT_IDS_CORS_ORIGINS="http://127.0.0.1:4174"
export IOT_IDS_INSTANCE_ID="${IOT_IDS_INSTANCE_ID:-project-e2e-production-preview}"
export IOT_IDS_AUTH_ENABLED=true
export IOT_IDS_ADMIN_USERNAME=admin
export IOT_IDS_ADMIN_PASSWORD_HASH='$argon2id$v=19$m=65536,t=3,p=4$pJmg2l4q6KWshn/k8ujpMg$O92SOOwc/0ac7TTUW6m92Z0KzJbpLCzI8Ya1aEwW6U8'
export IOT_IDS_SECRET_KEY="project-e2e-secret-key-at-least-32-bytes"
export UV_CACHE_DIR="${UV_CACHE_DIR:-/tmp/iot-ids-uv-cache}"

cd "${REPOSITORY_DIR}/backend"
.venv/bin/alembic upgrade head
exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001 \
  --ws websockets --ws-max-size 65536 --ws-max-queue 8 \
  --ws-per-message-deflate false \
  --no-access-log --no-server-header
