"""add public recipe profile identities and saved-library index

Revision ID: 20260826_0015
Revises: 20260825_0014
Create Date: 2026-08-26 00:15:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260826_0015"
down_revision: str | None = "20260825_0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CATALOG_AUTHOR_ID = "16746db2-8776-5937-856c-252b72442671"
CATALOG_AUTHOR_HANDLE = "recipe-lab-catalog"
SAVED_LIBRARY_INDEX = "ix_recipe_saves_user_created_recipe"


def upgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        sa.text("UPDATE users SET handle = :handle WHERE id = CAST(:id AS uuid)").bindparams(
            handle=CATALOG_AUTHOR_HANDLE,
            id=CATALOG_AUTHOR_ID,
        )
    )
    op.execute(
        f"CREATE INDEX {SAVED_LIBRARY_INDEX} "
        "ON recipe_saves (user_id, created_at DESC, recipe_version_id)"
    )


def downgrade() -> None:
    op.drop_index(SAVED_LIBRARY_INDEX, table_name="recipe_saves")
    connection = op.get_bind()
    connection.execute(
        sa.text(
            "UPDATE users SET handle = NULL WHERE id = CAST(:id AS uuid) AND handle = :handle"
        ).bindparams(
            id=CATALOG_AUTHOR_ID,
            handle=CATALOG_AUTHOR_HANDLE,
        )
    )
