"""bind private draft creation to one member-scoped action

Revision ID: 20260828_0020
Revises: 20260827_0019
Create Date: 2026-08-28 16:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260828_0020"
down_revision: str | None = "20260827_0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(
        op.f("ck_recipe_drafts_status_supported"),
        "recipe_drafts",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_recipe_drafts_status_supported"),
        "recipe_drafts",
        "status IN ('active', 'discarded', 'published')",
    )
    op.add_column(
        "recipe_drafts",
        sa.Column("creation_action_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "recipe_drafts",
        sa.Column(
            "creation_request_fingerprint",
            sa.String(length=64),
            nullable=True,
        ),
    )
    op.create_check_constraint(
        op.f("ck_recipe_drafts_creation_evidence_shape_valid"),
        "recipe_drafts",
        "(creation_action_id IS NULL AND creation_request_fingerprint IS NULL) OR "
        "(creation_action_id IS NOT NULL AND creation_request_fingerprint IS NOT NULL)",
    )
    op.create_check_constraint(
        op.f("ck_recipe_drafts_creation_request_fingerprint_sha256"),
        "recipe_drafts",
        "creation_request_fingerprint IS NULL OR creation_request_fingerprint ~ '^[0-9a-f]{64}$'",
    )
    op.create_unique_constraint(
        "uq_recipe_drafts_author_creation_action",
        "recipe_drafts",
        ["author_user_id", "creation_action_id"],
    )


def downgrade() -> None:
    # Before this revision, discarding a draft deleted its row. The new
    # discarded rows contain no recipe content, so removing them restores the
    # old data contract and keeps a normal deployment rollback possible.
    op.execute("DELETE FROM recipe_drafts WHERE status = 'discarded'")
    op.drop_constraint(
        "uq_recipe_drafts_author_creation_action",
        "recipe_drafts",
        type_="unique",
    )
    op.drop_constraint(
        op.f("ck_recipe_drafts_creation_request_fingerprint_sha256"),
        "recipe_drafts",
        type_="check",
    )
    op.drop_constraint(
        op.f("ck_recipe_drafts_creation_evidence_shape_valid"),
        "recipe_drafts",
        type_="check",
    )
    op.drop_column("recipe_drafts", "creation_request_fingerprint")
    op.drop_column("recipe_drafts", "creation_action_id")
    op.drop_constraint(
        op.f("ck_recipe_drafts_status_supported"),
        "recipe_drafts",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_recipe_drafts_status_supported"),
        "recipe_drafts",
        "status IN ('active', 'published')",
    )
