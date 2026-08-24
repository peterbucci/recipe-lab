"""allow authored recipe ingredients without catalog identities

Revision ID: 20260824_0007
Revises: 20260823_0006
Create Date: 2026-08-24 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260824_0007"
down_revision: str | None = "20260823_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "recipe_version_ingredients",
        "ingredient_id",
        existing_type=sa.Uuid(),
        nullable=True,
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM recipe_version_ingredients
                    WHERE ingredient_id IS NULL
                ) THEN
                    RAISE EXCEPTION
                        'Cannot downgrade while unlinked recipe ingredients exist.';
                END IF;
            END
            $$
            """
        )
    )
    op.alter_column(
        "recipe_version_ingredients",
        "ingredient_id",
        existing_type=sa.Uuid(),
        nullable=False,
    )
