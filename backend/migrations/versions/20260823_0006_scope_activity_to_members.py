"""scope activity idempotency to members and operations

Revision ID: 20260823_0006
Revises: 20260823_0005
Create Date: 2026-08-23 19:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260823_0006"
down_revision: str | None = "20260823_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "preference_events",
        sa.Column("action_id", sa.Uuid(), nullable=True),
    )
    op.execute(sa.text("UPDATE preference_events SET action_id = id"))
    op.alter_column("preference_events", "action_id", nullable=False)
    op.create_unique_constraint(
        "uq_preference_events_user_operation_action",
        "preference_events",
        ["user_id", "event_type", "action_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_preference_events_user_operation_action",
        "preference_events",
        type_="unique",
    )
    op.drop_column("preference_events", "action_id")
