from __future__ import annotations

import json
import os
import subprocess
import sys
from dataclasses import replace
from decimal import Decimal
from fractions import Fraction
from hashlib import sha256
from pathlib import Path

import pytest

from app.services.recipe_duplicate_scoring import (
    ACTION_ORDER_SUBWEIGHT,
    DUPLICATE_CANDIDATE_PARAMETER_DOCUMENT,
    DUPLICATE_CANDIDATE_PARAMETER_HASH,
    DUPLICATE_CANDIDATE_SCORING_ALGORITHM_VERSION,
    DURATION_TEMPERATURE_SUBWEIGHT,
    INGREDIENT_MULTISET_WEIGHT,
    MAX_DUPLICATE_REASONS,
    NORMALIZED_QUANTITY_WEIGHT,
    ORDERED_INPUT_SUBWEIGHT,
    PROBABLE_DUPLICATE_THRESHOLD,
    STRUCTURED_ACTION_WEIGHT,
    DuplicateCandidateFingerprint,
    InvalidRecipeStructurePayloadError,
    UnsupportedRecipeStructureVersionError,
    score_recipe_duplicate_candidates,
)
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
FLOUR = "10000000-0000-4000-8000-000000000001"
SALT = "10000000-0000-4000-8000-000000000002"
WATER = "10000000-0000-4000-8000-000000000003"


def _unit(
    key: str,
    *,
    dimension: str,
    family: str,
    base_key: str | None = None,
    scale: int = 1,
) -> CanonicalUnit:
    conversion = None
    if base_key is not None:
        conversion = ReviewedAffineConversion(
            base_unit_key=base_key,
            base_dimension=dimension,
            base_conversion_family=family,
            scale_numerator=scale,
            scale_denominator=1,
        )
    return CanonicalUnit(key, dimension, family, conversion)


GRAM = _unit("g", dimension="mass", family="metric-mass", base_key="g")
KILOGRAM = _unit("kg", dimension="mass", family="metric-mass", base_key="g", scale=1000)
OUNCE = _unit("oz", dimension="mass", family="avoirdupois-mass")
SECOND = _unit("second", dimension="time", family="elapsed-time", base_key="second")
CELSIUS = _unit("celsius", dimension="temperature", family="temperature", base_key="celsius")
PACKAGE = _unit("package", dimension="package", family="curated-package")


def _exact(value: int | str, unit: CanonicalUnit = GRAM) -> StructuralMeasure:
    return StructuralMeasure(mode="exact", quantity_min=Decimal(value), unit=unit)


def _range(minimum: int | str, maximum: int | str) -> StructuralMeasure:
    return StructuralMeasure(
        mode="range",
        quantity_min=Decimal(minimum),
        quantity_max=Decimal(maximum),
        unit=GRAM,
    )


def _package(value: int, identity: str) -> StructuralMeasure:
    return StructuralMeasure(
        mode="exact",
        quantity_min=value,
        unit=PACKAGE,
        package_size_identity=identity,
    )


def _structure(
    amounts: tuple[StructuralMeasure, ...] = (_exact(1), _exact(2)),
    *,
    identities: tuple[str, ...] = (FLOUR, SALT),
    action_types: tuple[str, ...] = ("mix", "bake"),
    input_orders: tuple[tuple[int, ...], ...] | None = None,
    duration: StructuralMeasure | None = None,
    temperature: StructuralMeasure | None = None,
    ingredient_order: tuple[int, ...] | None = None,
) -> RecipeStructure:
    assert len(amounts) == len(identities)
    ingredients = tuple(
        StructuralIngredient(f"row-{index}", identity, amount)
        for index, (identity, amount) in enumerate(zip(identities, amounts, strict=True))
    )
    if ingredient_order is not None:
        ingredients = tuple(ingredients[index] for index in ingredient_order)
    if input_orders is None:
        input_orders = tuple(tuple(range(len(amounts))) for _ in action_types)
    actions = tuple(
        StructuralAction(
            action_type,
            tuple(f"row-{index}" for index in inputs),
            duration=duration if action_index == 0 else None,
            temperature=temperature if action_index == len(action_types) - 1 else None,
        )
        for action_index, (action_type, inputs) in enumerate(
            zip(action_types, input_orders, strict=True)
        )
    )
    return RecipeStructure(
        ingredients=ingredients,
        instructions=(StructuralInstruction(actions=actions),),
    )


def _fingerprint(structure: RecipeStructure) -> StructuralFingerprint:
    result = build_structural_fingerprint(structure)
    assert result is not None
    return result


