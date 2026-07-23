.PHONY: help setup download-data validate-data train test lint build dev run-all check-all docker-up docker-down

DATASET ?= data/sample/rt_iot2022_sample.csv
export UV_CACHE_DIR ?= /tmp/iot-ids-uv-cache

help:
	@echo "IoT IDS development commands"
	@echo "  make setup          Install backend, ML, and frontend dependencies"
	@echo "  make download-data  Fetch and checksum the official UCI archive"
	@echo "  make validate-data  Validate and profile DATASET=$(DATASET)"
	@echo "  make train          Train and evaluate baseline models"
	@echo "  make test           Run backend, ML, and frontend tests"
	@echo "  make lint           Run Python and TypeScript linters"
	@echo "  make build          Build the frontend and validate Python imports"
	@echo "  make dev            Print commands for local development"
	@echo "  make run-all        Run the full workflow, then start the application"
	@echo "  make check-all      Run the full workflow without starting servers"
	@echo "  make docker-up      Start the demonstration stack"

setup:
	cd backend && uv sync --extra dev
	cd machine-learning && uv sync --extra dev
	cd frontend && npm install

download-data:
	mkdir -p data/raw
	curl -L --fail --show-error -o data/raw/rt-iot2022.zip https://archive.ics.uci.edu/static/public/942/rt-iot2022.zip
	echo "bcaa24d62abbb1215be576d5cf9c02dfcb0bb7c4c2f5a00e03055afaa1ed109e  data/raw/rt-iot2022.zip" | sha256sum --check -
	unzip -o data/raw/rt-iot2022.zip -d data/raw
	echo "956956c09c1764584fa08acd0f6876475626bcedcd6a6b1f8c492c2e9a2089ea  data/raw/RT_IOT2022" | sha256sum --check -

validate-data:
	cd machine-learning && uv run iot-ids-profile $(abspath $(DATASET))

train:
	cd machine-learning && uv run iot-ids-train $(abspath $(DATASET)) --output-dir $(abspath models/artifacts)

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

dev:
	@echo "Backend: cd backend && uv run uvicorn app.main:app --reload"
	@echo "Frontend: cd frontend && npm run dev"
	@echo "API docs: http://localhost:8000/docs"

run-all:
	./scripts/run_all.sh

check-all:
	./scripts/run_all.sh --check-only

docker-up:
	docker compose up --build

docker-down:
	docker compose down
