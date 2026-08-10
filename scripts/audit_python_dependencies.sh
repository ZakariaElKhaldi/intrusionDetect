#!/usr/bin/env bash

set -Eeuo pipefail

REPOSITORY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
AUDIT_TEMP_DIR="$(mktemp -d /tmp/iot-ids-python-audit.XXXXXX)"
BACKEND_REQUIREMENTS="${AUDIT_TEMP_DIR}/backend-requirements.txt"
ML_REQUIREMENTS="${AUDIT_TEMP_DIR}/ml-requirements.txt"
UV_BIN="${UV:-uv}"
PIP_AUDIT_VERSION="2.10.1"

cleanup() {
  rm -f -- "${BACKEND_REQUIREMENTS}" "${ML_REQUIREMENTS}"
  rmdir -- "${AUDIT_TEMP_DIR}"
}
trap cleanup EXIT

export_lock() {
  local project="$1"
  local output="$2"
  "${UV_BIN}" --quiet export \
    --project "${REPOSITORY_DIR}/${project}" \
    --locked \
    --all-extras \
    --all-groups \
    --no-emit-project \
    --output-file "${output}"
}

audit_lock() {
  local requirements="$1"
  "${UV_BIN}" tool run "pip-audit@${PIP_AUDIT_VERSION}" \
    --require-hashes \
    --requirement "${requirements}"
}

export_lock backend "${BACKEND_REQUIREMENTS}"
export_lock machine-learning "${ML_REQUIREMENTS}"

echo "Auditing the complete backend dependency lock..."
audit_lock "${BACKEND_REQUIREMENTS}"
echo "Auditing the complete machine-learning dependency lock..."
audit_lock "${ML_REQUIREMENTS}"
