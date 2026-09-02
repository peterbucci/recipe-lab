"""Frozen SQL adapter and backfill for recipe-structure-v1 migration 0011."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, cast
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy import Connection

from migrations.frozen.recipe_fingerprints_0011 import (
    CanonicalUnit,
    RecipeStructure,
    ReviewedAffineConversion,
    StructuralAction,
    StructuralIngredient,
    StructuralInstruction,
    StructuralMeasure,
    build_structural_fingerprint,
)

_BACKFILL_BATCH_SIZE = 100


def _canonical_unit(row: Mapping[str, Any]) -> CanonicalUnit | None:
    unit_key = row["unit_key"]
    if unit_key is None:
        return None
    conversion = None
    if row["conversion_unit_id"] is not None:
        conversion = ReviewedAffineConversion(
            base_unit_key=row["base_unit_key"],
            base_dimension=row["base_dimension"],
            base_conversion_family=row["base_conversion_family"],
            scale_numerator=row["scale_numerator"],
            scale_denominator=row["scale_denominator"],
            offset_numerator=row["offset_numerator"],
            offset_denominator=row["offset_denominator"],
            reviewed=True,
            active=row["conversion_active"],
        )
    return CanonicalUnit(
        key=unit_key,
        dimension=row["unit_dimension"],
        conversion_family=row["unit_conversion_family"],
        conversion=conversion,
    )


def _measure(row: Mapping[str, Any], *, package_size: bool) -> StructuralMeasure:
    package_size_id = row.get("package_size_id") if package_size else None
    return StructuralMeasure(
        mode=row["measure_mode"],
        quantity_min=row["quantity_min"],
        quantity_max=row["quantity_max"],
        unit=_canonical_unit(row),
        package_size_identity=str(package_size_id) if package_size_id is not None else None,
    )


_UNIT_COLUMNS = """
    unit.id AS unit_id,
    unit.key AS unit_key,
    unit.dimension AS unit_dimension,
    unit.conversion_family AS unit_conversion_family,
    conversion.unit_id AS conversion_unit_id,
    conversion.scale_numerator,
    conversion.scale_denominator,
    conversion.offset_numerator,
    conversion.offset_denominator,
    conversion.active AS conversion_active,
    base_unit.key AS base_unit_key,
    base_unit.dimension AS base_dimension,
    base_unit.conversion_family AS base_conversion_family
"""

_UNIT_JOINS = """
    LEFT JOIN measurement_units AS unit
      ON unit.id = {owner}.measurement_unit_id
    LEFT JOIN measurement_conversion_rules AS conversion
      ON conversion.unit_id = unit.id
    LEFT JOIN measurement_units AS base_unit
      ON base_unit.id = conversion.base_unit_id
