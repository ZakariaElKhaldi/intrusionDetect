from __future__ import annotations

import asyncio
from contextlib import suppress

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.database.models import OutboxEvent
from app.ingestion.service import now_utc
from app.live import LiveConnectionManager


async def dispatch_one(
    session_factory: sessionmaker[Session], live: LiveConnectionManager
) -> bool:
    with session_factory() as session:
        query = (
            select(OutboxEvent)
            .where(OutboxEvent.published_at.is_(None))
            .order_by(OutboxEvent.created_at)
            .limit(1)
        )
        if session.bind is not None and session.bind.dialect.name == "postgresql":
            query = query.with_for_update(skip_locked=True)
        row = session.scalar(query)
        if row is None:
            return False
        try:
            await live.broadcast(row.payload)
            row.published_at = now_utc()
            row.publish_attempts += 1
            row.last_error = None
            session.commit()
        except Exception as exc:  # pragma: no cover - manager normally isolates sockets
            row.publish_attempts += 1
            row.last_error = f"{type(exc).__name__}: {exc}"[:10_000]
            session.commit()
        return True


async def dispatch_loop(
    session_factory: sessionmaker[Session],
    live: LiveConnectionManager,
    *,
    poll_seconds: float,
) -> None:
    while True:
        processed = await dispatch_one(session_factory, live)
        if not processed:
            await asyncio.sleep(poll_seconds)


async def stop_dispatcher(task: asyncio.Task[None] | None) -> None:
    if task is None:
        return
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task
