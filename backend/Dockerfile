FROM python:3.12-slim

WORKDIR /app/backend
COPY backend/pyproject.toml .
COPY backend/app ./app
COPY backend/alembic.ini ./alembic.ini
COPY backend/alembic ./alembic
COPY data /app/data
COPY models /app/models
RUN pip install --no-cache-dir ".[postgres,pcap]"

ENV IOT_IDS_DATABASE_URL=sqlite:////data/iot_ids.db
VOLUME ["/data"]
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
