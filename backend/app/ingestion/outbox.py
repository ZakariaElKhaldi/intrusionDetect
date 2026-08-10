from __future__ import annotations

import asyncio
import logging
import threading
from concurrent.futures import TimeoutError as FutureTimeoutError
from copy import deepcopy
from dataclasses import dataclass
from datetime import timedelta
from uuid import uuid4

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session, sessionmaker

from app.database.models import OutboxEvent
from app.ingestion.service import now_utc
from app.live import LiveConnectionManager

LOGGER = logging.getLogger("iot_ids.outbox")
MAX_RETRY_SECONDS = 30


@dataclass(frozen=True, slots=True)
class ClaimedEvent:
    outbox_id: str
    claim_token: str
    payload: dict
    prior_attempts: int


def _available(now):
    return (
        OutboxEvent.published_at.is_(None),
        or_(OutboxEvent.next_attempt_at.is_(None), OutboxEvent.next_attempt_at <= now),
        or_(
            OutboxEvent.claim_token.is_(None),
            OutboxEvent.claim_expires_at.is_(None),
            OutboxEvent.claim_expires_at <= now,
        ),
    )


def _claim_one(
    session_factory: sessionmaker[Session], *, lease_seconds: int
) -> ClaimedEvent | None:
    """Atomically reserve one committed event without holding a transaction open."""
    now = now_utc()
    with session_factory() as session:
        query = (
            select(OutboxEvent)
            .where(*_available(now))
            .order_by(OutboxEvent.created_at, OutboxEvent.outbox_id)
            .limit(1)
        )
        if session.bind is not None and session.bind.dialect.name == "postgresql":
            query = query.with_for_update(skip_locked=True)
        row = session.scalar(query)
        if row is None:
            return None

        claim_token = str(uuid4())
        result = session.execute(
            update(OutboxEvent)
            .where(OutboxEvent.outbox_id == row.outbox_id, *_available(now))
            .values(
                claim_token=claim_token,
                claim_expires_at=now + timedelta(seconds=lease_seconds),
            )
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            session.rollback()
            return None
        session.commit()
        return ClaimedEvent(
            outbox_id=row.outbox_id,
            claim_token=claim_token,
            payload=deepcopy(row.payload),
            prior_attempts=row.publish_attempts,
        )


def _mark_published(
    session_factory: sessionmaker[Session], claim: ClaimedEvent
) -> bool:
    with session_factory() as session:
        result = session.execute(
            update(OutboxEvent)
            .where(
                OutboxEvent.outbox_id == claim.outbox_id,
                OutboxEvent.published_at.is_(None),
                OutboxEvent.claim_token == claim.claim_token,
            )
            .values(
                published_at=now_utc(),
                publish_attempts=OutboxEvent.publish_attempts + 1,
                last_error=None,
                claim_token=None,
                claim_expires_at=None,
                next_attempt_at=None,
            )
            .execution_options(synchronize_session=False)
        )
        session.commit()
        return result.rowcount == 1


def _record_failure(
    session_factory: sessionmaker[Session],
    claim: ClaimedEvent,
    error: BaseException,
    *,
    retry_seconds: float,
) -> bool:
    now = now_utc()
    with session_factory() as session:
        result = session.execute(
            update(OutboxEvent)
            .where(
                OutboxEvent.outbox_id == claim.outbox_id,
                OutboxEvent.published_at.is_(None),
                OutboxEvent.claim_token == claim.claim_token,
            )
            .values(
                publish_attempts=OutboxEvent.publish_attempts + 1,
                last_error=f"{type(error).__name__}: {error}"[:10_000],
                claim_token=None,
                claim_expires_at=None,
                next_attempt_at=now + timedelta(seconds=retry_seconds),
            )
            .execution_options(synchronize_session=False)
        )
        session.commit()
        return result.rowcount == 1


def _retry_delay(prior_attempts: int) -> int:
    return min(MAX_RETRY_SECONDS, 2 ** min(prior_attempts, 10))


async def dispatch_one(
    session_factory: sessionmaker[Session],
    live: LiveConnectionManager,
    *,
    lease_seconds: int = 30,
) -> bool:
    """Dispatch one event; intended for deterministic unit and maintenance use."""
    claim = _claim_one(session_factory, lease_seconds=lease_seconds)
    if claim is None:
        return False
    try:
        await live.broadcast(claim.payload)
    except asyncio.CancelledError as exc:
        _record_failure(
            session_factory,
            claim,
            exc,
            retry_seconds=0,
        )
        raise
    except Exception as exc:  # pragma: no cover - manager normally isolates sockets
        _record_failure(
            session_factory,
            claim,
            exc,
            retry_seconds=_retry_delay(claim.prior_attempts),
        )
    else:
        _mark_published(session_factory, claim)
    return True


class OutboxDispatcher:
    """Own outbox database work in one thread and schedule only sends on asyncio."""

    def __init__(
        self,
        session_factory: sessionmaker[Session],
        live: LiveConnectionManager,
        *,
        poll_seconds: float,
        lease_seconds: int,
    ) -> None:
        self.session_factory = session_factory
        self.live = live
        self.poll_seconds = poll_seconds
        self.lease_seconds = lease_seconds
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    def start(self) -> None:
        if self._thread is not None:
            raise RuntimeError("outbox dispatcher is already started")
        self._loop = asyncio.get_running_loop()
        self._thread = threading.Thread(
            target=self._run,
            name="iot-outbox",
            daemon=True,
        )
        self._thread.start()

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def _run(self) -> None:
        assert self._loop is not None
        while not self._stop.is_set():
            try:
                claim = _claim_one(
                    self.session_factory, lease_seconds=self.lease_seconds
                )
                if claim is not None:
                    self._deliver(claim)
            except Exception:
                LOGGER.exception("Transactional outbox dispatch failed")
                self._stop.wait(self.poll_seconds)
                continue
            if claim is None:
                self._stop.wait(self.poll_seconds)

    def _deliver(self, claim: ClaimedEvent) -> None:
        assert self._loop is not None
        delivery = asyncio.run_coroutine_threadsafe(
            self.live.broadcast(claim.payload), self._loop
        )
        try:
            delivery.result(timeout=self.live.send_timeout_seconds + 1)
        except FutureTimeoutError as exc:
            delivery.cancel()
            _record_failure(
                self.session_factory,
                claim,
                exc,
                retry_seconds=_retry_delay(claim.prior_attempts),
            )
        except Exception as exc:
            _record_failure(
                self.session_factory,
                claim,
                exc,
                retry_seconds=_retry_delay(claim.prior_attempts),
            )
        else:
            _mark_published(self.session_factory, claim)

    async def stop(self) -> None:
        self._stop.set()
        thread = self._thread
        if thread is None:
            return
        deadline = asyncio.get_running_loop().time() + self.live.send_timeout_seconds + 2
        while self.running and asyncio.get_running_loop().time() < deadline:
            await asyncio.sleep(0.01)
        if self.running:
            LOGGER.error("Outbox dispatcher did not stop before its shutdown deadline")
        else:
            thread.join(timeout=0)
