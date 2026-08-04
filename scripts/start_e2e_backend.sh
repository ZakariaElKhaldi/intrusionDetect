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
export UV_CACHE_DIR="${UV_CACHE_DIR:-/tmp/iot-ids-uv-cache}"

cd "${REPOSITORY_DIR}/backend"
exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001
