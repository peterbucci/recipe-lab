"""create core schema

Revision ID: 20260820_0001
Revises:
Create Date: 2026-08-20 18:17:20.940529

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260820_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "btrim(display_name) <> ''", name=op.f("ck_users_display_name_not_blank")
        ),
        sa.CheckConstraint("btrim(email) <> ''", name=op.f("ck_users_email_not_blank")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("email", name=op.f("uq_users_email")),
    )
    op.create_table(
        "recipe_lineages",
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            name=op.f("fk_recipe_lineages_created_by_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_recipe_lineages")),
    )
    op.create_index(
        op.f("ix_recipe_lineages_created_by_user_id"),
        "recipe_lineages",
        ["created_by_user_id"],
        unique=False,
    )
    op.create_table(
        "recipe_versions",
        sa.Column("lineage_id", sa.Uuid(), nullable=False),
        sa.Column("parent_version_id", sa.Uuid(), nullable=True),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("servings", sa.Numeric(precision=8, scale=2), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("btrim(title) <> ''", name=op.f("ck_recipe_versions_title_not_blank")),
        sa.CheckConstraint(
            "parent_version_id IS NULL OR parent_version_id <> id",
            name=op.f("ck_recipe_versions_parent_not_self"),
        ),
        sa.CheckConstraint("servings > 0", name=op.f("ck_recipe_versions_servings_positive")),
        sa.CheckConstraint(
            "version_number >= 1", name=op.f("ck_recipe_versions_version_number_positive")
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            name=op.f("fk_recipe_versions_created_by_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["lineage_id", "parent_version_id"],
            ["recipe_versions.lineage_id", "recipe_versions.id"],
            name="fk_recipe_versions_parent_same_lineage",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["lineage_id"],
            ["recipe_lineages.id"],
            name=op.f("fk_recipe_versions_lineage_id_recipe_lineages"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_recipe_versions")),
        sa.UniqueConstraint("lineage_id", "id", name="uq_recipe_versions_lineage_id_id"),
        sa.UniqueConstraint(
            "lineage_id", "version_number", name="uq_recipe_versions_lineage_id_version_number"
        ),
    )
    op.create_index(
        op.f("ix_recipe_versions_created_by_user_id"),
        "recipe_versions",
        ["created_by_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_recipe_versions_parent_version_id",
        "recipe_versions",
        ["parent_version_id"],
        unique=False,
    )
    op.create_index(
        "uq_recipe_versions_one_root_per_lineage",
        "recipe_versions",
        ["lineage_id"],
        unique=True,
        postgresql_where=sa.text("parent_version_id IS NULL"),
    )
    op.create_table(
        "recipe_ratings",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("recipe_version_id", sa.Uuid(), nullable=False),
        sa.Column("rating", sa.SmallInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "rating BETWEEN 1 AND 5", name=op.f("ck_recipe_ratings_rating_supported_range")
        ),
        sa.ForeignKeyConstraint(
            ["recipe_version_id"],
            ["recipe_versions.id"],
            name=op.f("fk_recipe_ratings_recipe_version_id_recipe_versions"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_recipe_ratings_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "recipe_version_id", name=op.f("pk_recipe_ratings")),
    )
    op.create_index(
        "ix_recipe_ratings_recipe_version_id", "recipe_ratings", ["recipe_version_id"], unique=False
    )
    op.create_table(
        "recipe_saves",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("recipe_version_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["recipe_version_id"],
            ["recipe_versions.id"],
            name=op.f("fk_recipe_saves_recipe_version_id_recipe_versions"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_recipe_saves_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "recipe_version_id", name=op.f("pk_recipe_saves")),
    )
    op.create_index(
        "ix_recipe_saves_recipe_version_id", "recipe_saves", ["recipe_version_id"], unique=False
    )
    op.create_table(
        "recipe_version_ingredients",
        sa.Column("recipe_version_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("quantity", sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column("unit", sa.String(length=64), nullable=True),
        sa.Column("preparation_notes", sa.Text(), nullable=True),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            "btrim(name) <> ''", name=op.f("ck_recipe_version_ingredients_name_not_blank")
        ),
        sa.CheckConstraint(
            "display_order >= 0",
            name=op.f("ck_recipe_version_ingredients_display_order_nonnegative"),
        ),
        sa.CheckConstraint(
            "quantity IS NULL OR quantity > 0",
            name=op.f("ck_recipe_version_ingredients_quantity_positive"),
        ),
        sa.ForeignKeyConstraint(
            ["recipe_version_id"],
            ["recipe_versions.id"],
            name=op.f("fk_recipe_version_ingredients_recipe_version_id_recipe_versions"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_recipe_version_ingredients")),
        sa.UniqueConstraint(
            "recipe_version_id",
            "display_order",
            name="uq_recipe_version_ingredients_version_display_order",
        ),
    )
    op.create_table(
        "recipe_version_instructions",
        sa.Column("recipe_version_id", sa.Uuid(), nullable=False),
        sa.Column("instruction", sa.Text(), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            "btrim(instruction) <> ''",
            name=op.f("ck_recipe_version_instructions_instruction_not_blank"),
        ),
        sa.CheckConstraint(
            "display_order >= 0",
            name=op.f("ck_recipe_version_instructions_display_order_nonnegative"),
        ),
        sa.ForeignKeyConstraint(
            ["recipe_version_id"],
            ["recipe_versions.id"],
            name=op.f("fk_recipe_version_instructions_recipe_version_id_recipe_versions"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_recipe_version_instructions")),
        sa.UniqueConstraint(
            "recipe_version_id",
            "display_order",
            name="uq_recipe_version_instructions_version_display_order",
        ),
    )


def downgrade() -> None:
    op.drop_table("recipe_version_instructions")
    op.drop_table("recipe_version_ingredients")
    op.drop_index("ix_recipe_saves_recipe_version_id", table_name="recipe_saves")
    op.drop_table("recipe_saves")
    op.drop_index("ix_recipe_ratings_recipe_version_id", table_name="recipe_ratings")
    op.drop_table("recipe_ratings")
    op.drop_index(
        "uq_recipe_versions_one_root_per_lineage",
        table_name="recipe_versions",
        postgresql_where=sa.text("parent_version_id IS NULL"),
    )
    op.drop_index("ix_recipe_versions_parent_version_id", table_name="recipe_versions")
    op.drop_index(op.f("ix_recipe_versions_created_by_user_id"), table_name="recipe_versions")
    op.drop_table("recipe_versions")
    op.drop_index(op.f("ix_recipe_lineages_created_by_user_id"), table_name="recipe_lineages")
    op.drop_table("recipe_lineages")
    op.drop_table("users")