def _input(
    fingerprint: StructuralFingerprint,
    *,
    digest: str | None = None,
    algorithm_version: str | None = None,
) -> DuplicateCandidateFingerprint:
    return DuplicateCandidateFingerprint(
        algorithm_version=algorithm_version or fingerprint.algorithm_version,
        digest=digest or fingerprint.digest,
        canonical_json=fingerprint.canonical_json,
    )


def test_parameter_contract_is_versioned_exact_and_self_hashing() -> None:
    payload = json.loads(DUPLICATE_CANDIDATE_PARAMETER_DOCUMENT)

    assert DUPLICATE_CANDIDATE_SCORING_ALGORITHM_VERSION == ("duplicate-candidate-similarity-v1")
    assert INGREDIENT_MULTISET_WEIGHT == Fraction(9, 20)
    assert NORMALIZED_QUANTITY_WEIGHT == Fraction(1, 4)
    assert STRUCTURED_ACTION_WEIGHT == Fraction(3, 10)
    assert ACTION_ORDER_SUBWEIGHT == Fraction(1, 2)
    assert ORDERED_INPUT_SUBWEIGHT == Fraction(3, 10)
    assert DURATION_TEMPERATURE_SUBWEIGHT == Fraction(1, 5)
    assert PROBABLE_DUPLICATE_THRESHOLD == Fraction(4, 5)
    assert payload["supported_structure_versions"] == ["recipe-structure-v1"]
    assert sha256(DUPLICATE_CANDIDATE_PARAMETER_DOCUMENT.encode()).hexdigest() == (
        DUPLICATE_CANDIDATE_PARAMETER_HASH
    )


def test_exact_match_requires_version_digest_and_exact_canonical_json() -> None:
    original = _fingerprint(_structure())
    exact = score_recipe_duplicate_candidates(original, original)
    changed = _fingerprint(_structure((_exact(1), _exact(3))))
    digest_collision = score_recipe_duplicate_candidates(
        _input(original, digest="a" * 64),
        _input(changed, digest="a" * 64),
    )
    canonical_match_with_wrong_digest = score_recipe_duplicate_candidates(
        original,
        _input(original, digest="b" * 64),
    )

    assert exact.classification == "exact_duplicate"
    assert exact.exact_match is True
    assert exact.score == 1
    assert [reason.code for reason in exact.reasons] == ["exact_structural_match"]
    assert digest_collision.exact_match is False
    assert digest_collision.classification != "exact_duplicate"
    assert canonical_match_with_wrong_digest.exact_match is False
    assert canonical_match_with_wrong_digest.classification == "probable_duplicate"
    assert canonical_match_with_wrong_digest.score == 1


def test_unsupported_structure_versions_and_malformed_v1_payloads_are_rejected() -> None:
    fingerprint = _fingerprint(_structure())
    unsupported = _input(fingerprint, algorithm_version="recipe-structure-v2")
    malformed = replace(_input(fingerprint), canonical_json='{"version":1}')

    with pytest.raises(UnsupportedRecipeStructureVersionError, match="recipe-structure-v2"):
        score_recipe_duplicate_candidates(unsupported, _input(fingerprint))
    with pytest.raises(InvalidRecipeStructurePayloadError, match="invalid recipe-structure-v1"):
        score_recipe_duplicate_candidates(malformed, _input(fingerprint))


def test_ingredient_similarity_is_a_multiplicity_preserving_order_independent_dice_score() -> None:
    left = _fingerprint(
        _structure(
            (_exact(1), _exact(2), _exact(3)),
            identities=(FLOUR, FLOUR, SALT),
            ingredient_order=(2, 0, 1),
        )
    )
    right = _fingerprint(
        _structure(
            (_exact(2), _exact(1), _exact(4)),
            identities=(FLOUR, FLOUR, WATER),
            ingredient_order=(1, 2, 0),
        )
    )

    forward = score_recipe_duplicate_candidates(left, right)
    reverse = score_recipe_duplicate_candidates(right, left)

    assert forward.components.ingredient_multiset == Fraction(2, 3)
    assert forward.components == reverse.components
    assert forward.score == reverse.score


def test_quantity_matching_uses_one_global_scale_and_exact_range_endpoints() -> None:
    original = _fingerprint(_structure((_exact(2), _range(3, 5))))
    scaled = _fingerprint(_structure((_exact(6), _range(9, 15))))
    inconsistent = _fingerprint(_structure((_exact(6), _range(10, 15))))

    proportional = score_recipe_duplicate_candidates(original, scaled)
    partial = score_recipe_duplicate_candidates(original, inconsistent)

    assert proportional.components.normalized_quantities == 1
    assert proportional.quantity_scale == 3
    assert proportional.classification == "probable_duplicate"
    assert [reason.code for reason in proportional.reasons] == [
        "same_ingredient_multiset",
        "proportionally_scaled_quantities",
        "matching_structured_actions",
    ]
    assert partial.components.normalized_quantities == Fraction(1, 2)


