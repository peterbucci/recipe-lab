"""add high-growth read indexes

Revision ID: 20260902_0030
Revises: 20260902_0029
Create Date: 2026-09-02 22:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260902_0030"
down_revision: str | None = "20260902_0029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PUBLICATION_NEWEST_INDEX = "ix_recipe_version_publications_state_newest"
_MODERATION_QUEUE_INDEX = "ix_recipe_moderation_cases_status_reported"
_RECIPE_TITLE_SEARCH_INDEX = "ix_recipe_versions_title_trgm"
_RECIPE_DESCRIPTION_SEARCH_INDEX = "ix_recipe_versions_description_trgm"
_PREFERENCE_RECIPE_INDEX = "ix_preference_events_user_recipe_version"
_PREFERENCE_RELATED_INDEX = "ix_preference_events_user_related_recipe_version"
_RATING_PROFILE_INDEX = "ix_recipe_ratings_user_positive_profile"


def _qualified_pg_trgm_operator_class() -> str:
    bind = op.get_bind()
    extension_schema = bind.execute(
        sa.text(
            "SELECT namespace.nspname "
            "FROM pg_extension AS extension "
            "JOIN pg_namespace AS namespace ON namespace.oid = extension.extnamespace "
            "WHERE extension.extname = 'pg_trgm'"
        )
    ).scalar_one()
    quoted_schema = bind.dialect.identifier_preparer.quote(str(extension_schema))
    return f"{quoted_schema}.gin_trgm_ops"


def upgrade() -> None:
    # The browse contract promises literal case-insensitive substring matching.
    # Trigrams accelerate that exact contract without changing it to token search.
    op.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    trigram_operator_class = _qualified_pg_trgm_operator_class()
    op.create_index(
        _RECIPE_TITLE_SEARCH_INDEX,
        "recipe_versions",
        ["title"],
        unique=False,
        postgresql_using="gin",
        postgresql_ops={"title": trigram_operator_class},
    )
    op.create_index(
        _RECIPE_DESCRIPTION_SEARCH_INDEX,
        "recipe_versions",
        ["description"],
        unique=False,
        postgresql_using="gin",
        postgresql_ops={"description": trigram_operator_class},
    )
    op.create_index(
        _PUBLICATION_NEWEST_INDEX,
        "recipe_version_publications",
        ["state", sa.text("published_at DESC"), "recipe_version_id"],
        unique=False,
    )
    op.create_index(
        _MODERATION_QUEUE_INDEX,
        "recipe_moderation_cases",
        ["status", sa.text("last_reported_at DESC"), "recipe_version_id"],
        unique=False,
    )
    op.create_index(
        _PREFERENCE_RECIPE_INDEX,
        "preference_events",
        ["user_id", "recipe_version_id"],
        unique=False,
    )
    op.create_index(
        _PREFERENCE_RELATED_INDEX,
        "preference_events",
        ["user_id", "related_recipe_version_id"],
        unique=False,
        postgresql_where=sa.text("related_recipe_version_id IS NOT NULL"),
    )
    op.create_index(
        _RATING_PROFILE_INDEX,
        "recipe_ratings",
        [
            "user_id",
            sa.text("rating DESC"),
            sa.text("created_at DESC"),
            "recipe_version_id",
        ],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(_RATING_PROFILE_INDEX, table_name="recipe_ratings")
    op.drop_index(_PREFERENCE_RELATED_INDEX, table_name="preference_events")
    op.drop_index(_PREFERENCE_RECIPE_INDEX, table_name="preference_events")
    op.drop_index(_MODERATION_QUEUE_INDEX, table_name="recipe_moderation_cases")
    op.drop_index(_PUBLICATION_NEWEST_INDEX, table_name="recipe_version_publications")
    op.drop_index(_RECIPE_DESCRIPTION_SEARCH_INDEX, table_name="recipe_versions")
    op.drop_index(_RECIPE_TITLE_SEARCH_INDEX, table_name="recipe_versions")
    # pg_trgm is cluster-scoped and may be used outside this application schema.
    # A rollback therefore removes only the indexes owned by Recipe Lab.
