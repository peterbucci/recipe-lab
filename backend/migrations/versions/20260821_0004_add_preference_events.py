"""add preference events

Revision ID: 20260821_0004
Revises: 20260820_0003
Create Date: 2026-08-21 16:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260821_0004"
down_revision: str | None = "20260820_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "preference_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("recipe_version_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(length=16), nullable=False),
        sa.Column("saved_value", sa.Boolean(), nullable=True),
        sa.Column("rating_value", sa.SmallInteger(), nullable=True),
        sa.Column("related_recipe_version_id", sa.Uuid(), nullable=True),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=True),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            """
            (
                event_type = 'view'
                AND saved_value IS NULL
                AND rating_value IS NULL
                AND related_recipe_version_id IS NULL
                AND request_fingerprint IS NULL
            )
            OR (
                event_type = 'save'
                AND saved_value IS NOT NULL
                AND rating_value IS NULL
                AND related_recipe_version_id IS NULL
                AND request_fingerprint IS NULL
            )
            OR (
                event_type = 'rating'
                AND saved_value IS NULL
                AND rating_value IS NOT NULL
                AND related_recipe_version_id IS NULL
                AND request_fingerprint IS NULL
            )
            OR (
                event_type = 'fork'
                AND saved_value IS NULL
                AND rating_value IS NULL
                AND related_recipe_version_id IS NOT NULL
                AND request_fingerprint IS NOT NULL
            )
            """,
            name=op.f("ck_preference_events_context_matches_event_type"),
        ),
        sa.CheckConstraint(
            "event_type IN ('view', 'save', 'rating', 'fork')",
            name=op.f("ck_preference_events_event_type_supported"),
        ),
        sa.CheckConstraint(
            "rating_value IS NULL OR rating_value BETWEEN 1 AND 5",
            name=op.f("ck_preference_events_rating_value_supported_range"),
        ),
        sa.CheckConstraint(
            "related_recipe_version_id IS NULL OR related_recipe_version_id <> recipe_version_id",
            name=op.f("ck_preference_events_related_recipe_version_differs"),
        ),
        sa.CheckConstraint(
            "request_fingerprint IS NULL OR request_fingerprint ~ '^[0-9a-f]{64}$'",
            name=op.f("ck_preference_events_request_fingerprint_lowercase_sha256"),
        ),
        sa.ForeignKeyConstraint(
            ["recipe_version_id"],
            ["recipe_versions.id"],
            name=op.f("fk_preference_events_recipe_version_id_recipe_versions"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["related_recipe_version_id"],
            ["recipe_versions.id"],
            name=op.f("fk_preference_events_related_recipe_version_id_recipe_versions"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_preference_events_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_preference_events")),
        sa.UniqueConstraint(
            "related_recipe_version_id",
            name="uq_preference_events_related_recipe_version_id",
        ),
    )
    op.create_index(
        "ix_preference_events_recipe_version_type_occurred_id",
        "preference_events",
        ["recipe_version_id", "event_type", "occurred_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_preference_events_user_type_occurred_id",
        "preference_events",
        ["user_id", "event_type", "occurred_at", "id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_preference_events_user_type_occurred_id",
        table_name="preference_events",
    )
    op.drop_index(
        "ix_preference_events_recipe_version_type_occurred_id",
        table_name="preference_events",
    )
    op.drop_table("preference_events")
