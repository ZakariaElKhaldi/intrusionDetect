#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
DATASET_PATH="${DATASET:-${REPOSITORY_DIR}/data/raw/RT_IOT2022.csv}"
EXPECTED_DATASET_SHA256="${DATASET_SHA256:-956956c09c1764584fa08acd0f6876475626bcedcd6a6b1f8c492c2e9a2089ea}"
EXPECTED_ROWS="${DATASET_ROWS:-123117}"
RUNTIME_ONLY=false

if [[ "${1:-}" == "--runtime-only" ]]; then
  RUNTIME_ONLY=true
elif [[ $# -gt 0 ]]; then
  echo "usage: ./scripts/preflight.sh [--runtime-only]" >&2
  exit 2
fi

fail() {
  echo "preflight failed: $*" >&2
  exit 1
}

for command in npm sha256sum awk; do
  command -v "${command}" >/dev/null 2>&1 || fail "required command is unavailable: ${command}"
done

[[ -f "${DATASET_PATH}" ]] || fail "dataset missing: ${DATASET_PATH} (run 'make prepare-data')"
actual_checksum="$(sha256sum "${DATASET_PATH}" | awk '{print $1}')"
[[ "${actual_checksum}" == "${EXPECTED_DATASET_SHA256}" ]] || \
  fail "dataset checksum mismatch: expected ${EXPECTED_DATASET_SHA256}, got ${actual_checksum}"
actual_rows="$(awk 'END { print NR - 1 }' "${DATASET_PATH}")"
[[ "${actual_rows}" == "${EXPECTED_ROWS}" ]] || \
  fail "dataset row count mismatch: expected ${EXPECTED_ROWS}, got ${actual_rows}"

[[ -f "${REPOSITORY_DIR}/models/production/manifest.json" ]] || \
  fail "production manifest missing (model promotion is required)"
[[ -x "${REPOSITORY_DIR}/backend/.venv/bin/uvicorn" ]] || \
  fail "backend environment missing (run 'make setup')"
[[ -x "${REPOSITORY_DIR}/machine-learning/.venv/bin/python" ]] || \
  fail "machine-learning environment missing (run 'make setup')"
if [[ "${RUNTIME_ONLY}" == true ]]; then
  [[ -f "${REPOSITORY_DIR}/frontend/dist/index.html" ]] || \
    fail "production frontend bundle missing (run 'make build')"
fi

export UV_CACHE_DIR="${UV_CACHE_DIR:-/tmp/iot-ids-uv-cache}"
cd "${REPOSITORY_DIR}"
(
  cd machine-learning
  .venv/bin/python -c 'from iot_ids_ml.cli import verify_main; verify_main()' \
    --production-dir "${REPOSITORY_DIR}/models/production" \
    --expected-dataset-sha256 "${EXPECTED_DATASET_SHA256}" \
    --expected-row-count "${EXPECTED_ROWS}"
)

if [[ "${RUNTIME_ONLY}" == true ]]; then
  echo "Demo preflight passed: verified dataset, promoted models, and frontend bundle."
  exit 0
fi

(
  cd machine-learning
  .venv/bin/iot-ids-profile "${DATASET_PATH}"
)
(
  cd backend
  .venv/bin/ruff check .
  .venv/bin/pytest
  .venv/bin/python -m compileall -q app
)
(
  cd machine-learning
  .venv/bin/ruff check .
  .venv/bin/pytest
  .venv/bin/python -m compileall -q src
)
(
  cd frontend
  npm run lint
  npm test -- --run
  npm run build
)
[[ -f "${REPOSITORY_DIR}/frontend/dist/index.html" ]] || \
  fail "frontend build completed without dist/index.html"
make e2e
echo "Project preflight passed: data, artifacts, backend, ML, frontend, build, and E2E."
