"""add authored recipe instruction titles

Revision ID: 20260830_0025
Revises: 20260830_0024
Create Date: 2026-08-30 23:10:00.000000

"""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260830_0025"
down_revision: str | None = "20260830_0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("recipe_draft_instructions", "recipe_version_instructions")

# These deterministic IDs belong to the reviewed demo snapshots. Every other
# historical instruction remains untitled and receives the UI's honest "Step N"
# fallback rather than a title inferred from prose.
_REVIEWED_TITLES: tuple[tuple[UUID, str], ...] = (
    (
        UUID("513f752b-d273-5a21-9661-ea36bcfb7f55"),
        "Make the batter",
    ),
    (
        UUID("9d7c608c-1afd-5273-b267-ca9e04ab6fdf"),
        "Rest the batter and heat the skillet",
    ),
    (
        UUID("fb3030b2-2932-5453-8153-db23ac3b09ee"),
        "Cook the pancakes",
    ),
    (
        UUID("95b03a60-0c3b-5f54-9061-a2c23182b6f1"),
        "Make the batter",
    ),
    (
        UUID("1224a84e-2f46-55a5-a467-47b24b6babaa"),
        "Rest and fold in the blueberries",
    ),
    (
        UUID("aca183ce-b8e7-5a1c-ac01-bbbdd805903f"),
        "Cook the pancakes",
    ),
)


def upgrade() -> None:
    for table_name in _TABLES:
        op.add_column(table_name, sa.Column("title", sa.String(length=200), nullable=True))
        op.create_check_constraint(
            op.f(f"ck_{table_name}_title_valid"),
            table_name,
            "title IS NULL OR (NULLIF(btrim(title), '') IS NOT NULL AND char_length(title) <= 200)",
        )

    # This is a one-time, reviewed enrichment of deterministic demo snapshots. The
    # published-row guard must be paused because the title column did not exist when
    # those snapshots were created. Application writes remain guarded before and after
    # this transaction.
    op.execute(
        "ALTER TABLE recipe_version_instructions DISABLE TRIGGER "
        "recipe_version_instructions_published_immutable"
    )
    connection = op.get_bind()
    public_instructions = sa.table(
        "recipe_version_instructions",
        sa.column("id", sa.Uuid()),
        sa.column("title", sa.String(length=200)),
    )
    for instruction_id, title in _REVIEWED_TITLES:
        connection.execute(
            public_instructions.update()
            .where(public_instructions.c.id == instruction_id)
            .values(title=title)
        )
    op.execute(
        "ALTER TABLE recipe_version_instructions ENABLE TRIGGER "
        "recipe_version_instructions_published_immutable"
    )


def downgrade() -> None:
    for table_name in reversed(_TABLES):
        op.drop_constraint(
            op.f(f"ck_{table_name}_title_valid"),
            table_name,
            type_="check",
        )
        op.drop_column(table_name, "title")
