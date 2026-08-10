.PHONY: help setup download-data prepare-data validate-data train verify-model native-corpus native-train test lint build dev migrate worker model-health-worker ingest-events ingestion-ops pcap-validate pcap-ingest run-all check-all demo demo-preflight project-preflight e2e benchmark benchmark-postgres docker-up docker-down

DATASET ?= data/raw/RT_IOT2022.csv
DATA_ARCHIVE ?= data/raw/rt-iot2022.zip
DATASET_SHA256 ?= 956956c09c1764584fa08acd0f6876475626bcedcd6a6b1f8c492c2e9a2089ea
ARCHIVE_SHA256 ?= bcaa24d62abbb1215be576d5cf9c02dfcb0bb7c4c2f5a00e03055afaa1ed109e
DATASET_ROWS ?= 123117
MODEL_RUN_DIR ?= models/runs/latest
PRODUCTION_MODEL_DIR ?= models/production
PCAP ?=
INGESTION_INPUT ?= -
API_URL ?= http://127.0.0.1:8000
NATIVE_CAPTURE_MANIFEST ?=
NATIVE_LABEL_MANIFEST ?=
NATIVE_EXTRACTOR_MANIFEST ?= backend/app/features/nfstream_extractor_manifest.json
NATIVE_EXTRACTOR_FINGERPRINT ?=
NATIVE_CORPUS_MANIFEST ?= data/nfstream/corpus-manifest.json
NATIVE_DATASET ?=
NATIVE_MODEL_RUN_DIR ?= models/runs/nfstream-latest
export UV_CACHE_DIR ?= /tmp/iot-ids-uv-cache
UV ?= uv
BACKEND_PYTHON := backend/.venv/bin/python
ML_BIN := machine-learning/.venv/bin

help:
	@echo "IoT IDS development commands"
	@echo "  make setup          Install backend, ML, and frontend dependencies"
	@echo "  make download-data  Fetch and checksum the official UCI archive"
	@echo "  make prepare-data   Safely verify and extract the canonical dataset"
	@echo "  make validate-data  Validate and profile DATASET=$(DATASET)"
	@echo "  make train          Train, evaluate, and promote real-data champions"
	@echo "  make verify-model   Verify the promoted artifacts and dataset provenance"
	@echo "  make native-corpus  Validate capture/label provenance and freeze session splits"
	@echo "  make native-train   Evaluate NFStream-native candidates against frozen splits"
	@echo "  make test           Run backend, ML, and frontend tests"
	@echo "  make lint           Run Python and TypeScript linters"
	@echo "  make build          Build the frontend and validate Python imports"
	@echo "  make migrate        Upgrade the configured database to the latest schema"
	@echo "  make worker         Run the durable ingestion/outbox worker"
	@echo "  make model-health-worker Run the five-minute model-health evaluator"
	@echo "  make ingest-events INGESTION_INPUT=path Stream canonical NDJSON (stdin by default)"
	@echo "  make ingestion-ops ARGS='list --state dead_letter' Inspect/recover ingestion jobs"
	@echo "  make pcap-validate PCAP=path Validate offline PCAP-derived features"
	@echo "  make pcap-ingest PCAP=path Queue PCAP flows for server-side route verification"
	@echo "  make dev            Print commands for local development"
	@echo "  make run-all        Run the full workflow, then start the application"
	@echo "  make check-all      Run the full workflow without starting servers"
	@echo "  make demo           Start a clean disposable demo without retraining"
	@echo "  make demo-preflight Check demo data, bundle, and production artifacts"
	@echo "  make project-preflight Run every acceptance check, including browser E2E"
	@echo "  make e2e            Run Playwright against real local services/models"
	@echo "  make benchmark      Measure normal and attack dataset replay"
	@echo "  make benchmark-postgres INGESTION_INPUT=path Benchmark the PostgreSQL queue"
	@echo "  make docker-up      Start the demonstration stack"

setup:
	cd backend && $(UV) sync --extra dev --extra postgres --extra pcap
	cd machine-learning && $(UV) sync --extra dev
	cd frontend && npm install

download-data:
	mkdir -p data/raw
	curl -L --fail --show-error -o data/raw/rt-iot2022.zip https://archive.ics.uci.edu/static/public/942/rt-iot2022.zip
	$(MAKE) prepare-data

prepare-data:
	$(ML_BIN)/iot-ids-prepare $(abspath $(DATA_ARCHIVE)) \
		--output-dir $(abspath data/raw) \
		--manifest-path $(abspath data/dataset-manifest.json) \
		--expected-archive-sha256 $(ARCHIVE_SHA256) \
		--expected-dataset-sha256 $(DATASET_SHA256)

validate-data:
	$(ML_BIN)/iot-ids-profile $(abspath $(DATASET))

