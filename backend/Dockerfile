FROM python:3.12-slim

WORKDIR /app/backend
COPY backend/pyproject.toml .
COPY backend/app ./app
COPY backend/alembic.ini ./alembic.ini
COPY backend/alembic ./alembic
COPY data /app/data
COPY models /app/models
RUN pip install --no-cache-dir ".[postgres,pcap]"

RUN groupadd --gid 10001 iotids \
    && useradd --uid 10001 --gid iotids --no-log-init --create-home iotids \
    && mkdir -p /data \
    && chown iotids:iotids /data

ENV IOT_IDS_DATABASE_URL=sqlite:////data/iot_ids.db
VOLUME ["/data"]
EXPOSE 8000
USER 10001:10001
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/livez', timeout=2)"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
