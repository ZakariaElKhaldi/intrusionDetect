.PHONY: help setup download-data prepare-data validate-data train verify-model test lint build dev migrate worker ingest-events pcap-validate pcap-ingest run-all check-all demo demo-preflight project-preflight e2e benchmark docker-up docker-down

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
COMPATIBILITY_EVIDENCE ?=
export UV_CACHE_DIR ?= /tmp/iot-ids-uv-cache

help:
	@echo "IoT IDS development commands"
	@echo "  make setup          Install backend, ML, and frontend dependencies"
	@echo "  make download-data  Fetch and checksum the official UCI archive"
	@echo "  make prepare-data   Safely verify and extract the canonical dataset"
	@echo "  make validate-data  Validate and profile DATASET=$(DATASET)"
	@echo "  make train          Train, evaluate, and promote real-data champions"
	@echo "  make verify-model   Verify the promoted artifacts and dataset provenance"
	@echo "  make test           Run backend, ML, and frontend tests"
	@echo "  make lint           Run Python and TypeScript linters"
	@echo "  make build          Build the frontend and validate Python imports"
	@echo "  make migrate        Upgrade the configured database to the latest schema"
	@echo "  make worker         Run the durable ingestion/outbox worker"
	@echo "  make ingest-events INGESTION_INPUT=path Stream canonical NDJSON (stdin by default)"
	@echo "  make pcap-validate PCAP=path Validate offline PCAP-derived features"
	@echo "  make pcap-ingest PCAP=path COMPATIBILITY_EVIDENCE=path Queue approved PCAP flows"
	@echo "  make dev            Print commands for local development"
	@echo "  make run-all        Run the full workflow, then start the application"
	@echo "  make check-all      Run the full workflow without starting servers"
	@echo "  make demo           Start a clean disposable demo without retraining"
	@echo "  make demo-preflight Check demo data, bundle, and production artifacts"
	@echo "  make project-preflight Run every acceptance check, including browser E2E"
	@echo "  make e2e            Run Playwright against real local services/models"
	@echo "  make benchmark      Measure normal and attack dataset replay"
	@echo "  make docker-up      Start the demonstration stack"

setup:
	cd backend && uv sync --extra dev --extra pcap
	cd machine-learning && uv sync --extra dev
	cd frontend && npm install

download-data:
	mkdir -p data/raw
	curl -L --fail --show-error -o data/raw/rt-iot2022.zip https://archive.ics.uci.edu/static/public/942/rt-iot2022.zip
	$(MAKE) prepare-data

prepare-data:
	cd machine-learning && uv run iot-ids-prepare $(abspath $(DATA_ARCHIVE)) \
		--output-dir $(abspath data/raw) \
		--manifest-path $(abspath data/dataset-manifest.json) \
		--expected-archive-sha256 $(ARCHIVE_SHA256) \
		--expected-dataset-sha256 $(DATASET_SHA256)

validate-data:
	cd machine-learning && uv run iot-ids-profile $(abspath $(DATASET))

train:
	cd machine-learning && uv run iot-ids-train $(abspath $(DATASET)) \
		--output-dir $(abspath $(MODEL_RUN_DIR))
	cd machine-learning && uv run iot-ids-promote \
		--run-dir $(abspath $(MODEL_RUN_DIR)) \
		--production-dir $(abspath $(PRODUCTION_MODEL_DIR)) \
		--expected-dataset-sha256 $(DATASET_SHA256) \
		--expected-row-count $(DATASET_ROWS)

verify-model:
	cd machine-learning && uv run iot-ids-verify \
		--production-dir $(abspath $(PRODUCTION_MODEL_DIR)) \
		--expected-dataset-sha256 $(DATASET_SHA256) \
		--expected-row-count $(DATASET_ROWS)

test:
	cd backend && uv run pytest
	cd machine-learning && uv run pytest
	cd frontend && npm test -- --run

lint:
	cd backend && uv run ruff check .
	cd machine-learning && uv run ruff check .
	cd frontend && npm run lint

build:
	cd backend && uv run python -m compileall -q app
	cd machine-learning && uv run python -m compileall -q src
	cd frontend && npm run build

migrate:
	cd backend && uv run alembic upgrade head

worker:
	cd backend && uv run python -m app.ingestion.worker

ingest-events:
	cd backend && uv run python -m app.ingestion.producer $(INGESTION_INPUT) \
		--url $(API_URL)/api/v1/ingestion/events

pcap-validate:
	@test -n "$(PCAP)" || (echo "error: set PCAP=/path/to/capture.pcap" >&2; exit 2)
	cd backend && uv run python -m app.ingestion.pcap_cli validate $(abspath $(PCAP))

pcap-ingest:
	@test -n "$(PCAP)" || (echo "error: set PCAP=/path/to/capture.pcap" >&2; exit 2)
	@test -n "$(COMPATIBILITY_EVIDENCE)" || (echo "error: set COMPATIBILITY_EVIDENCE=/path/to/evidence.json" >&2; exit 2)
	cd backend && uv run python -m app.ingestion.pcap_cli ingest $(abspath $(PCAP)) \
		--api-url $(API_URL) \
		--compatibility-evidence $(abspath $(COMPATIBILITY_EVIDENCE))

dev:
	@echo "Backend: cd backend && uv run uvicorn app.main:app --reload"
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

docker-up:
	docker compose up --build

docker-down:
	docker compose down
