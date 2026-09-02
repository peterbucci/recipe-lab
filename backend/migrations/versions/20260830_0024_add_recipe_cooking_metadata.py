"""add recipe cooking metadata

Revision ID: 20260830_0024
Revises: 20260830_0023
Create Date: 2026-08-30 22:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260830_0024"
down_revision: str | None = "20260830_0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("recipe_drafts", "recipe_versions")


def _add_columns(table_name: str) -> None:
    op.add_column(table_name, sa.Column("total_time_minutes", sa.Integer(), nullable=True))
    op.add_column(table_name, sa.Column("active_time_minutes", sa.Integer(), nullable=True))
    op.add_column(table_name, sa.Column("difficulty", sa.String(length=16), nullable=True))
    op.add_column(table_name, sa.Column("notes", sa.Text(), nullable=True))
    op.create_check_constraint(
        op.f(f"ck_{table_name}_total_time_minutes_positive"),
        table_name,
        "total_time_minutes IS NULL OR total_time_minutes > 0",
    )
    op.create_check_constraint(
        op.f(f"ck_{table_name}_active_time_minutes_positive"),
        table_name,
        "active_time_minutes IS NULL OR active_time_minutes > 0",
    )
    op.create_check_constraint(
        op.f(f"ck_{table_name}_active_time_not_greater_than_total"),
        table_name,
        "total_time_minutes IS NULL OR active_time_minutes IS NULL "
        "OR active_time_minutes <= total_time_minutes",
    )
    op.create_check_constraint(
        op.f(f"ck_{table_name}_difficulty_supported"),
        table_name,
        "difficulty IS NULL OR difficulty IN ('easy', 'medium', 'hard')",
    )
    op.create_check_constraint(
        op.f(f"ck_{table_name}_notes_valid"),
        table_name,
        "notes IS NULL OR (NULLIF(btrim(notes), '') IS NOT NULL AND char_length(notes) <= 5000)",
    )


def _drop_columns(table_name: str) -> None:
    for constraint in (
        "notes_valid",
        "difficulty_supported",
        "active_time_not_greater_than_total",
        "active_time_minutes_positive",
        "total_time_minutes_positive",
    ):
        op.drop_constraint(op.f(f"ck_{table_name}_{constraint}"), table_name, type_="check")
    op.drop_column(table_name, "notes")
    op.drop_column(table_name, "difficulty")
    op.drop_column(table_name, "active_time_minutes")
    op.drop_column(table_name, "total_time_minutes")


def upgrade() -> None:
    for table_name in _TABLES:
        _add_columns(table_name)


def downgrade() -> None:
    for table_name in reversed(_TABLES):
        _drop_columns(table_name)