def test_quantity_scale_ties_prefer_one_then_the_smallest_positive_fraction() -> None:
    same_scale_left = _fingerprint(_structure((_exact(1), _exact(2)), identities=(FLOUR, FLOUR)))
    same_scale_right = _fingerprint(_structure((_exact(2), _exact(1)), identities=(FLOUR, FLOUR)))
    tied_left = _fingerprint(_structure((_exact(1), _exact(1)), identities=(FLOUR, FLOUR)))
    tied_right = _fingerprint(_structure((_exact(2), _exact(3)), identities=(FLOUR, FLOUR)))

    assert score_recipe_duplicate_candidates(same_scale_left, same_scale_right).quantity_scale == 1
    assert score_recipe_duplicate_candidates(tied_left, tied_right).quantity_scale == 2


def test_qualitative_measures_are_scale_neutral_and_preserve_their_mode() -> None:
    to_taste = StructuralMeasure(mode="to_taste")
    as_needed = StructuralMeasure(mode="as_needed")
    left = _fingerprint(_structure((_exact(1), to_taste)))
    scaled = _fingerprint(_structure((_exact(7), to_taste)))
    changed_mode = _fingerprint(_structure((_exact(7), as_needed)))

    matching = score_recipe_duplicate_candidates(left, scaled)
    changed = score_recipe_duplicate_candidates(left, changed_mode)

    assert matching.quantity_scale == 7
    assert matching.components.normalized_quantities == 1
    assert changed.components.normalized_quantities == Fraction(1, 2)


def test_normalized_unit_equivalence_matches_but_unsupported_units_and_packages_do_not() -> None:
    grams = _fingerprint(_structure((_exact(1000, GRAM), _exact(2, GRAM))))
    kilograms = _fingerprint(_structure((_exact(1, KILOGRAM), _exact("0.002", KILOGRAM))))
    unsupported = _fingerprint(_structure((_exact(1000, OUNCE), _exact(2, OUNCE))))
    small_package = _fingerprint(_structure((_package(1, "small"), _exact(2))))
    large_package = _fingerprint(_structure((_package(1, "large"), _exact(2))))

    assert score_recipe_duplicate_candidates(grams, kilograms).components.normalized_quantities == 1
    assert (
        score_recipe_duplicate_candidates(grams, unsupported).components.normalized_quantities == 0
    )
    assert score_recipe_duplicate_candidates(
        small_package, large_package
    ).components.normalized_quantities == Fraction(1, 2)


def test_structured_action_components_detect_order_inputs_duration_and_temperature() -> None:
    original = _fingerprint(
        _structure(
            action_types=("mix", "bake"),
            input_orders=((0, 1), (0,)),
            duration=_exact(60, SECOND),
            temperature=_exact(180, CELSIUS),
        )
    )
    reordered_actions = _fingerprint(
        _structure(
            action_types=("bake", "mix"),
            input_orders=((0,), (0, 1)),
            duration=_exact(60, SECOND),
            temperature=_exact(180, CELSIUS),
        )
    )
    reordered_inputs = _fingerprint(
        _structure(
            action_types=("mix", "bake"),
            input_orders=((1, 0), (0,)),
            duration=_exact(60, SECOND),
            temperature=_exact(180, CELSIUS),
        )
    )
    changed_parameters = _fingerprint(
        _structure(
            action_types=("mix", "bake"),
            input_orders=((0, 1), (0,)),
            duration=_exact(30, SECOND),
            temperature=_exact(200, CELSIUS),
        )
    )

    action_change = score_recipe_duplicate_candidates(original, reordered_actions)
    input_change = score_recipe_duplicate_candidates(original, reordered_inputs)
    parameter_change = score_recipe_duplicate_candidates(original, changed_parameters)

    assert action_change.components.action_order == Fraction(1, 2)
    assert action_change.components.ordered_inputs == Fraction(2, 3)
    assert action_change.components.duration_temperature < 1
    assert input_change.components.action_order == 1
    assert input_change.components.ordered_inputs < 1
    assert parameter_change.components.action_order == 1
    assert parameter_change.components.ordered_inputs == 1
    assert parameter_change.components.duration_temperature == 0
    assert parameter_change.components.structured_actions < 1


def test_repeated_action_types_use_one_flattened_ordered_input_sequence() -> None:
    left = _fingerprint(
        _structure(
            action_types=("mix", "mix"),
            input_orders=((0,), (1,)),
        )
    )
    swapped_inputs = _fingerprint(
        _structure(
            action_types=("mix", "mix"),
            input_orders=((1,), (0,)),
        )
    )

    result = score_recipe_duplicate_candidates(left, swapped_inputs)

    assert result.components.action_order == 1
    assert result.components.ordered_inputs == Fraction(1, 2)
    assert result.components.duration_temperature == 1


