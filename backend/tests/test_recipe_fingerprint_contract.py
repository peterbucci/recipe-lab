from __future__ import annotations

import os
import subprocess
import sys
from dataclasses import fields, replace
from decimal import Decimal
from itertools import permutations
from pathlib import Path

import pytest

from app.services.recipe_fingerprints import (
    CanonicalUnit,
    RecipeStructure,
    ReviewedAffineConversion,
    StructuralAction,
    StructuralFingerprint,
    StructuralIngredient,
    StructuralInstruction,
    StructuralMeasure,
    build_structural_fingerprint,
)

BACKEND_ROOT = Path(__file__).resolve().parents[1]
FLOUR_ID = "10000000-0000-4000-8000-000000000001"
SALT_ID = "10000000-0000-4000-8000-000000000002"


def _unit(
    key: str,
    *,
    dimension: str,
    family: str,
    base_key: str | None = None,
    scale_numerator: int = 1,
    scale_denominator: int = 1,
    offset_numerator: int = 0,
) -> CanonicalUnit:
    conversion = None
    if base_key is not None:
        conversion = ReviewedAffineConversion(
            base_unit_key=base_key,
            base_dimension=dimension,
            base_conversion_family=family,
            scale_numerator=scale_numerator,
            scale_denominator=scale_denominator,
            offset_numerator=offset_numerator,
        )
    return CanonicalUnit(
        key=key,
        dimension=dimension,
        conversion_family=family,
        conversion=conversion,
    )


GRAM = _unit("g", dimension="mass", family="metric-mass", base_key="g")
KILOGRAM = _unit(
    "kg",
    dimension="mass",
    family="metric-mass",
    base_key="g",
    scale_numerator=1000,
)
TEASPOON = _unit(
    "tsp",
    dimension="volume",
    family="culinary-teaspoon-unspecified",
)
TABLESPOON = _unit(
    "tbsp",
    dimension="volume",
    family="culinary-tablespoon-unspecified",
)
SECOND = _unit("second", dimension="time", family="elapsed-time", base_key="second")
MINUTE = _unit(
    "minute",
    dimension="time",
    family="elapsed-time",
    base_key="second",
    scale_numerator=60,
)
CELSIUS = _unit(
    "celsius",
    dimension="temperature",
    family="celsius-fahrenheit-temperature",
    base_key="celsius",
)
FAHRENHEIT = _unit(
    "fahrenheit",
    dimension="temperature",
    family="celsius-fahrenheit-temperature",
    base_key="celsius",
    scale_numerator=5,
    scale_denominator=9,
    offset_numerator=-32,
)


def _exact(value: str, unit: CanonicalUnit) -> StructuralMeasure:
    return StructuralMeasure(
        mode="exact",
        quantity_min=Decimal(value),
        unit=unit,
    )


def _structure(
    *,
    flour_measure: StructuralMeasure | None = None,
    salt_measure: StructuralMeasure | None = None,
    duration: StructuralMeasure | None = None,
    temperature: StructuralMeasure | None = None,
) -> RecipeStructure:
    return RecipeStructure(
        ingredients=(
            StructuralIngredient(
                occurrence_key="flour-row",
                ingredient_identity=FLOUR_ID,
                measure=flour_measure or _exact("1000", GRAM),
            ),
            StructuralIngredient(
                occurrence_key="salt-row",
                ingredient_identity=SALT_ID,
                measure=salt_measure or StructuralMeasure(mode="to_taste"),
            ),
        ),
        instructions=(
            StructuralInstruction(
                actions=(
                    StructuralAction(
                        action_type_key="mix",
                        ingredient_occurrence_keys=("salt-row", "flour-row"),
                        duration=duration,
                    ),
                )
            ),
            StructuralInstruction(
                actions=(
                    StructuralAction(
                        action_type_key="bake",
                        ingredient_occurrence_keys=("flour-row",),
                        temperature=temperature,
                    ),
                )
            ),
        ),
    )


def _fingerprint(structure: RecipeStructure) -> StructuralFingerprint:
    fingerprint = build_structural_fingerprint(structure)
    assert fingerprint is not None
    return fingerprint


def test_contract_exposes_only_reviewed_structure_not_recipe_prose_or_metadata() -> None:
    assert [field.name for field in fields(RecipeStructure)] == [
        "ingredients",
        "instructions",
    ]
    assert [field.name for field in fields(StructuralIngredient)] == [
        "occurrence_key",
        "ingredient_identity",
        "measure",
    ]
    assert [field.name for field in fields(StructuralInstruction)] == ["actions"]
    assert [field.name for field in fields(StructuralMeasure)] == [
        "mode",
        "quantity_min",
        "quantity_max",
        "unit",
        "package_size_identity",
    ]
    assert [field.name for field in fields(StructuralAction)] == [
        "action_type_key",
        "ingredient_occurrence_keys",
        "duration",
        "temperature",
    ]


def test_safe_equivalent_conversions_share_identity_and_unsupported_units_do_not() -> None:
    grams = _fingerprint(
        _structure(
            flour_measure=_exact("1000", GRAM),
            duration=_exact("60", SECOND),
            temperature=_exact("180", CELSIUS),
        )
    )
    converted = _fingerprint(
        _structure(
            flour_measure=_exact("1", KILOGRAM),
            duration=_exact("1", MINUTE),
            temperature=_exact("356", FAHRENHEIT),
        )
    )
    teaspoon = _fingerprint(_structure(flour_measure=_exact("1", TEASPOON)))
    tablespoon = _fingerprint(_structure(flour_measure=_exact("1", TABLESPOON)))

    assert converted.canonical_json == grams.canonical_json
    assert converted.digest == grams.digest
    assert teaspoon.canonical_json != tablespoon.canonical_json
    assert teaspoon.digest != tablespoon.digest


