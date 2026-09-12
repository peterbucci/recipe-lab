"""add following read index

Revision ID: 20260911_0031
Revises: 20260902_0030
Create Date: 2026-09-11 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260911_0031"
down_revision: str | None = "20260902_0030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_FOLLOWING_READ_INDEX = "ix_user_follows_follower_created_followed"


def upgrade() -> None:
    op.create_index(
        _FOLLOWING_READ_INDEX,
        "user_follows",
        ["follower_user_id", sa.text("created_at DESC"), "followed_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(_FOLLOWING_READ_INDEX, table_name="user_follows")