"""


def _ingredient_rows(connection: Connection, recipe_version_id: UUID) -> list[Mapping[str, Any]]:
    statement = sa.text(
        f"""
        SELECT
            ingredient.id,
            ingredient.ingredient_id,
            ingredient.measure_mode,
            ingredient.quantity_min,
            ingredient.quantity_max,
            ingredient.package_size_id,
            {_UNIT_COLUMNS}
        FROM recipe_version_ingredients AS ingredient
        {_UNIT_JOINS.format(owner="ingredient")}
        WHERE ingredient.recipe_version_id = :recipe_version_id
        ORDER BY ingredient.display_order
        """
    )
    return [
        cast(Mapping[str, Any], row)
        for row in connection.execute(
            statement,
            {"recipe_version_id": recipe_version_id},
        ).mappings()
    ]


def _instruction_rows(
    connection: Connection,
    recipe_version_id: UUID,
) -> list[Mapping[str, Any]]:
    return [
        cast(Mapping[str, Any], row)
        for row in connection.execute(
            sa.text(
                """
                SELECT id
                FROM recipe_version_instructions
                WHERE recipe_version_id = :recipe_version_id
                ORDER BY display_order
                """
            ),
            {"recipe_version_id": recipe_version_id},
        ).mappings()
    ]


def _action_rows(connection: Connection, instruction_id: UUID) -> list[Mapping[str, Any]]:
    return [
        cast(Mapping[str, Any], row)
        for row in connection.execute(
            sa.text(
                """
                SELECT action.id, action_type.key AS action_type_key
                FROM recipe_instruction_actions AS action
                JOIN cooking_action_types AS action_type
                  ON action_type.id = action.action_type_id
                WHERE action.recipe_instruction_id = :instruction_id
                ORDER BY action.display_order
                """
            ),
            {"instruction_id": instruction_id},
        ).mappings()
    ]


def _action_inputs(connection: Connection, action_id: UUID) -> tuple[str, ...]:
    return tuple(
        str(value)
        for value in connection.scalars(
            sa.text(
                """
                SELECT recipe_ingredient_id
                FROM recipe_instruction_action_inputs
                WHERE recipe_instruction_action_id = :action_id
                ORDER BY display_order
                """
            ),
            {"action_id": action_id},
        )
    )


def _action_measures(
    connection: Connection,
    action_id: UUID,
) -> dict[str, StructuralMeasure]:
    statement = sa.text(
        f"""
        SELECT
            measure.semantic,
            measure.measure_mode,
            measure.quantity_min,
            measure.quantity_max,
            {_UNIT_COLUMNS}
        FROM recipe_instruction_action_measures AS measure
        {_UNIT_JOINS.format(owner="measure")}
        WHERE measure.recipe_instruction_action_id = :action_id
        ORDER BY measure.semantic
        """
    )
    return {
        row["semantic"]: _measure(cast(Mapping[str, Any], row), package_size=False)
        for row in connection.execute(statement, {"action_id": action_id}).mappings()
    }


def _load_recipe_structure(connection: Connection, recipe_version_id: UUID) -> RecipeStructure:
    ingredients = tuple(
        StructuralIngredient(
            occurrence_key=str(row["id"]),
            ingredient_identity=str(row["ingredient_id"]),
            measure=_measure(row, package_size=True),
        )
        for row in _ingredient_rows(connection, recipe_version_id)
    )
    instructions: list[StructuralInstruction] = []
    for instruction_row in _instruction_rows(connection, recipe_version_id):
        actions: list[StructuralAction] = []
        for action_row in _action_rows(connection, instruction_row["id"]):
            measures = _action_measures(connection, action_row["id"])
            actions.append(
                StructuralAction(
                    action_type_key=action_row["action_type_key"],
                    ingredient_occurrence_keys=_action_inputs(connection, action_row["id"]),
                    duration=measures.get("duration"),
                    temperature=measures.get("temperature"),
                )
            )
        instructions.append(StructuralInstruction(actions=tuple(actions)))
    return RecipeStructure(ingredients=ingredients, instructions=tuple(instructions))


def backfill_all_recipe_structural_fingerprints(connection: Connection) -> None:
    """Backfill every complete version using only the revision-0011 schema."""

    cursor: UUID | None = None
    while True:
        if cursor is None:
            statement = sa.text("SELECT id FROM recipe_versions ORDER BY id LIMIT :candidate_limit")
            parameters: dict[str, object] = {
                "candidate_limit": _BACKFILL_BATCH_SIZE + 1,
            }
        else:
            statement = sa.text(
                """
                SELECT id
                FROM recipe_versions
                WHERE id > :cursor
                ORDER BY id
                LIMIT :candidate_limit
                """
            )
            parameters = {
                "cursor": cursor,
                "candidate_limit": _BACKFILL_BATCH_SIZE + 1,
            }
        candidates = list(connection.scalars(statement, parameters))
        recipe_version_ids = candidates[:_BACKFILL_BATCH_SIZE]
        rows: list[dict[str, object]] = []
        for recipe_version_id in recipe_version_ids:
            computed = build_structural_fingerprint(
                _load_recipe_structure(connection, recipe_version_id)
            )
            if computed is None:
                continue
            rows.append(
                {
                    "recipe_version_id": recipe_version_id,
                    "algorithm_version": computed.algorithm_version,
                    "digest": computed.digest,
                    "canonical_payload": computed.canonical_json,
                }
            )
        if rows:
            connection.execute(
                sa.text(
                    """
                    INSERT INTO recipe_structural_fingerprints
                        (recipe_version_id, algorithm_version, digest, canonical_payload)
                    VALUES
                        (:recipe_version_id, :algorithm_version, :digest, :canonical_payload)
                    """
                ),
                rows,
            )
        if len(candidates) <= _BACKFILL_BATCH_SIZE:
            return
        cursor = recipe_version_ids[-1]
