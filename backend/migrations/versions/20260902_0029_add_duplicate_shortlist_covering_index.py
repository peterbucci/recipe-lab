"""add duplicate shortlist covering index

Revision ID: 20260902_0029
Revises: 20260902_0028
Create Date: 2026-09-02 21:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260902_0029"
down_revision: str | None = "20260902_0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE_NAME = "recipe_version_ingredients"
_LEGACY_INDEX = "ix_recipe_version_ingredients_ingredient_id"
_COVERING_INDEX = "ix_recipe_version_ingredients_ingredient_version"


def upgrade() -> None:
    op.drop_index(_LEGACY_INDEX, table_name=_TABLE_NAME)
    op.create_index(
        _COVERING_INDEX,
        _TABLE_NAME,
        ["ingredient_id", "recipe_version_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(_COVERING_INDEX, table_name=_TABLE_NAME)
    op.create_index(
        _LEGACY_INDEX,
        _TABLE_NAME,
        ["ingredient_id"],
        unique=False,
    )
