FROM python:3.12-slim@sha256:229a2c5bfa27522db7815ea81f9bed70af17ccb9de9fc7ad142b1877b5830d36

WORKDIR /app/backend
COPY --from=ghcr.io/astral-sh/uv:0.11.16@sha256:440fd6477af86a2f1b38080c539f1672cd22acb1b1a47e321dba5158ab08864d /uv /uvx /bin/
COPY backend/pyproject.toml .
COPY backend/uv.lock .
RUN uv sync --locked --no-dev --extra postgres --extra pcap \
      --no-install-project --no-cache
COPY backend/app ./app
COPY backend/alembic.ini ./alembic.ini
COPY backend/alembic ./alembic
COPY --chown=10001:10001 data /app/data
COPY --chown=10001:10001 models /app/models
RUN uv sync --locked --no-dev --extra postgres --extra pcap --no-editable --no-cache

RUN groupadd --gid 10001 iotids \
    && useradd --uid 10001 --gid iotids --no-log-init --create-home iotids \
    && mkdir -p /data \
    && chown iotids:iotids /data

ENV IOT_IDS_DATABASE_URL=sqlite:////data/iot_ids.db
ENV PATH="/app/backend/.venv/bin:${PATH}"
VOLUME ["/data"]
EXPOSE 8000
USER 10001:10001
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/livez', timeout=2)"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--ws", "websockets-sansio", "--ws-max-size", "65536", "--ws-max-queue", "8", "--ws-per-message-deflate", "false", "--no-access-log", "--no-server-header"]
