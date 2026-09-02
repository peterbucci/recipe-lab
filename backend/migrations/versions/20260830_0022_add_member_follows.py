"""add member follows

Revision ID: 20260830_0022
Revises: 20260830_0021
Create Date: 2026-08-30 17:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260830_0022"
down_revision: str | None = "20260830_0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_follows",
        sa.Column("follower_user_id", sa.Uuid(), nullable=False),
        sa.Column("followed_user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "follower_user_id <> followed_user_id",
            name=op.f("ck_user_follows_different_users"),
        ),
        sa.ForeignKeyConstraint(
            ["followed_user_id"],
            ["users.id"],
            name=op.f("fk_user_follows_followed_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["follower_user_id"],
            ["users.id"],
            name=op.f("fk_user_follows_follower_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "follower_user_id",
            "followed_user_id",
            name=op.f("pk_user_follows"),
        ),
    )
    op.create_index(
        "ix_user_follows_followed_created_follower",
        "user_follows",
        ["followed_user_id", "created_at", "follower_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_user_follows_followed_created_follower",
        table_name="user_follows",
    )
    op.drop_table("user_follows")
