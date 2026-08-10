"""Add recoverable delivery leases and retry scheduling to the outbox."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260810_04"
down_revision: str | None = "20260807_03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("outbox_events")}
    indexes = {index["name"] for index in inspector.get_indexes("outbox_events")}
    additions = (
        ("claim_token", sa.Column("claim_token", sa.String(36), nullable=True)),
        (
            "claim_expires_at",
            sa.Column("claim_expires_at", sa.DateTime(timezone=True), nullable=True),
        ),
        (
            "next_attempt_at",
            sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        ),
    )
    with op.batch_alter_table("outbox_events") as batch:
        for name, column in additions:
            if name not in columns:
                batch.add_column(column)
        if "ix_outbox_events_delivery_claim" not in indexes:
            batch.create_index(
                "ix_outbox_events_delivery_claim",
                [
                    "published_at",
                    "next_attempt_at",
                    "claim_expires_at",
                    "created_at",
                ],
            )


def downgrade() -> None:
    with op.batch_alter_table("outbox_events") as batch:
        batch.drop_index("ix_outbox_events_delivery_claim")
        batch.drop_column("next_attempt_at")
        batch.drop_column("claim_expires_at")
        batch.drop_column("claim_token")
