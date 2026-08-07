"""Add ingestion operations metadata and immutable transition history."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260807_02"
down_revision: str | None = "20260807_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    job_columns = {column["name"] for column in inspector.get_columns("ingestion_jobs")}
    job_indexes = {index["name"] for index in inspector.get_indexes("ingestion_jobs")}
    additions = (
        ("error_code", sa.Column("error_code", sa.String(64), nullable=True)),
        ("retryable", sa.Column("retryable", sa.Boolean(), nullable=True)),
        (
            "redrive_count",
            sa.Column("redrive_count", sa.Integer(), nullable=False, server_default="0"),
        ),
        (
            "last_redriven_at",
            sa.Column("last_redriven_at", sa.DateTime(timezone=True), nullable=True),
        ),
        (
            "last_redriven_by",
            sa.Column("last_redriven_by", sa.String(128), nullable=True),
        ),
        ("last_redrive_reason", sa.Column("last_redrive_reason", sa.Text(), nullable=True)),
    )
    with op.batch_alter_table("ingestion_jobs") as batch:
        for name, column in additions:
            if name not in job_columns:
                batch.add_column(column)
        if "ix_ingestion_jobs_error_code" not in job_indexes:
            batch.create_index("ix_ingestion_jobs_error_code", ["error_code"])
        if "ix_ingestion_jobs_retryable" not in job_indexes:
            batch.create_index("ix_ingestion_jobs_retryable", ["retryable"])

    if "ingestion_job_transitions" not in inspector.get_table_names():
        op.create_table(
            "ingestion_job_transitions",
            sa.Column("transition_id", sa.String(36), primary_key=True),
            sa.Column(
                "job_id",
                sa.String(36),
                sa.ForeignKey("ingestion_jobs.job_id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("event_id", sa.String(36), nullable=False),
            sa.Column("from_state", sa.String(24), nullable=True),
            sa.Column("to_state", sa.String(24), nullable=False),
            sa.Column("reason_code", sa.String(64), nullable=False),
            sa.Column("error_code", sa.String(64), nullable=True),
            sa.Column("retryable", sa.Boolean(), nullable=True),
            sa.Column("worker_id", sa.String(128), nullable=True),
            sa.Column("operator", sa.String(128), nullable=True),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("details", sa.JSON(), nullable=False),
            sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        )
        for name, columns in (
            ("ix_ingestion_job_transitions_job_id", ["job_id"]),
            ("ix_ingestion_job_transitions_event_id", ["event_id"]),
            ("ix_ingestion_job_transitions_to_state", ["to_state"]),
            ("ix_ingestion_job_transitions_occurred_at", ["occurred_at"]),
        ):
            op.create_index(name, "ingestion_job_transitions", columns)


def downgrade() -> None:
    op.drop_table("ingestion_job_transitions")
    with op.batch_alter_table("ingestion_jobs") as batch:
        batch.drop_index("ix_ingestion_jobs_retryable")
        batch.drop_index("ix_ingestion_jobs_error_code")
        batch.drop_column("last_redrive_reason")
        batch.drop_column("last_redriven_by")
        batch.drop_column("last_redriven_at")
        batch.drop_column("redrive_count")
        batch.drop_column("retryable")
        batch.drop_column("error_code")