def test_adversarial_same_ingredients_and_quantities_are_distinct_without_action_support() -> None:
    original = _fingerprint(_structure(action_types=("mix",), input_orders=((0, 1),)))
    unrelated_actions = _fingerprint(_structure(action_types=("freeze",), input_orders=((0, 1),)))

    result = score_recipe_duplicate_candidates(original, unrelated_actions)

    assert result.components.ingredient_multiset == 1
    assert result.components.normalized_quantities == 1
    assert result.components.structured_actions == 0
    assert result.score == Fraction(7, 10)
    assert result.classification == "distinct"
    assert result.probable_duplicate is False


def test_probable_threshold_is_inclusive_at_exactly_four_fifths() -> None:
    left_amounts = tuple(_exact(value) for value in (1, 2, 3, 5, 7))
    right_amounts = tuple(_exact(value) for value in (11, 13, 17, 19, 23))
    identities = (FLOUR,) * 5
    input_order = (tuple(range(5)),)
    left = _fingerprint(
        _structure(
            left_amounts,
            identities=identities,
            action_types=("mix",),
            input_orders=input_order,
        )
    )
    right = _fingerprint(
        _structure(
            right_amounts,
            identities=identities,
            action_types=("mix",),
            input_orders=input_order,
        )
    )

    result = score_recipe_duplicate_candidates(left, right)

    assert result.components.ingredient_multiset == 1
    assert result.components.normalized_quantities == Fraction(1, 5)
    assert result.components.structured_actions == 1
    assert result.score == PROBABLE_DUPLICATE_THRESHOLD
    assert result.classification == "probable_duplicate"


def test_reasons_are_bounded_and_follow_ingredient_quantity_action_order() -> None:
    left = _fingerprint(_structure())
    right = _fingerprint(
        _structure(
            (_exact(9), _exact(10)),
            identities=(FLOUR, WATER),
            action_types=("freeze",),
            input_orders=((1,),),
        )
    )

    result = score_recipe_duplicate_candidates(left, right)

    assert len(result.reasons) == MAX_DUPLICATE_REASONS
    assert [reason.code for reason in result.reasons] == [
        "overlapping_ingredient_multisets",
        "partially_matching_quantities",
        "different_action_order",
    ]


_CROSS_PROCESS_SCRIPT = """
from decimal import Decimal
from app.services.recipe_duplicate_scoring import (
    DUPLICATE_CANDIDATE_PARAMETER_DOCUMENT,
    DUPLICATE_CANDIDATE_PARAMETER_HASH,
    score_recipe_duplicate_candidates,
)
from app.services.recipe_fingerprints import (
    CanonicalUnit, RecipeStructure, ReviewedAffineConversion, StructuralAction,
    StructuralIngredient, StructuralInstruction, StructuralMeasure,
    build_structural_fingerprint,
)
rule = ReviewedAffineConversion(
    base_unit_key="g", base_dimension="mass", base_conversion_family="metric-mass",
    scale_numerator=1, scale_denominator=1,
)
unit = CanonicalUnit("g", "mass", "metric-mass", rule)
def make(first, second):
    structure = RecipeStructure(
        ingredients=(
            StructuralIngredient("a", "flour", StructuralMeasure(
                mode="exact", quantity_min=Decimal(first), unit=unit,
            )),
            StructuralIngredient("b", "salt", StructuralMeasure(
                mode="exact", quantity_min=Decimal(second), unit=unit,
            )),
        ),
        instructions=(StructuralInstruction(actions=(
            StructuralAction("mix", ("a", "b")),
        )),),
    )
    result = build_structural_fingerprint(structure)
    assert result is not None
    return result
score = score_recipe_duplicate_candidates(make("1", "2"), make("3", "6"))
print(DUPLICATE_CANDIDATE_PARAMETER_DOCUMENT)
print(DUPLICATE_CANDIDATE_PARAMETER_HASH)
print(score.algorithm_version, score.score, score.quantity_scale, score.classification)
print([reason.code for reason in score.reasons])
"""


def test_scores_parameters_and_reasons_are_identical_across_python_hash_seeds() -> None:
    outputs: list[str] = []
    for hash_seed in ("1", "8675309"):
        completed = subprocess.run(
            [sys.executable, "-c", _CROSS_PROCESS_SCRIPT],
            cwd=BACKEND_ROOT,
            env={**os.environ, "PYTHONHASHSEED": hash_seed},
            check=True,
            capture_output=True,
            text=True,
        )
        outputs.append(completed.stdout)

    assert outputs[0] == outputs[1]
