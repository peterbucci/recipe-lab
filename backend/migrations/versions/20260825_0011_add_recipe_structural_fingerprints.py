"""add versioned recipe structural fingerprints

Revision ID: 20260825_0011
Revises: 20260824_0010
Create Date: 2026-08-25 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.orm import Session

from app.services.recipe_fingerprint_persistence import (
    backfill_all_recipe_structural_fingerprints,
)

revision: str = "20260825_0011"
down_revision: str | None = "20260824_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _create_fingerprint_table() -> None:
    op.create_table(
        "recipe_structural_fingerprints",
        sa.Column("recipe_version_id", sa.Uuid(), nullable=False),
        sa.Column("algorithm_version", sa.String(length=64), nullable=False),
        sa.Column("digest", sa.String(length=64), nullable=False),
        sa.Column("canonical_payload", sa.Text(), nullable=False),
        sa.CheckConstraint(
            "algorithm_version ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'",
            name=op.f("ck_recipe_structural_fingerprints_algorithm_version_format"),
        ),
        sa.CheckConstraint(
            "digest ~ '^[0-9a-f]{64}$'",
            name=op.f("ck_recipe_structural_fingerprints_digest_lowercase_sha256"),
        ),
        sa.CheckConstraint(
            "btrim(canonical_payload) <> ''",
            name=op.f("ck_recipe_structural_fingerprints_canonical_payload_not_blank"),
        ),
        sa.ForeignKeyConstraint(
            ["recipe_version_id"],
            ["recipe_versions.id"],
            name=op.f("fk_recipe_structural_fingerprints_recipe_version_id_recipe_versions"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "recipe_version_id",
            "algorithm_version",
            name=op.f("pk_recipe_structural_fingerprints"),
        ),
    )
    op.create_index(
        "ix_recipe_structural_fingerprints_algorithm_digest",
        "recipe_structural_fingerprints",
        ["algorithm_version", "digest"],
        unique=False,
    )


def upgrade() -> None:
    _create_fingerprint_table()
    connection = op.get_bind()
    with (
        Session(
            bind=connection,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        ) as session,
        session.begin(),
    ):
        backfill_all_recipe_structural_fingerprints(session)


def downgrade() -> None:
    op.drop_index(
        "ix_recipe_structural_fingerprints_algorithm_digest",
        table_name="recipe_structural_fingerprints",
    )
    op.drop_table("recipe_structural_fingerprints")
