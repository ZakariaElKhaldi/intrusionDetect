#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

DATASET_PATH="${DATASET:-${REPOSITORY_DIR}/data/sample/rt_iot2022_sample.csv}"
UV_CACHE_DIR="${UV_CACHE_DIR:-/tmp/iot-ids-uv-cache}"
SKIP_SETUP=false
CHECK_ONLY=false

usage() {
  cat <<'EOF'
Usage: ./scripts/run_all.sh [options]

Runs the IoT IDS workflow in the documented order:
  1. Install dependencies
  2. Validate and profile the dataset
  3. Train and package baseline models
  4. Run lint checks
  5. Run all tests
  6. Build production assets
  7. Start FastAPI and Vite

Options:
  --dataset PATH  Use a specific RT-IoT2022 CSV.
  --skip-setup    Reuse already-installed dependencies.
  --check-only    Stop after validation, training, lint, tests, and build.
  -h, --help      Show this help.

The DATASET environment variable may also provide the dataset path.
EOF
}

while (($#)); do
  case "$1" in
    --dataset)
      if (($# < 2)); then
        echo "error: --dataset requires a path" >&2
        exit 2
      fi
      DATASET_PATH="$2"
      shift 2
      ;;
    --skip-setup)
      SKIP_SETUP=true
      shift
      ;;
    --check-only)
      CHECK_ONLY=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! -f "${DATASET_PATH}" ]]; then
  echo "error: dataset does not exist: ${DATASET_PATH}" >&2
  exit 2
fi
DATASET_PATH="$(
  cd -- "$(dirname -- "${DATASET_PATH}")"
  printf '%s/%s\n' "$(pwd)" "$(basename -- "${DATASET_PATH}")"
)"

for command in uv node npm make; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "error: required command is unavailable: ${command}" >&2
    exit 127
  fi
done

export UV_CACHE_DIR

run_step() {
  local label="$1"
  shift
  echo
  echo "==> ${label}"
  "$@"
}

cd "${REPOSITORY_DIR}"

if [[ "${SKIP_SETUP}" == false ]]; then
  run_step "Installing dependencies" make setup
fi

run_step "Validating and profiling dataset" \
  make validate-data "DATASET=${DATASET_PATH}"
run_step "Training and packaging baseline models" \
  make train "DATASET=${DATASET_PATH}"
run_step "Running lint and type checks" make lint
run_step "Running backend, ML, and frontend tests" make test
run_step "Building production assets" make build

if [[ "${CHECK_ONLY}" == true ]]; then
  echo
  echo "All validation, training, test, and build steps passed."
  exit 0
fi

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  trap - EXIT INT TERM
  if [[ -n "${FRONTEND_PID}" ]] && kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    kill "${FRONTEND_PID}" 2>/dev/null || true
  fi
  if [[ -n "${BACKEND_PID}" ]] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    kill "${BACKEND_PID}" 2>/dev/null || true
  fi
  wait "${FRONTEND_PID}" "${BACKEND_PID}" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

echo
echo "==> Starting application"
(
  cd backend
  exec uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
) &
BACKEND_PID=$!

(
  cd frontend
  exec npm run dev -- --host 0.0.0.0
) &
FRONTEND_PID=$!

echo "API:       http://localhost:8000"
echo "API docs:  http://localhost:8000/docs"
echo "Dashboard: http://localhost:5173"
echo "Press Ctrl-C to stop both services."

set +e
wait -n "${BACKEND_PID}" "${FRONTEND_PID}"
EXIT_STATUS=$?
set -e

echo "A service exited; stopping the remaining process."
exit "${EXIT_STATUS}"
