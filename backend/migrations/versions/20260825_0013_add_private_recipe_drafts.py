"""add private persistent recipe drafts

Revision ID: 20260825_0013
Revises: 20260825_0012
Create Date: 2026-08-25 18:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260825_0013"
down_revision: str | None = "20260825_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _repair_legacy_package_identity_constraints() -> None:
    """Bring databases upgraded with an early 0009 build to the current contract.

    The reviewed 0009 migration and ORM use a composite package identity. Some
    developer databases ran an earlier 0009 build that kept only the package ID
    foreign key. Repairing that historical in-place revision drift here makes the
    next normal upgrade safe without weakening either published or draft rows.
    """

    op.execute(
        sa.text(
            """
            DO $$
            DECLARE
                legacy_constraint record;
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conrelid = 'ingredient_package_sizes'::regclass
                      AND contype = 'u'
                      AND pg_get_constraintdef(oid) =
                          'UNIQUE (id, ingredient_id, package_unit_id)'
                ) THEN
                    ALTER TABLE ingredient_package_sizes
                    ADD CONSTRAINT uq_ingredient_package_sizes_id_ingredient_unit
                    UNIQUE (id, ingredient_id, package_unit_id);
                END IF;

                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conrelid = 'recipe_version_ingredients'::regclass
                      AND contype = 'f'
                      AND pg_get_constraintdef(oid) LIKE
                          'FOREIGN KEY (package_size_id, ingredient_id, measurement_unit_id) %'
                ) THEN
                    ALTER TABLE recipe_version_ingredients
                    ADD CONSTRAINT
                        fk_recipe_version_ingredients_package_size_ingredient_unit
                    FOREIGN KEY (package_size_id, ingredient_id, measurement_unit_id)
                    REFERENCES ingredient_package_sizes
                        (id, ingredient_id, package_unit_id)
                    ON DELETE RESTRICT;
                END IF;

                FOR legacy_constraint IN
                    SELECT conname
                    FROM pg_constraint
                    WHERE conrelid = 'recipe_version_ingredients'::regclass
                      AND contype = 'f'
                      AND pg_get_constraintdef(oid) LIKE
                          'FOREIGN KEY (package_size_id) REFERENCES ingredient_package_sizes(id)%'
                LOOP
                    EXECUTE format(
                        'ALTER TABLE recipe_version_ingredients DROP CONSTRAINT %I',
                        legacy_constraint.conname
                    );
                END LOOP;
            END
            $$
            """
        )
    )


def upgrade() -> None:
    _repair_legacy_package_identity_constraints()
    op.create_table(
        "recipe_drafts",
        sa.Column("author_user_id", sa.Uuid(), nullable=False),
        sa.Column("source_version_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=16), server_default="active", nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("servings", sa.Numeric(precision=8, scale=2), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status = 'active'",
            name=op.f("ck_recipe_drafts_status_supported"),
        ),
        sa.CheckConstraint(
            "revision >= 1",
            name=op.f("ck_recipe_drafts_revision_positive"),
        ),
        sa.CheckConstraint(
            "char_length(title) <= 200",
            name=op.f("ck_recipe_drafts_title_bounded"),
        ),
        sa.CheckConstraint(
            "description IS NULL OR "
            "(NULLIF(btrim(description), '') IS NOT NULL "
            "AND char_length(description) <= 2000)",
            name=op.f("ck_recipe_drafts_description_valid"),
        ),
        sa.CheckConstraint(
            "servings IS NULL OR servings > 0",
            name=op.f("ck_recipe_drafts_servings_positive"),
        ),
        sa.ForeignKeyConstraint(
            ["author_user_id"],
            ["users.id"],
            name=op.f("fk_recipe_drafts_author_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["source_version_id"],
            ["recipe_versions.id"],
            name=op.f("fk_recipe_drafts_source_version_id_recipe_versions"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_recipe_drafts")),
        sa.UniqueConstraint(
            "id",
            "author_user_id",
            name="uq_recipe_drafts_id_author",
        ),
    )
    op.create_index(
        "ix_recipe_drafts_author_status_updated_id",
        "recipe_drafts",
        ["author_user_id", "status", "updated_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_recipe_drafts_source_version_id",
        "recipe_drafts",
        ["source_version_id"],
        unique=False,
    )

    op.create_table(
        "recipe_draft_ingredients",
        sa.Column("recipe_draft_id", sa.Uuid(), nullable=False),
        sa.Column("selection_kind", sa.String(length=16), nullable=False),
        sa.Column("ingredient_id", sa.Uuid(), nullable=True),
        sa.Column("ingredient_request_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=True),
        sa.Column("measure_mode", sa.String(length=16), nullable=False),
        sa.Column("quantity_min", sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column("quantity_max", sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column("measurement_unit_id", sa.Uuid(), nullable=True),
        sa.Column("unit_display", sa.String(length=64), nullable=True),
        sa.Column("package_size_id", sa.Uuid(), nullable=True),
        sa.Column("preparation_notes", sa.Text(), nullable=True),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            "selection_kind IN ('catalog', 'request')",
            name=op.f("ck_recipe_draft_ingredients_selection_kind_supported"),
        ),
        sa.CheckConstraint(
            "(selection_kind = 'catalog' AND ingredient_id IS NOT NULL "
            "AND ingredient_request_id IS NULL "
            "AND NULLIF(btrim(name), '') IS NOT NULL) OR "
            "(selection_kind = 'request' AND ingredient_id IS NULL "
            "AND ingredient_request_id IS NOT NULL AND name IS NULL)",
            name=op.f("ck_recipe_draft_ingredients_selection_shape_valid"),
        ),
        sa.CheckConstraint(
            "(measure_mode = 'exact' "
            "AND quantity_min IS NOT NULL AND quantity_min > 0 "
            "AND quantity_max IS NULL AND measurement_unit_id IS NOT NULL "
            "AND NULLIF(btrim(unit_display), '') IS NOT NULL) "
            "OR (measure_mode = 'range' "
            "AND quantity_min IS NOT NULL AND quantity_min > 0 "
            "AND quantity_max IS NOT NULL AND quantity_max > quantity_min "
            "AND measurement_unit_id IS NOT NULL "
            "AND NULLIF(btrim(unit_display), '') IS NOT NULL) "
            "OR (measure_mode IN ('to_taste', 'as_needed', 'unspecified') "
            "AND quantity_min IS NULL AND quantity_max IS NULL "
            "AND measurement_unit_id IS NULL AND unit_display IS NULL "
            "AND package_size_id IS NULL)",
            name=op.f("ck_recipe_draft_ingredients_measure_shape_valid"),
        ),
        sa.CheckConstraint(
            "package_size_id IS NULL OR ingredient_id IS NOT NULL",
            name=op.f("ck_recipe_draft_ingredients_package_requires_catalog_ingredient"),
        ),
        sa.CheckConstraint(
            "display_order >= 0",
            name=op.f("ck_recipe_draft_ingredients_display_order_nonnegative"),
        ),
        sa.ForeignKeyConstraint(
            ["ingredient_id"],
            ["ingredients.id"],
            name=op.f("fk_recipe_draft_ingredients_ingredient_id_ingredients"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["ingredient_request_id"],
            ["ingredient_catalog_requests.id"],
            name=op.f(
                "fk_recipe_draft_ingredients_ingredient_request_id_ingredient_catalog_requests"
            ),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["measurement_unit_id"],
            ["measurement_units.id"],
            name=op.f("fk_recipe_draft_ingredients_measurement_unit_id_measurement_units"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["package_size_id", "ingredient_id", "measurement_unit_id"],
            [
                "ingredient_package_sizes.id",
                "ingredient_package_sizes.ingredient_id",
                "ingredient_package_sizes.package_unit_id",
            ],
            name="fk_recipe_draft_ingredients_package_size_ingredient_unit",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["recipe_draft_id"],
            ["recipe_drafts.id"],
            name=op.f("fk_recipe_draft_ingredients_recipe_draft_id_recipe_drafts"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_recipe_draft_ingredients")),
        sa.UniqueConstraint(
            "recipe_draft_id",
            "display_order",
            name="uq_recipe_draft_ingredients_draft_display_order",
        ),
        sa.UniqueConstraint(
            "recipe_draft_id",
            "id",
            name="uq_recipe_draft_ingredients_draft_id",
        ),
    )
    op.create_index(
        "ix_recipe_draft_ingredients_ingredient_id",
        "recipe_draft_ingredients",
        ["ingredient_id"],
        unique=False,
    )
    op.create_index(
        "ix_recipe_draft_ingredients_ingredient_request_id",
        "recipe_draft_ingredients",
        ["ingredient_request_id"],
        unique=False,
    )
    op.create_index(
        "ix_recipe_draft_ingredients_measurement_unit_id",
        "recipe_draft_ingredients",
        ["measurement_unit_id"],
        unique=False,
    )

    op.create_table(
        "recipe_draft_instructions",
        sa.Column("recipe_draft_id", sa.Uuid(), nullable=False),
        sa.Column("instruction", sa.Text(), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            "btrim(instruction) <> ''",
            name=op.f("ck_recipe_draft_instructions_instruction_not_blank"),
        ),
        sa.CheckConstraint(
            "display_order >= 0",
            name=op.f("ck_recipe_draft_instructions_display_order_nonnegative"),
        ),
        sa.ForeignKeyConstraint(
            ["recipe_draft_id"],
            ["recipe_drafts.id"],
            name=op.f("fk_recipe_draft_instructions_recipe_draft_id_recipe_drafts"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_recipe_draft_instructions")),
        sa.UniqueConstraint(
            "recipe_draft_id",
            "display_order",
            name="uq_recipe_draft_instructions_draft_display_order",
        ),
        sa.UniqueConstraint(
            "recipe_draft_id",
            "id",
            name="uq_recipe_draft_instructions_draft_id",
        ),
    )

    op.create_table(
        "recipe_draft_instruction_actions",
        sa.Column("recipe_draft_id", sa.Uuid(), nullable=False),
        sa.Column("recipe_draft_instruction_id", sa.Uuid(), nullable=False),
        sa.Column("action_type_id", sa.Uuid(), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            "display_order >= 0",
            name=op.f("ck_recipe_draft_instruction_actions_display_order_nonnegative"),
        ),
        sa.ForeignKeyConstraint(
            ["action_type_id"],
            ["cooking_action_types.id"],
            name=op.f("fk_recipe_draft_instruction_actions_action_type_id_cooking_action_types"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["recipe_draft_id", "recipe_draft_instruction_id"],
            ["recipe_draft_instructions.recipe_draft_id", "recipe_draft_instructions.id"],
            name="fk_recipe_draft_actions_instruction_same_draft",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_recipe_draft_instruction_actions")),
        sa.UniqueConstraint(
            "recipe_draft_instruction_id",
            "display_order",
            name="uq_recipe_draft_actions_instruction_display_order",
        ),
        sa.UniqueConstraint(
            "recipe_draft_id",
            "id",
            name="uq_recipe_draft_actions_draft_id",
        ),
    )
    op.create_index(
        "ix_recipe_draft_actions_action_type_id",
        "recipe_draft_instruction_actions",
        ["action_type_id"],
        unique=False,
    )
    op.create_index(
        "ix_recipe_draft_actions_draft_id",
        "recipe_draft_instruction_actions",
        ["recipe_draft_id"],
        unique=False,
    )

    op.create_table(
        "recipe_draft_instruction_action_inputs",
        sa.Column("recipe_draft_id", sa.Uuid(), nullable=False),
        sa.Column("recipe_draft_instruction_action_id", sa.Uuid(), nullable=False),
        sa.Column("recipe_draft_ingredient_id", sa.Uuid(), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            "display_order >= 0",
            name=op.f("ck_recipe_draft_instruction_action_inputs_order_valid"),
        ),
        sa.ForeignKeyConstraint(
            ["recipe_draft_id", "recipe_draft_instruction_action_id"],
            [
                "recipe_draft_instruction_actions.recipe_draft_id",
                "recipe_draft_instruction_actions.id",
            ],
            name="fk_recipe_draft_action_inputs_action_same_draft",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["recipe_draft_id", "recipe_draft_ingredient_id"],
            ["recipe_draft_ingredients.recipe_draft_id", "recipe_draft_ingredients.id"],
            name="fk_recipe_draft_action_inputs_ingredient_same_draft",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "id",
            name=op.f("pk_recipe_draft_instruction_action_inputs"),
        ),
        sa.UniqueConstraint(
            "recipe_draft_instruction_action_id",
            "display_order",
            name="uq_recipe_draft_action_inputs_action_display_order",
        ),
        sa.UniqueConstraint(
            "recipe_draft_instruction_action_id",
            "recipe_draft_ingredient_id",
            name="uq_recipe_draft_action_inputs_action_ingredient",
        ),
    )
    op.create_index(
        "ix_recipe_draft_action_inputs_draft_id",
        "recipe_draft_instruction_action_inputs",
        ["recipe_draft_id"],
        unique=False,
    )
    op.create_index(
        "ix_recipe_draft_action_inputs_ingredient_id",
        "recipe_draft_instruction_action_inputs",
        ["recipe_draft_ingredient_id"],
        unique=False,
    )

    op.create_table(
        "recipe_draft_instruction_action_measures",
        sa.Column("recipe_draft_instruction_action_id", sa.Uuid(), nullable=False),
        sa.Column("semantic", sa.String(length=16), nullable=False),
        sa.Column("measure_mode", sa.String(length=16), nullable=False),
        sa.Column("quantity_min", sa.Numeric(precision=18, scale=6), nullable=False),
        sa.Column("quantity_max", sa.Numeric(precision=18, scale=6), nullable=True),
        sa.Column("measurement_unit_id", sa.Uuid(), nullable=False),
        sa.Column("unit_display", sa.String(length=64), nullable=False),
        sa.CheckConstraint(
            "semantic IN ('duration', 'temperature')",
            name=op.f("ck_recipe_draft_instruction_action_measures_semantic_supported"),
        ),
        sa.CheckConstraint(
            "(measure_mode = 'exact' AND quantity_min IS NOT NULL "
            "AND quantity_max IS NULL) OR "
            "(measure_mode = 'range' AND quantity_min IS NOT NULL "
            "AND quantity_max IS NOT NULL AND quantity_max > quantity_min)",
            name=op.f("ck_recipe_draft_instruction_action_measures_measure_shape_valid"),
        ),
        sa.CheckConstraint(
            "semantic <> 'duration' OR quantity_min > 0",
            name=op.f("ck_recipe_draft_instruction_action_measures_duration_positive"),
        ),
        sa.CheckConstraint(
            "btrim(unit_display) <> ''",
            name=op.f("ck_recipe_draft_instruction_action_measures_unit_not_blank"),
        ),
        sa.ForeignKeyConstraint(
            ["measurement_unit_id"],
            ["measurement_units.id"],
            name=op.f(
                "fk_recipe_draft_instruction_action_measures_measurement_unit_id_measurement_units"
            ),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["recipe_draft_instruction_action_id"],
            ["recipe_draft_instruction_actions.id"],
            name=op.f(
                "fk_recipe_draft_instruction_action_measures_recipe_draft_instruction_action_id_recipe_draft_instruction_actions"
            ),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "recipe_draft_instruction_action_id",
            "semantic",
            name=op.f("pk_recipe_draft_instruction_action_measures"),
        ),
    )
    op.create_index(
        "ix_recipe_draft_action_measures_measurement_unit_id",
        "recipe_draft_instruction_action_measures",
        ["measurement_unit_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_recipe_draft_action_measures_measurement_unit_id",
        table_name="recipe_draft_instruction_action_measures",
    )
    op.drop_table("recipe_draft_instruction_action_measures")
    op.drop_index(
        "ix_recipe_draft_action_inputs_ingredient_id",
        table_name="recipe_draft_instruction_action_inputs",
    )
    op.drop_index(
        "ix_recipe_draft_action_inputs_draft_id",
        table_name="recipe_draft_instruction_action_inputs",
    )
    op.drop_table("recipe_draft_instruction_action_inputs")
    op.drop_index(
        "ix_recipe_draft_actions_draft_id",
        table_name="recipe_draft_instruction_actions",
    )
    op.drop_index(
        "ix_recipe_draft_actions_action_type_id",
        table_name="recipe_draft_instruction_actions",
    )
    op.drop_table("recipe_draft_instruction_actions")
    op.drop_table("recipe_draft_instructions")
    op.drop_index(
        "ix_recipe_draft_ingredients_measurement_unit_id",
        table_name="recipe_draft_ingredients",
    )
    op.drop_index(
        "ix_recipe_draft_ingredients_ingredient_request_id",
        table_name="recipe_draft_ingredients",
    )
    op.drop_index(
        "ix_recipe_draft_ingredients_ingredient_id",
        table_name="recipe_draft_ingredients",
    )
    op.drop_table("recipe_draft_ingredients")
    op.drop_index(
        "ix_recipe_drafts_source_version_id",
        table_name="recipe_drafts",
    )
    op.drop_index(
        "ix_recipe_drafts_author_status_updated_id",
        table_name="recipe_drafts",
    )
    op.drop_table("recipe_drafts")
