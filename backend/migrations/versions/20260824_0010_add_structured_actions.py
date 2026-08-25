"""add curated cooking actions and structured instruction mappings

Revision ID: 20260824_0010
Revises: 20260824_0009
Create Date: 2026-08-24 23:00:00.000000

"""

from collections.abc import Sequence
from decimal import Decimal
from uuid import UUID

import sqlalchemy as sa
from alembic import op
from sqlalchemy import Connection

from app.seeds.catalog import load_bundled_catalog
from app.seeds.identifiers import action_uuid, measurement_uuid, seed_uuid
from app.seeds.schema import ExactActionMeasureSeed, RangeActionMeasureSeed

revision: str = "20260824_0010"
down_revision: str | None = "20260824_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _create_action_tables() -> None:
    op.create_table(
        "cooking_action_types",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("canonical_verb", sa.String(length=64), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("provenance", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'",
            name=op.f("ck_cooking_action_types_key_supported_format"),
        ),
        sa.CheckConstraint(
            "btrim(canonical_verb) <> ''",
            name=op.f("ck_cooking_action_types_canonical_verb_not_blank"),
        ),
        sa.CheckConstraint(
            "btrim(provenance) <> ''",
            name=op.f("ck_cooking_action_types_provenance_not_blank"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_cooking_action_types")),
    )
    op.create_index(
        "uq_cooking_action_types_key_normalized",
        "cooking_action_types",
        [sa.text("lower(btrim(key))")],
        unique=True,
    )
    op.create_index(
        "uq_cooking_action_types_canonical_verb_normalized",
        "cooking_action_types",
        [sa.text("lower(btrim(canonical_verb))")],
        unique=True,
    )
    op.create_index(
        "ix_cooking_action_types_active_verb",
        "cooking_action_types",
        ["active", "canonical_verb"],
        unique=False,
    )

    op.create_unique_constraint(
        "uq_recipe_version_ingredients_version_id",
        "recipe_version_ingredients",
        ["recipe_version_id", "id"],
    )
    op.create_unique_constraint(
        "uq_recipe_version_instructions_version_id",
        "recipe_version_instructions",
        ["recipe_version_id", "id"],
    )

    op.create_table(
        "recipe_instruction_actions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("recipe_version_id", sa.Uuid(), nullable=False),
        sa.Column("recipe_instruction_id", sa.Uuid(), nullable=False),
        sa.Column("action_type_id", sa.Uuid(), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "display_order >= 0",
            name=op.f("ck_recipe_instruction_actions_display_order_nonnegative"),
        ),
        sa.ForeignKeyConstraint(
            ["action_type_id"],
            ["cooking_action_types.id"],
            name=op.f("fk_recipe_instruction_actions_action_type_id_cooking_action_types"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["recipe_version_id", "recipe_instruction_id"],
            [
                "recipe_version_instructions.recipe_version_id",
                "recipe_version_instructions.id",
            ],
            name="fk_recipe_instruction_actions_instruction_same_version",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_recipe_instruction_actions")),
        sa.UniqueConstraint(
            "recipe_instruction_id",
            "display_order",
            name="uq_recipe_instruction_actions_instruction_display_order",
        ),
        sa.UniqueConstraint(
            "recipe_version_id",
            "id",
            name="uq_recipe_instruction_actions_version_id",
        ),
    )
    op.create_index(
        "ix_recipe_instruction_actions_recipe_version_id",
        "recipe_instruction_actions",
        ["recipe_version_id"],
        unique=False,
    )
    op.create_index(
        "ix_recipe_instruction_actions_action_type_id",
        "recipe_instruction_actions",
        ["action_type_id"],
        unique=False,
    )

    op.create_table(
        "recipe_instruction_action_inputs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("recipe_version_id", sa.Uuid(), nullable=False),
        sa.Column("recipe_instruction_action_id", sa.Uuid(), nullable=False),
        sa.Column("recipe_ingredient_id", sa.Uuid(), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "display_order >= 0",
            name=op.f("ck_recipe_instruction_action_inputs_display_order_nonnegative"),
        ),
        sa.ForeignKeyConstraint(
            ["recipe_version_id", "recipe_instruction_action_id"],
            ["recipe_instruction_actions.recipe_version_id", "recipe_instruction_actions.id"],
            name="fk_recipe_instruction_action_inputs_action_same_version",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["recipe_version_id", "recipe_ingredient_id"],
            ["recipe_version_ingredients.recipe_version_id", "recipe_version_ingredients.id"],
            name="fk_recipe_instruction_action_inputs_ingredient_same_version",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "id",
            name=op.f("pk_recipe_instruction_action_inputs"),
        ),
        sa.UniqueConstraint(
            "recipe_instruction_action_id",
            "display_order",
            name="uq_recipe_instruction_action_inputs_action_display_order",
        ),
        sa.UniqueConstraint(
            "recipe_instruction_action_id",
            "recipe_ingredient_id",
            name="uq_recipe_instruction_action_inputs_action_ingredient",
        ),
    )
    op.create_index(
        "ix_recipe_instruction_action_inputs_recipe_version_id",
        "recipe_instruction_action_inputs",
        ["recipe_version_id"],
        unique=False,
    )
    op.create_index(
        "ix_recipe_instruction_action_inputs_recipe_ingredient_id",
        "recipe_instruction_action_inputs",
        ["recipe_ingredient_id"],
        unique=False,
    )

    op.create_table(
        "recipe_instruction_action_measures",
        sa.Column("recipe_instruction_action_id", sa.Uuid(), nullable=False),
        sa.Column("semantic", sa.String(length=16), nullable=False),
        sa.Column("measure_mode", sa.String(length=16), nullable=False),
        sa.Column("quantity_min", sa.Numeric(precision=18, scale=6), nullable=False),
        sa.Column("quantity_max", sa.Numeric(precision=18, scale=6), nullable=True),
        sa.Column("measurement_unit_id", sa.Uuid(), nullable=False),
        sa.Column("unit_display", sa.String(length=64), nullable=False),
        sa.CheckConstraint(
            "semantic IN ('duration', 'temperature')",
            name=op.f("ck_recipe_instruction_action_measures_semantic_supported"),
        ),
        sa.CheckConstraint(
            "(measure_mode = 'exact' "
            "AND quantity_min IS NOT NULL "
            "AND quantity_max IS NULL) "
            "OR (measure_mode = 'range' "
            "AND quantity_min IS NOT NULL "
            "AND quantity_max IS NOT NULL "
            "AND quantity_max > quantity_min)",
            name=op.f("ck_recipe_instruction_action_measures_measure_shape_valid"),
        ),
        sa.CheckConstraint(
            "semantic <> 'duration' OR quantity_min > 0",
            name=op.f("ck_recipe_instruction_action_measures_duration_positive"),
        ),
        sa.CheckConstraint(
            "btrim(unit_display) <> ''",
            name=op.f("ck_recipe_instruction_action_measures_unit_display_not_blank"),
        ),
        sa.ForeignKeyConstraint(
            ["measurement_unit_id"],
            ["measurement_units.id"],
            name=op.f(
                "fk_recipe_instruction_action_measures_measurement_unit_id_measurement_units"
            ),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["recipe_instruction_action_id"],
            ["recipe_instruction_actions.id"],
            name=op.f(
                "fk_recipe_instruction_action_measures_recipe_instruction_action_id_"
                "recipe_instruction_actions"
            ),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "recipe_instruction_action_id",
            "semantic",
            name=op.f("pk_recipe_instruction_action_measures"),
        ),
    )
    op.create_index(
        "ix_recipe_instruction_action_measures_measurement_unit_id",
        "recipe_instruction_action_measures",
        ["measurement_unit_id"],
        unique=False,
    )


def _seed_action_catalog() -> None:
    catalog = load_bundled_catalog().action_catalog
    action_types = sa.table(
        "cooking_action_types",
        sa.column("id", sa.Uuid()),
        sa.column("key", sa.String()),
        sa.column("canonical_verb", sa.String()),
        sa.column("active", sa.Boolean()),
        sa.column("provenance", sa.Text()),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    op.bulk_insert(
        action_types,
        [
            {
                "id": action_uuid("action-type", action_type.key),
                "key": action_type.key,
                "canonical_verb": action_type.canonical_verb,
                "active": action_type.active,
                "provenance": action_type.provenance,
                "created_at": catalog.metadata.published_at,
            }
            for action_type in catalog.action_types
        ],
    )


def _measure_values(
    action_id: UUID,
    semantic: str,
    measure: ExactActionMeasureSeed | RangeActionMeasureSeed,
    unit_displays: dict[str, str],
) -> dict[str, object]:
    if isinstance(measure, ExactActionMeasureSeed):
        mode = "exact"
        minimum: Decimal = measure.value
        maximum: Decimal | None = None
        unit_key = measure.unit
    else:
        mode = "range"
        minimum = measure.minimum
        maximum = measure.maximum
        unit_key = measure.unit
    return {
        "recipe_instruction_action_id": action_id,
        "semantic": semantic,
        "measure_mode": mode,
        "quantity_min": minimum,
        "quantity_max": maximum,
        "measurement_unit_id": measurement_uuid("unit", unit_key),
        "unit_display": unit_displays[unit_key],
    }


def _seed_action_rows(
    connection: Connection,
) -> tuple[list[dict[str, object]], list[dict[str, object]], list[dict[str, object]]]:
    catalog = load_bundled_catalog()
    dataset_id = catalog.metadata.dataset_id
    existing_instructions = {
        row.id: (row.recipe_version_id, row.instruction)
        for row in connection.execute(
            sa.text("SELECT id, recipe_version_id, instruction FROM recipe_version_instructions")
        )
    }
    existing_ingredients = set(
        connection.execute(sa.text("SELECT id FROM recipe_version_ingredients")).scalars()
    )
    unit_displays = {
        unit.key: unit.symbol or unit.canonical_label for unit in catalog.measurement_catalog.units
    }
    action_rows: list[dict[str, object]] = []
    input_rows: list[dict[str, object]] = []
    measure_rows: list[dict[str, object]] = []

    for recipe in catalog.recipes:
        recipe_version_id = seed_uuid(dataset_id, "recipe-version", recipe.key)
        for instruction in recipe.instructions:
            instruction_id = seed_uuid(
                dataset_id,
                "recipe-instruction",
                f"{recipe.key}:{instruction.key}",
            )
            stored = existing_instructions.get(instruction_id)
            if stored is None:
                continue
            if stored != (recipe_version_id, instruction.text):
                raise RuntimeError(
                    "structured-action mapping refused a seed instruction whose stored "
                    f"snapshot drifted: instruction_id={instruction_id}"
                )

            for display_order, action in enumerate(instruction.actions):
                stable_key = f"{recipe.key}:{instruction.key}:{action.key}"
                action_id = seed_uuid(
                    dataset_id,
                    "recipe-instruction-action",
                    stable_key,
                )
                action_rows.append(
                    {
                        "id": action_id,
                        "recipe_version_id": recipe_version_id,
                        "recipe_instruction_id": instruction_id,
                        "action_type_id": action_uuid("action-type", action.action_type),
                        "display_order": display_order,
                    }
                )
                for input_order, input_key in enumerate(action.inputs):
                    ingredient_id = seed_uuid(
                        dataset_id,
                        "recipe-ingredient",
                        f"{recipe.key}:{input_key}",
                    )
                    if ingredient_id not in existing_ingredients:
                        raise RuntimeError(
                            "structured-action mapping references a missing seed ingredient: "
                            f"recipe={recipe.key}, instruction={instruction.key}, "
                            f"ingredient={input_key}"
                        )
                    input_rows.append(
                        {
                            "id": seed_uuid(
                                dataset_id,
                                "recipe-instruction-action-input",
                                f"{stable_key}:{input_key}",
                            ),
                            "recipe_version_id": recipe_version_id,
                            "recipe_instruction_action_id": action_id,
                            "recipe_ingredient_id": ingredient_id,
                            "display_order": input_order,
                        }
                    )
                for semantic, measure in (
                    ("duration", action.duration),
                    ("temperature", action.temperature),
                ):
                    if measure is not None:
                        measure_rows.append(
                            _measure_values(
                                action_id,
                                semantic,
                                measure,
                                unit_displays,
                            )
                        )
    return action_rows, input_rows, measure_rows


def _insert_seed_action_mappings(connection: Connection) -> None:
    action_rows, input_rows, measure_rows = _seed_action_rows(connection)
    if action_rows:
        connection.execute(
            sa.text(
                """
                INSERT INTO recipe_instruction_actions
                    (id, recipe_version_id, recipe_instruction_id, action_type_id, display_order)
                VALUES
                    (:id, :recipe_version_id, :recipe_instruction_id,
                     :action_type_id, :display_order)
                """
            ),
            action_rows,
        )
    if input_rows:
        connection.execute(
            sa.text(
                """
                INSERT INTO recipe_instruction_action_inputs
                    (id, recipe_version_id, recipe_instruction_action_id,
                     recipe_ingredient_id, display_order)
                VALUES
                    (:id, :recipe_version_id, :recipe_instruction_action_id,
                     :recipe_ingredient_id, :display_order)
                """
            ),
            input_rows,
        )
    if measure_rows:
        connection.execute(
            sa.text(
                """
                INSERT INTO recipe_instruction_action_measures
                    (recipe_instruction_action_id, semantic, measure_mode,
                     quantity_min, quantity_max, measurement_unit_id, unit_display)
                VALUES
                    (:recipe_instruction_action_id, :semantic, :measure_mode,
                     :quantity_min, :quantity_max, :measurement_unit_id, :unit_display)
                """
            ),
            measure_rows,
        )


def upgrade() -> None:
    _create_action_tables()
    _seed_action_catalog()
    _insert_seed_action_mappings(op.get_bind())


def _actual_rows(connection: Connection, query: str) -> set[tuple[object, ...]]:
    return set(connection.execute(sa.text(query)).tuples())


def _require_reconstructable_action_data(connection: Connection) -> None:
    catalog = load_bundled_catalog()
    expected_types = {
        (
            action_uuid("action-type", action_type.key),
            action_type.key,
            action_type.canonical_verb,
            action_type.active,
            action_type.provenance,
        )
        for action_type in catalog.action_catalog.action_types
    }
    action_rows, input_rows, measure_rows = _seed_action_rows(connection)
    expected_actions = {
        (
            row["id"],
            row["recipe_version_id"],
            row["recipe_instruction_id"],
            row["action_type_id"],
            row["display_order"],
        )
        for row in action_rows
    }
    expected_inputs = {
        (
            row["id"],
            row["recipe_version_id"],
            row["recipe_instruction_action_id"],
            row["recipe_ingredient_id"],
            row["display_order"],
        )
        for row in input_rows
    }
    expected_measures = {
        (
            row["recipe_instruction_action_id"],
            row["semantic"],
            row["measure_mode"],
            row["quantity_min"],
            row["quantity_max"],
            row["measurement_unit_id"],
            row["unit_display"],
        )
        for row in measure_rows
    }
    actual_types = _actual_rows(
        connection,
        "SELECT id, key, canonical_verb, active, provenance FROM cooking_action_types",
    )
    actual_actions = _actual_rows(
        connection,
        """
        SELECT id, recipe_version_id, recipe_instruction_id, action_type_id, display_order
        FROM recipe_instruction_actions
        """,
    )
    actual_inputs = _actual_rows(
        connection,
        """
        SELECT id, recipe_version_id, recipe_instruction_action_id,
               recipe_ingredient_id, display_order
        FROM recipe_instruction_action_inputs
        """,
    )
    actual_measures = _actual_rows(
        connection,
        """
        SELECT recipe_instruction_action_id, semantic, measure_mode,
               quantity_min, quantity_max, measurement_unit_id, unit_display
        FROM recipe_instruction_action_measures
        """,
    )

    differences: list[str] = []
    for name, actual, expected in (
        ("cooking_action_types", actual_types, expected_types),
        ("recipe_instruction_actions", actual_actions, expected_actions),
        ("recipe_instruction_action_inputs", actual_inputs, expected_inputs),
        ("recipe_instruction_action_measures", actual_measures, expected_measures),
    ):
        if actual != expected:
            differences.append(f"{name}:actual={len(actual)},expected={len(expected)}")
    if differences:
        raise RuntimeError(
            "structured-action downgrade refused data that cannot be reconstructed by "
            "the bundled reviewed mappings: "
            f"differences={differences}. Export or remove user-authored action data "
            "explicitly before retrying the downgrade."
        )


def downgrade() -> None:
    connection = op.get_bind()
    _require_reconstructable_action_data(connection)

    op.drop_index(
        "ix_recipe_instruction_action_measures_measurement_unit_id",
        table_name="recipe_instruction_action_measures",
    )
    op.drop_table("recipe_instruction_action_measures")
    op.drop_index(
        "ix_recipe_instruction_action_inputs_recipe_ingredient_id",
        table_name="recipe_instruction_action_inputs",
    )
    op.drop_index(
        "ix_recipe_instruction_action_inputs_recipe_version_id",
        table_name="recipe_instruction_action_inputs",
    )
    op.drop_table("recipe_instruction_action_inputs")
    op.drop_index(
        "ix_recipe_instruction_actions_action_type_id",
        table_name="recipe_instruction_actions",
    )
    op.drop_index(
        "ix_recipe_instruction_actions_recipe_version_id",
        table_name="recipe_instruction_actions",
    )
    op.drop_table("recipe_instruction_actions")
    op.drop_constraint(
        "uq_recipe_version_instructions_version_id",
        "recipe_version_instructions",
        type_="unique",
    )
    op.drop_constraint(
        "uq_recipe_version_ingredients_version_id",
        "recipe_version_ingredients",
        type_="unique",
    )
    op.drop_index(
        "ix_cooking_action_types_active_verb",
        table_name="cooking_action_types",
    )
    op.drop_index(
        "uq_cooking_action_types_canonical_verb_normalized",
        table_name="cooking_action_types",
    )
    op.drop_index(
        "uq_cooking_action_types_key_normalized",
        table_name="cooking_action_types",
    )
    op.drop_table("cooking_action_types")
