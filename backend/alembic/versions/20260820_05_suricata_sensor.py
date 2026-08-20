"""Add first-class Suricata sensor alerts and sensor health."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260820_05"
down_revision: str | None = "20260810_04"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    alert_columns = {column["name"]: column for column in inspector.get_columns("alerts")}
    nullable_changes = [
        name for name in ("event_id", "prediction_id")
        if name in alert_columns and not alert_columns[name]["nullable"]
    ]
    if nullable_changes:
        with op.batch_alter_table("alerts") as batch:
            for name in nullable_changes:
                batch.alter_column(name, existing_type=sa.String(36), nullable=True)

    # Additive ALTER TABLE statements avoid SQLite batch-rebuild ordering cycles
    # while remaining portable to PostgreSQL.
    for column in (
        sa.Column("detection_source", sa.String(32), nullable=False, server_default="ml_model"),
        sa.Column("external_event_id", sa.String(36), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sensor_id", sa.String(64), nullable=True),
        sa.Column("signature_id", sa.Integer(), nullable=True),
        sa.Column("signature", sa.Text(), nullable=True),
        sa.Column("category", sa.String(256), nullable=True),
        sa.Column("action", sa.String(64), nullable=True),
        sa.Column("network_context", sa.JSON(), nullable=True),
        sa.Column("sensor_evidence", sa.JSON(), nullable=True),
    ):
        if column.name not in alert_columns:
            op.add_column("alerts", column)
    existing_indexes = {index["name"] for index in inspector.get_indexes("alerts")}
    for name, columns, unique in (
        ("ix_alerts_detection_source", ["detection_source"], False),
        ("ix_alerts_external_event_id", ["external_event_id"], True),
        ("ix_alerts_occurred_at", ["occurred_at"], False),
        ("ix_alerts_sensor_id", ["sensor_id"], False),
        ("ix_alerts_signature_id", ["signature_id"], False),
    ):
        if name not in existing_indexes:
            op.create_index(name, "alerts", columns, unique=unique)

    if "sensor_states" not in inspector.get_table_names():
        op.create_table(
            "sensor_states",
            sa.Column("sensor_id", sa.String(64), primary_key=True),
            sa.Column("interface", sa.String(128), nullable=False),
            sa.Column("engine_version", sa.String(64), nullable=True),
            sa.Column("rule_count", sa.Integer(), nullable=True),
            sa.Column("packets", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("capture_drops", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("events_seen", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("alerts_accepted", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("last_event_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index(
            "ix_sensor_states_last_heartbeat_at",
            "sensor_states",
            ["last_heartbeat_at"],
        )


def downgrade() -> None:
    op.drop_index("ix_sensor_states_last_heartbeat_at", table_name="sensor_states")
    op.drop_table("sensor_states")
    with op.batch_alter_table("alerts") as batch:
        for name in (
            "ix_alerts_signature_id", "ix_alerts_sensor_id", "ix_alerts_occurred_at",
            "ix_alerts_external_event_id", "ix_alerts_detection_source",
        ):
            batch.drop_index(name)
        for name in (
            "sensor_evidence", "network_context", "action", "category", "signature",
            "signature_id", "sensor_id", "occurred_at", "external_event_id", "detection_source",
        ):
            batch.drop_column(name)
        batch.alter_column("prediction_id", existing_type=sa.String(36), nullable=False)
        batch.alter_column("event_id", existing_type=sa.String(36), nullable=False)
