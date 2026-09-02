"""add member activity read indexes

Revision ID: 20260902_0027
Revises: 20260901_0026
Create Date: 2026-09-02 18:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260902_0027"
down_revision: str | None = "20260901_0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index(
        "ix_recipe_version_publications_actor_published",
        table_name="recipe_version_publications",
    )
    op.create_index(
        "ix_recipe_version_publications_actor_published",
        "recipe_version_publications",
        ["actor_user_id", "published_at", "recipe_version_id"],
        unique=False,
    )
    op.create_index(
        "ix_ingredient_catalog_requests_requester_reviewed_id",
        "ingredient_catalog_requests",
        ["requester_user_id", "reviewed_at", "id"],
        unique=False,
        postgresql_where=sa.text("reviewed_at IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_ingredient_catalog_requests_requester_reviewed_id",
        table_name="ingredient_catalog_requests",
    )
    op.drop_index(
        "ix_recipe_version_publications_actor_published",
        table_name="recipe_version_publications",
    )
    op.create_index(
        "ix_recipe_version_publications_actor_published",
        "recipe_version_publications",
        ["actor_user_id", "published_at"],
        unique=False,
    )