def test_repeated_occurrences_are_a_uuid_and_row_order_independent_multiset() -> None:
    repeated = (
        StructuralIngredient("local-a", FLOUR_ID, _exact("500", GRAM)),
        StructuralIngredient("local-b", FLOUR_ID, _exact("500", GRAM)),
        StructuralIngredient("local-salt", SALT_ID, StructuralMeasure(mode="to_taste")),
    )
    instructions = (
        StructuralInstruction(
            actions=(
                StructuralAction("mix", ("local-b", "local-salt")),
                StructuralAction("fold", ("local-a",)),
            )
        ),
    )
    expected = _fingerprint(RecipeStructure(repeated, instructions))

    for ingredient_order in permutations(repeated):
        actual = _fingerprint(RecipeStructure(ingredient_order, instructions))
        assert actual.canonical_json == expected.canonical_json
        assert actual.digest == expected.digest

    renamed = RecipeStructure(
        ingredients=(
            StructuralIngredient("fresh-3", SALT_ID, StructuralMeasure(mode="to_taste")),
            StructuralIngredient("fresh-2", FLOUR_ID, _exact("500", GRAM)),
            StructuralIngredient("fresh-1", FLOUR_ID, _exact("500", GRAM)),
        ),
        instructions=(
            StructuralInstruction(
                actions=(
                    StructuralAction("mix", ("fresh-2", "fresh-3")),
                    StructuralAction("fold", ("fresh-1",)),
                )
            ),
        ),
    )
    assert _fingerprint(renamed).canonical_json == expected.canonical_json


def test_ordered_graph_changes_remain_structurally_visible() -> None:
    original = _structure()
    reversed_instructions = replace(
        original,
        instructions=tuple(reversed(original.instructions)),
    )
    first_instruction = original.instructions[0]
    first_action = first_instruction.actions[0]
    reversed_inputs = replace(
        original,
        instructions=(
            replace(
                first_instruction,
                actions=(
                    replace(
                        first_action,
                        ingredient_occurrence_keys=tuple(
                            reversed(first_action.ingredient_occurrence_keys)
                        ),
                    ),
                ),
            ),
            original.instructions[1],
        ),
    )
    changed_action = replace(
        original,
        instructions=(
            replace(
                first_instruction,
                actions=(replace(first_action, action_type_key="fold"),),
            ),
            original.instructions[1],
        ),
    )

    original_digest = _fingerprint(original).digest
    assert _fingerprint(reversed_instructions).digest != original_digest
    assert _fingerprint(reversed_inputs).digest != original_digest
    assert _fingerprint(changed_action).digest != original_digest


@pytest.mark.parametrize(
    "structure",
    [
        RecipeStructure(ingredients=(), instructions=()),
        RecipeStructure(
            ingredients=(StructuralIngredient("ingredient", FLOUR_ID, _exact("1", GRAM)),),
            instructions=(),
        ),
        RecipeStructure(
            ingredients=(StructuralIngredient("ingredient", FLOUR_ID, _exact("1", GRAM)),),
            instructions=(StructuralInstruction(actions=()),),
        ),
        RecipeStructure(
            ingredients=(StructuralIngredient("ingredient", FLOUR_ID, _exact("1", GRAM)),),
            instructions=(
                StructuralInstruction(actions=(StructuralAction("mix", ("missing-ingredient",)),)),
            ),
        ),
    ],
)
def test_incomplete_or_inconsistent_legacy_structure_has_no_exact_identity(
    structure: RecipeStructure,
) -> None:
    assert build_structural_fingerprint(structure) is None


_CROSS_RUN_SCRIPT = """
from decimal import Decimal
from app.services.recipe_fingerprints import (
    CanonicalUnit, RecipeStructure, ReviewedAffineConversion, StructuralAction,
    StructuralIngredient, StructuralInstruction, StructuralMeasure,
    build_structural_fingerprint,
)
rule = ReviewedAffineConversion(
    base_unit_key="g", base_dimension="mass",
    base_conversion_family="metric-mass", scale_numerator=1000,
    scale_denominator=1,
)
unit = CanonicalUnit(
    key="kg", dimension="mass", conversion_family="metric-mass", conversion=rule,
)
structure = RecipeStructure(
    ingredients=(
        StructuralIngredient("runtime-row", "ingredient-id", StructuralMeasure(
            mode="exact", quantity_min=Decimal("1.0000"), unit=unit,
        )),
    ),
    instructions=(
        StructuralInstruction(actions=(StructuralAction("mix", ("runtime-row",)),)),
    ),
)
result = build_structural_fingerprint(structure)
assert result is not None
print(result.digest)
print(result.canonical_json)
"""


def test_fingerprint_is_identical_across_fresh_python_hash_seeds() -> None:
    outputs: list[str] = []
    for hash_seed in ("1", "8675309"):
        environment = {**os.environ, "PYTHONHASHSEED": hash_seed}
        completed = subprocess.run(
            [sys.executable, "-c", _CROSS_RUN_SCRIPT],
            cwd=BACKEND_ROOT,
            env=environment,
            check=True,
            capture_output=True,
            text=True,
        )
        outputs.append(completed.stdout)

    assert outputs[0] == outputs[1]
