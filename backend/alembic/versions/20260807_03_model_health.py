"""Add server-assigned ingestion identity and model-health evidence."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260807_03"
down_revision: str | None = "20260807_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    observation_columns = {
        column["name"] for column in inspector.get_columns("observations")
    }
    observation_indexes = {
        index["name"] for index in inspector.get_indexes("observations")
    }
    with op.batch_alter_table("observations") as batch:
        if "ingestion_channel" not in observation_columns:
            batch.add_column(
                sa.Column(
                    "ingestion_channel",
                    sa.String(32),
                    nullable=False,
                    server_default="direct_prediction",
                )
            )
        if "extractor_fingerprint" not in observation_columns:
            batch.add_column(sa.Column("extractor_fingerprint", sa.String(64), nullable=True))
        if "ix_observations_ingestion_channel" not in observation_indexes:
            batch.create_index("ix_observations_ingestion_channel", ["ingestion_channel"])
        if "ix_observations_extractor_fingerprint" not in observation_indexes:
            batch.create_index("ix_observations_extractor_fingerprint", ["extractor_fingerprint"])
    job_columns = {column["name"] for column in inspector.get_columns("ingestion_jobs")}
    job_indexes = {index["name"] for index in inspector.get_indexes("ingestion_jobs")}
    with op.batch_alter_table("ingestion_jobs") as batch:
        if "ingestion_channel" not in job_columns:
            batch.add_column(
                sa.Column(
                    "ingestion_channel",
                    sa.String(32),
                    nullable=False,
                    server_default="http_ingestion",
                )
            )
        if "ix_ingestion_jobs_ingestion_channel" not in job_indexes:
            batch.create_index("ix_ingestion_jobs_ingestion_channel", ["ingestion_channel"])

    if "drift_snapshots" not in tables:
        op.create_table(
        "drift_snapshots",
        sa.Column("snapshot_id", sa.String(36), primary_key=True),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("window", sa.String(16), nullable=False),
        sa.Column("cohort_key", sa.String(512), nullable=False),
        sa.Column("cohort", sa.JSON(), nullable=False),
        sa.Column("reference", sa.JSON(), nullable=False),
        sa.Column("observation_count", sa.Integer(), nullable=False),
        sa.Column("aggregate_score", sa.Float(), nullable=True),
        sa.Column("aggregate_threshold", sa.Float(), nullable=True),
        sa.Column("evidence", sa.JSON(), nullable=False),
        sa.Column("deployment_eligible", sa.Boolean(), nullable=False),
        sa.Column("shadow_mode", sa.Boolean(), nullable=False),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False),
    )
        for name, columns in (
            ("ix_drift_snapshots_status", ["status"]),
            ("ix_drift_snapshots_window", ["window"]),
            ("ix_drift_snapshots_cohort_key", ["cohort_key"]),
            ("ix_drift_snapshots_deployment_eligible", ["deployment_eligible"]),
            ("ix_drift_snapshots_checked_at", ["checked_at"]),
        ):
            op.create_index(name, "drift_snapshots", columns)

    if "validation_failures" not in tables:
        op.create_table(
        "validation_failures",
        sa.Column("failure_id", sa.String(36), primary_key=True),
        sa.Column("error_code", sa.String(64), nullable=False),
        sa.Column("ingestion_channel", sa.String(32), nullable=False),
        sa.Column("schema_version", sa.String(64), nullable=True),
        sa.Column("extractor_fingerprint", sa.String(64), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
    )
        for name, columns in (
            ("ix_validation_failures_error_code", ["error_code"]),
            ("ix_validation_failures_ingestion_channel", ["ingestion_channel"]),
            ("ix_validation_failures_schema_version", ["schema_version"]),
            ("ix_validation_failures_extractor_fingerprint", ["extractor_fingerprint"]),
            ("ix_validation_failures_occurred_at", ["occurred_at"]),
        ):
            op.create_index(name, "validation_failures", columns)


def downgrade() -> None:
    op.drop_table("validation_failures")
    op.drop_table("drift_snapshots")
    with op.batch_alter_table("ingestion_jobs") as batch:
        batch.drop_index("ix_ingestion_jobs_ingestion_channel")
        batch.drop_column("ingestion_channel")
    with op.batch_alter_table("observations") as batch:
        batch.drop_index("ix_observations_extractor_fingerprint")
        batch.drop_index("ix_observations_ingestion_channel")
        batch.drop_column("extractor_fingerprint")
        batch.drop_column("ingestion_channel")
