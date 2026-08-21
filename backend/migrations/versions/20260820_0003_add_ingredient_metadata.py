"""add ingredient metadata

Revision ID: 20260820_0003
Revises: 20260820_0002
Create Date: 2026-08-20 20:16:27.618779

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260820_0003"
down_revision: str | None = "20260820_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "allergens",
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "btrim(name) <> ''",
            name=op.f("ck_allergens_name_not_blank"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_allergens")),
    )
    op.create_index(
        "uq_allergens_name_normalized",
        "allergens",
        [sa.literal_column("lower(btrim(name))")],
        unique=True,
    )
    op.create_table(
        "dietary_flags",
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "btrim(name) <> ''",
            name=op.f("ck_dietary_flags_name_not_blank"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_dietary_flags")),
    )
    op.create_index(
        "uq_dietary_flags_name_normalized",
        "dietary_flags",
        [sa.literal_column("lower(btrim(name))")],
        unique=True,
    )
    op.create_table(
        "ingredient_categories",
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "btrim(name) <> ''",
            name=op.f("ck_ingredient_categories_name_not_blank"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ingredient_categories")),
    )
    op.create_index(
        "uq_ingredient_categories_name_normalized",
        "ingredient_categories",
        [sa.literal_column("lower(btrim(name))")],
        unique=True,
    )
    op.create_table(
        "ingredients",
        sa.Column("canonical_name", sa.String(length=200), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "btrim(canonical_name) <> ''",
            name=op.f("ck_ingredients_canonical_name_not_blank"),
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["ingredient_categories.id"],
            name=op.f("fk_ingredients_category_id_ingredient_categories"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ingredients")),
    )
    op.create_index(
        op.f("ix_ingredients_category_id"),
        "ingredients",
        ["category_id"],
        unique=False,
    )
    op.create_index(
        "uq_ingredients_canonical_name_normalized",
        "ingredients",
        [sa.literal_column("lower(btrim(canonical_name))")],
        unique=True,
    )
    op.create_table(
        "ingredient_aliases",
        sa.Column("ingredient_id", sa.Uuid(), nullable=False),
        sa.Column("alias", sa.String(length=200), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "btrim(alias) <> ''",
            name=op.f("ck_ingredient_aliases_alias_not_blank"),
        ),
        sa.ForeignKeyConstraint(
            ["ingredient_id"],
            ["ingredients.id"],
            name=op.f("fk_ingredient_aliases_ingredient_id_ingredients"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ingredient_aliases")),
    )
    op.create_index(
        op.f("ix_ingredient_aliases_ingredient_id"),
        "ingredient_aliases",
        ["ingredient_id"],
        unique=False,
    )
    op.create_index(
        "uq_ingredient_aliases_alias_normalized",
        "ingredient_aliases",
        [sa.literal_column("lower(btrim(alias))")],
        unique=True,
    )
    op.create_table(
        "ingredient_allergens",
        sa.Column("ingredient_id", sa.Uuid(), nullable=False),
        sa.Column("allergen_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["allergen_id"],
            ["allergens.id"],
            name=op.f("fk_ingredient_allergens_allergen_id_allergens"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["ingredient_id"],
            ["ingredients.id"],
            name=op.f("fk_ingredient_allergens_ingredient_id_ingredients"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "ingredient_id",
            "allergen_id",
            name=op.f("pk_ingredient_allergens"),
        ),
    )
    op.create_index(
        "ix_ingredient_allergens_allergen_id",
        "ingredient_allergens",
        ["allergen_id"],
        unique=False,
    )
    op.create_table(
        "ingredient_dietary_flags",
        sa.Column("ingredient_id", sa.Uuid(), nullable=False),
        sa.Column("dietary_flag_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["dietary_flag_id"],
            ["dietary_flags.id"],
            name=op.f("fk_ingredient_dietary_flags_dietary_flag_id_dietary_flags"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["ingredient_id"],
            ["ingredients.id"],
            name=op.f("fk_ingredient_dietary_flags_ingredient_id_ingredients"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "ingredient_id",
            "dietary_flag_id",
            name=op.f("pk_ingredient_dietary_flags"),
        ),
    )
    op.create_index(
        "ix_ingredient_dietary_flags_dietary_flag_id",
        "ingredient_dietary_flags",
        ["dietary_flag_id"],
        unique=False,
    )
    op.create_table(
        "ingredient_substitutions",
        sa.Column("source_ingredient_id", sa.Uuid(), nullable=False),
        sa.Column("replacement_ingredient_id", sa.Uuid(), nullable=False),
        sa.Column("quantity_ratio", sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column("guidance", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("provenance", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Numeric(precision=5, scale=4), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "source_ingredient_id <> replacement_ingredient_id",
            name=op.f("ck_ingredient_substitutions_ingredients_must_differ"),
        ),
        sa.CheckConstraint(
            "quantity_ratio IS NULL OR quantity_ratio > 0",
            name=op.f("ck_ingredient_substitutions_quantity_ratio_positive"),
        ),
        sa.CheckConstraint(
            "confidence IS NULL OR confidence BETWEEN 0 AND 1",
            name=op.f("ck_ingredient_substitutions_confidence_supported_range"),
        ),
        sa.CheckConstraint(
            "quantity_ratio IS NOT NULL OR NULLIF(btrim(guidance), '') IS NOT NULL",
            name=op.f("ck_ingredient_substitutions_ratio_or_guidance_required"),
        ),
        sa.CheckConstraint(
            "NULLIF(btrim(provenance), '') IS NOT NULL OR confidence IS NOT NULL",
            name=op.f("ck_ingredient_substitutions_provenance_or_confidence_required"),
        ),
        sa.CheckConstraint(
            "guidance IS NULL OR btrim(guidance) <> ''",
            name=op.f("ck_ingredient_substitutions_guidance_not_blank"),
        ),
        sa.CheckConstraint(
            "notes IS NULL OR btrim(notes) <> ''",
            name=op.f("ck_ingredient_substitutions_notes_not_blank"),
        ),
        sa.CheckConstraint(
            "provenance IS NULL OR btrim(provenance) <> ''",
            name=op.f("ck_ingredient_substitutions_provenance_not_blank"),
        ),
        sa.ForeignKeyConstraint(
            ["replacement_ingredient_id"],
            ["ingredients.id"],
            name="fk_ingredient_substitutions_replacement_ingredient",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["source_ingredient_id"],
            ["ingredients.id"],
            name="fk_ingredient_substitutions_source_ingredient",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ingredient_substitutions")),
        sa.UniqueConstraint(
            "source_ingredient_id",
            "replacement_ingredient_id",
            name="uq_ingredient_substitutions_source_replacement",
        ),
    )
    op.create_index(
        "ix_ingredient_substitutions_replacement_ingredient_id",
        "ingredient_substitutions",
        ["replacement_ingredient_id"],
        unique=False,
    )

    # Existing authored names remain the display text. Each normalized legacy
    # name gets one conservative canonical identity; semantic aliases belong in
    # the separately reviewed seed catalog.
    op.add_column(
        "recipe_version_ingredients",
        sa.Column("ingredient_id", sa.Uuid(), nullable=True),
    )
    op.execute(
        sa.text(
            """
            INSERT INTO ingredients (id, canonical_name)
            SELECT gen_random_uuid(), min(btrim(name))
            FROM recipe_version_ingredients
            GROUP BY lower(btrim(name))
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE recipe_version_ingredients AS recipe_ingredient
            SET ingredient_id = ingredient.id
            FROM ingredients AS ingredient
            WHERE lower(btrim(recipe_ingredient.name)) =
                  lower(btrim(ingredient.canonical_name))
            """
        )
    )
    op.alter_column(
        "recipe_version_ingredients",
        "ingredient_id",
        existing_type=sa.Uuid(),
        nullable=False,
    )
    op.create_index(
        op.f("ix_recipe_version_ingredients_ingredient_id"),
        "recipe_version_ingredients",
        ["ingredient_id"],
        unique=False,
    )
    op.create_foreign_key(
        op.f("fk_recipe_version_ingredients_ingredient_id_ingredients"),
        "recipe_version_ingredients",
        "ingredients",
        ["ingredient_id"],
        ["id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_recipe_version_ingredients_ingredient_id_ingredients"),
        "recipe_version_ingredients",
        type_="foreignkey",
    )
    op.drop_index(
        op.f("ix_recipe_version_ingredients_ingredient_id"),
        table_name="recipe_version_ingredients",
    )
    op.drop_column("recipe_version_ingredients", "ingredient_id")

    op.drop_index(
        "ix_ingredient_substitutions_replacement_ingredient_id",
        table_name="ingredient_substitutions",
    )
    op.drop_table("ingredient_substitutions")
    op.drop_index(
        "ix_ingredient_dietary_flags_dietary_flag_id",
        table_name="ingredient_dietary_flags",
    )
    op.drop_table("ingredient_dietary_flags")
    op.drop_index(
        "ix_ingredient_allergens_allergen_id",
        table_name="ingredient_allergens",
    )
    op.drop_table("ingredient_allergens")
    op.drop_index(
        "uq_ingredient_aliases_alias_normalized",
        table_name="ingredient_aliases",
    )
    op.drop_index(
        op.f("ix_ingredient_aliases_ingredient_id"),
        table_name="ingredient_aliases",
    )
    op.drop_table("ingredient_aliases")
    op.drop_index(
        "uq_ingredients_canonical_name_normalized",
        table_name="ingredients",
    )
    op.drop_index(op.f("ix_ingredients_category_id"), table_name="ingredients")
    op.drop_table("ingredients")
    op.drop_index(
        "uq_ingredient_categories_name_normalized",
        table_name="ingredient_categories",
    )
    op.drop_table("ingredient_categories")
    op.drop_index(
        "uq_dietary_flags_name_normalized",
        table_name="dietary_flags",
    )
    op.drop_table("dietary_flags")
    op.drop_index(
        "uq_allergens_name_normalized",
        table_name="allergens",
    )
    op.drop_table("allergens")