train:
	$(ML_BIN)/iot-ids-train $(abspath $(DATASET)) \
		--output-dir $(abspath $(MODEL_RUN_DIR))
	$(ML_BIN)/iot-ids-promote \
		--run-dir $(abspath $(MODEL_RUN_DIR)) \
		--production-dir $(abspath $(PRODUCTION_MODEL_DIR)) \
		--expected-dataset-sha256 $(DATASET_SHA256) \
		--expected-row-count $(DATASET_ROWS)

verify-model:
	$(ML_BIN)/iot-ids-verify \
		--production-dir $(abspath $(PRODUCTION_MODEL_DIR)) \
		--expected-dataset-sha256 $(DATASET_SHA256) \
		--expected-row-count $(DATASET_ROWS)

native-corpus:
	@test -n "$(NATIVE_CAPTURE_MANIFEST)" || (echo "error: set NATIVE_CAPTURE_MANIFEST" >&2; exit 2)
	@test -n "$(NATIVE_LABEL_MANIFEST)" || (echo "error: set NATIVE_LABEL_MANIFEST" >&2; exit 2)
	@test -n "$(NATIVE_EXTRACTOR_FINGERPRINT)" || (echo "error: set NATIVE_EXTRACTOR_FINGERPRINT" >&2; exit 2)
	$(ML_BIN)/iot-ids-native-corpus \
		--capture-manifest $(abspath $(NATIVE_CAPTURE_MANIFEST)) \
		--label-manifest $(abspath $(NATIVE_LABEL_MANIFEST)) \
		--extractor-manifest $(abspath $(NATIVE_EXTRACTOR_MANIFEST)) \
		--extractor-fingerprint $(NATIVE_EXTRACTOR_FINGERPRINT) \
		--output $(abspath $(NATIVE_CORPUS_MANIFEST))

native-train:
	@test -n "$(NATIVE_DATASET)" || (echo "error: set NATIVE_DATASET" >&2; exit 2)
	$(ML_BIN)/iot-ids-native-train $(abspath $(NATIVE_DATASET)) \
		--corpus-manifest $(abspath $(NATIVE_CORPUS_MANIFEST)) \
		--output-dir $(abspath $(NATIVE_MODEL_RUN_DIR))

test:
	cd backend && .venv/bin/pytest
	cd machine-learning && .venv/bin/pytest
	cd frontend && npm test -- --run

lint:
	backend/.venv/bin/ruff check backend
	machine-learning/.venv/bin/ruff check machine-learning
	cd frontend && npm run lint

build:
	$(BACKEND_PYTHON) -m compileall -q backend/app
	machine-learning/.venv/bin/python -m compileall -q machine-learning/src
	cd frontend && npm run build

migrate:
	cd backend && .venv/bin/alembic upgrade head

worker:
	cd backend && .venv/bin/python -m app.ingestion.worker

model-health-worker:
	cd backend && .venv/bin/python -m app.monitoring.worker

ingest-events:
	cd backend && .venv/bin/python -m app.ingestion.producer $(INGESTION_INPUT) \
		--url $(API_URL)/api/v1/ingestion/events

ingestion-ops:
	cd backend && .venv/bin/python -m app.ingestion.operator_cli $(ARGS)

pcap-validate:
	@test -n "$(PCAP)" || (echo "error: set PCAP=/path/to/capture.pcap" >&2; exit 2)
	cd backend && .venv/bin/python -m app.ingestion.pcap_cli validate $(abspath $(PCAP))

pcap-ingest:
	@test -n "$(PCAP)" || (echo "error: set PCAP=/path/to/capture.pcap" >&2; exit 2)
	cd backend && .venv/bin/python -m app.ingestion.pcap_cli ingest $(abspath $(PCAP)) \
		--api-url $(API_URL)

dev:
	@echo "Database: make migrate"
	@echo "Backend: cd backend && uv run uvicorn app.main:app --reload --ws websockets-sansio --ws-max-size 65536 --ws-per-message-deflate false --no-access-log --no-server-header"
	@echo "Worker:  cd backend && uv run python -m app.ingestion.worker"
	@echo "Frontend: cd frontend && npm run dev"
	@echo "API docs: http://localhost:8000/docs"

run-all:
	./scripts/run_all.sh

check-all:
	./scripts/run_all.sh --check-only

demo:
	./scripts/demo.sh

demo-preflight:
	./scripts/preflight.sh --runtime-only

project-preflight:
	./scripts/preflight.sh

e2e:
	cd frontend && npm run test:e2e

benchmark:
	./scripts/run_replay_benchmark.sh

benchmark-postgres:
	@test -n "$(INGESTION_INPUT)" || (echo "error: set INGESTION_INPUT=/path/to/events.ndjson" >&2; exit 2)
	@test -n "$(IOT_IDS_DATABASE_URL)" || (echo "error: set IOT_IDS_DATABASE_URL to PostgreSQL" >&2; exit 2)
	cd backend && .venv/bin/python ../scripts/postgres_ingestion_benchmark.py \
		$(abspath $(INGESTION_INPUT)) --database-url "$(IOT_IDS_DATABASE_URL)" --api-url $(API_URL)

docker-up:
	docker compose up --build

docker-down:
	docker compose down
