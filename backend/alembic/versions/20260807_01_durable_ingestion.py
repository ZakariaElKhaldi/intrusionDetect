"""Bootstrap the application schema and add durable ingestion."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.database.models import Base

revision: str = "20260807_01"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _create_ingestion_jobs() -> None:
    op.create_table(
        "ingestion_jobs",
        sa.Column("job_id", sa.String(36), primary_key=True),
        sa.Column("batch_id", sa.String(36), nullable=False),
        sa.Column("event_id", sa.String(36), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("state", sa.String(24), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("worker_id", sa.String(128), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("event_id"),
    )
    for name, columns in (
        ("ix_ingestion_jobs_batch_id", ["batch_id"]),
        ("ix_ingestion_jobs_event_id", ["event_id"]),
        ("ix_ingestion_jobs_state", ["state"]),
        ("ix_ingestion_jobs_lease_expires_at", ["lease_expires_at"]),
    ):
        op.create_index(name, "ingestion_jobs", columns)


def _create_outbox() -> None:
    op.create_table(
        "outbox_events",
        sa.Column("outbox_id", sa.String(36), primary_key=True),
        sa.Column("event_id", sa.String(36), nullable=False),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("publish_attempts", sa.Integer(), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
    )
    for name, columns in (
        ("ix_outbox_events_event_id", ["event_id"]),
        ("ix_outbox_events_event_type", ["event_type"]),
        ("ix_outbox_events_published_at", ["published_at"]),
    ):
        op.create_index(name, "outbox_events", columns)


def _create_worker_state() -> None:
    op.create_table(
        "worker_state",
        sa.Column("worker_id", sa.String(128), primary_key=True),
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_worker_state_last_heartbeat_at", "worker_state", ["last_heartbeat_at"]
    )


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "observations" not in tables:
        # This repository predates Alembic. A clean installation needs the full
        # baseline, while an older create_all database follows the additive path.
        Base.metadata.create_all(bind=bind)
        return

    observation_columns = {
        column["name"] for column in inspector.get_columns("observations")
    }
    if "network_context" not in observation_columns:
        op.add_column(
            "observations", sa.Column("network_context", sa.JSON(), nullable=True)
        )
    if "ingestion_jobs" not in tables:
        _create_ingestion_jobs()
    if "outbox_events" not in tables:
        _create_outbox()
    if "worker_state" not in tables:
        _create_worker_state()


def downgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    for table in ("worker_state", "outbox_events", "ingestion_jobs"):
        if table in tables:
            op.drop_table(table)
    if "observations" in tables:
        columns = {
            column["name"] for column in sa.inspect(bind).get_columns("observations")
        }
        if "network_context" in columns:
            op.drop_column("observations", "network_context")
