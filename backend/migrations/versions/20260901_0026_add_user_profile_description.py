"""add public cook profile descriptions

Revision ID: 20260901_0026
Revises: 20260830_0025
Create Date: 2026-09-01 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260901_0026"
down_revision: str | None = "20260830_0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _create_lifecycle_constraint(*, include_profile_description: bool) -> None:
    profile_shape = "AND profile_description IS NULL " if include_profile_description else ""
    op.create_check_constraint(
        op.f("ck_users_lifecycle_shape_valid"),
        "users",
        "(status = 'deleted' AND account_kind = 'member' "
        "AND email IS NULL AND handle IS NULL "
        f"AND display_name = 'Deleted cook' {profile_shape}"
        "AND deleted_at IS NOT NULL) OR "
        "((status <> 'deleted' OR account_kind <> 'member') "
        "AND email IS NOT NULL AND deleted_at IS NULL)",
    )


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("profile_description", sa.String(length=500), nullable=True),
    )
    op.create_check_constraint(
        op.f("ck_users_profile_description_valid"),
        "users",
        "profile_description IS NULL OR ("
        "char_length(profile_description) <= 500 "
        "AND profile_description ~ '[^[:space:]]'"
        ")",
    )
    op.drop_constraint(
        op.f("ck_users_lifecycle_shape_valid"),
        "users",
        type_="check",
    )
    _create_lifecycle_constraint(include_profile_description=True)


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_users_lifecycle_shape_valid"),
        "users",
        type_="check",
    )
    op.drop_constraint(
        op.f("ck_users_profile_description_valid"),
        "users",
        type_="check",
    )
    op.drop_column("users", "profile_description")
    _create_lifecycle_constraint(include_profile_description=False)
