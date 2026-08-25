from __future__ import annotations

from dataclasses import replace
from decimal import Decimal
from typing import cast

from app.services.recipe_fingerprints import (
    CanonicalObject,
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


def _unit(
    key: str,
    dimension: str,
    family: str,
    *,
    base: str | None = None,
    scale_numerator: int = 1,
    scale_denominator: int = 1,
    offset_numerator: int = 0,
    offset_denominator: int = 1,
    active: bool = True,
    reviewed: bool = True,
) -> CanonicalUnit:
    conversion = (
        ReviewedAffineConversion(
            base_unit_key=base,
            base_dimension=dimension,
            base_conversion_family=family,
            scale_numerator=scale_numerator,
            scale_denominator=scale_denominator,
            offset_numerator=offset_numerator,
            offset_denominator=offset_denominator,
            active=active,
            reviewed=reviewed,
        )
        if base is not None
        else None
    )
    return CanonicalUnit(
        key=key,
        dimension=dimension,
        conversion_family=family,
        conversion=conversion,
    )


GRAM = _unit("g", "mass", "metric-mass", base="g")
KILOGRAM = _unit(
    "kg",
    "mass",
    "metric-mass",
    base="g",
    scale_numerator=1000,
)
MINUTE = _unit("minute", "time", "elapsed-time", base="second", scale_numerator=60)
HOUR = _unit("hour", "time", "elapsed-time", base="second", scale_numerator=3600)
CELSIUS = _unit(
    "celsius",
    "temperature",
    "celsius-fahrenheit-temperature",
    base="celsius",
)
FAHRENHEIT = _unit(
    "fahrenheit",
    "temperature",
    "celsius-fahrenheit-temperature",
    base="celsius",
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


def _complete_structure() -> RecipeStructure:
    return RecipeStructure(
        ingredients=(
            StructuralIngredient("flour-later", "ingredient:flour", _exact("500", GRAM)),
            StructuralIngredient(
                "salt",
                "ingredient:salt",
                StructuralMeasure(mode="to_taste"),
            ),
            StructuralIngredient("flour-first", "ingredient:flour", _exact("500", GRAM)),
        ),
        instructions=(
            StructuralInstruction(
                actions=(
                    StructuralAction(
                        "mix",
                        ("flour-first", "salt", "flour-later"),
                    ),
                    StructuralAction("knead", ("flour-first",)),
                )
            ),
            StructuralInstruction(
                actions=(
                    StructuralAction(
                        "bake",
                        ("flour-later",),
                        duration=_exact("30", MINUTE),
                        temperature=_exact("180", CELSIUS),
                    ),
                )
            ),
        ),
    )


def _required(result: StructuralFingerprint | None) -> StructuralFingerprint:
    assert result is not None
    return result


def test_golden_payload_groups_multiplicity_and_preserves_ordered_graph() -> None:
    result = _required(build_structural_fingerprint(_complete_structure()))

    assert result.algorithm == "sha256"
    assert result.algorithm_version == "recipe-structure-v1"
    assert result.version == 1
    assert result.canonical_json == (
        '{"ingredients":[{"ingredient":"ingredient:flour","measure":{"mode":"exact",'
        '"unit":{"dimension":"mass","family":"metric-mass","key":"g",'
        '"normalization":"reviewed_base"},"value":{"denominator":1,"numerator":500}},'
        '"multiplicity":2,"occurrences":["ingredient:0000","ingredient:0001"]},'
        '{"ingredient":"ingredient:salt","measure":{"mode":"to_taste"},'
        '"multiplicity":1,"occurrences":["ingredient:0002"]}],"instructions":['
        '{"actions":[{"action":"mix","inputs":["ingredient:0000",'
        '"ingredient:0002","ingredient:0001"],"parameters":[]},{"action":"knead",'
        '"inputs":["ingredient:0000"],"parameters":[]}]},{"actions":[{"action":"bake",'
        '"inputs":["ingredient:0001"],"parameters":[{"measure":{"mode":"exact",'
        '"unit":{"dimension":"time","family":"elapsed-time","key":"second",'
        '"normalization":"reviewed_base"},"value":{"denominator":1,"numerator":1800}},'
        '"semantic":"duration"},{"measure":{"mode":"exact","unit":'
        '{"dimension":"temperature","family":"celsius-fahrenheit-temperature",'
        '"key":"celsius","normalization":"reviewed_base"},"value":{"denominator":1,'
        '"numerator":180}},"semantic":"temperature"}]}]}],'
        '"schema":"recipe-lab.recipe-structure","version":1}'
    )
    assert result.digest == "98d3eb49b3cfd70c1c792edc5af661f6ab0ae00158acf098f0d8a90dfa41a021"
    assert len(result.digest) == 64
    assert result.digest == result.digest.lower()

    ingredients = cast(list[CanonicalObject], result.canonical_payload["ingredients"])
    assert ingredients[0]["multiplicity"] == 2
    assert ingredients[0]["occurrences"] == ["ingredient:0000", "ingredient:0001"]
    instructions = cast(list[CanonicalObject], result.canonical_payload["instructions"])
    actions = cast(list[CanonicalObject], instructions[0]["actions"])
    assert actions[0]["inputs"] == [
        "ingredient:0000",
        "ingredient:0002",
        "ingredient:0001",
    ]


def test_occurrence_rows_are_invariant_to_uuid_display_order_and_copy_ids() -> None:
    original = _required(build_structural_fingerprint(_complete_structure()))
    copied = RecipeStructure(
        ingredients=(
            StructuralIngredient("copy-salt", "ingredient:salt", StructuralMeasure("to_taste")),
            StructuralIngredient("copy-used-later", "ingredient:flour", _exact("0.5", KILOGRAM)),
            StructuralIngredient("copy-used-first", "ingredient:flour", _exact("0.5", KILOGRAM)),
        ),
        instructions=(
            StructuralInstruction(
                (
                    StructuralAction(
                        "mix",
                        ("copy-used-first", "copy-salt", "copy-used-later"),
                    ),
                    StructuralAction("knead", ("copy-used-first",)),
                )
            ),
            StructuralInstruction(
                (
                    StructuralAction(
                        "bake",
                        ("copy-used-later",),
                        duration=_exact("0.5", HOUR),
                        temperature=_exact("356", FAHRENHEIT),
                    ),
                )
            ),
        ),
    )
    copied_result = _required(build_structural_fingerprint(copied))

    assert copied_result.digest == original.digest
    assert copied_result.canonical_payload == original.canonical_payload
    assert copied_result.has_same_payload(original)


def test_unreferenced_identical_occurrences_have_stable_multiplicity_tokens() -> None:
    def fingerprint(first_key: str, second_key: str) -> StructuralFingerprint:
        return _required(
            build_structural_fingerprint(
                RecipeStructure(
                    ingredients=(
                        StructuralIngredient(
                            first_key,
                            "ingredient:water",
                            _exact("100", GRAM),
                        ),
                        StructuralIngredient(
                            second_key,
                            "ingredient:water",
                            _exact("100", GRAM),
                        ),
                    ),
                    instructions=(StructuralInstruction((StructuralAction("preheat"),)),),
                )
            )
        )

    first = fingerprint("unreferenced-a", "unreferenced-b")
    copied = fingerprint("new-row-z", "new-row-x")
    ingredients = cast(list[CanonicalObject], first.canonical_payload["ingredients"])

    assert copied.has_same_payload(first)
    assert ingredients[0]["multiplicity"] == 2
    assert ingredients[0]["occurrences"] == ["ingredient:0000", "ingredient:0001"]


def test_inactive_historical_reviewed_rule_keeps_v1_identity() -> None:
    inactive_kilogram = replace(
        KILOGRAM,
        conversion=replace(cast(ReviewedAffineConversion, KILOGRAM.conversion), active=False),
    )
    grams = RecipeStructure(
        ingredients=(StructuralIngredient("amount", "ingredient:flour", _exact("1000", GRAM)),),
        instructions=(StructuralInstruction((StructuralAction("mix", ("amount",)),)),),
    )
    kilograms = RecipeStructure(
        ingredients=(
            StructuralIngredient(
                "amount-copy",
                "ingredient:flour",
                _exact("1", inactive_kilogram),
            ),
        ),
        instructions=(StructuralInstruction((StructuralAction("mix", ("amount-copy",)),)),),
    )

    assert _required(build_structural_fingerprint(kilograms)).has_same_payload(
        _required(build_structural_fingerprint(grams))
    )


def test_unreviewed_or_unsafe_conversion_metadata_does_not_create_equivalence() -> None:
    unreviewed_kilogram = replace(
        KILOGRAM,
        conversion=replace(cast(ReviewedAffineConversion, KILOGRAM.conversion), reviewed=False),
    )
    mismatched_family = replace(
        KILOGRAM,
        conversion=replace(
            cast(ReviewedAffineConversion, KILOGRAM.conversion),
            base_conversion_family="different-family",
        ),
    )

    def fingerprint(unit: CanonicalUnit, value: str) -> StructuralFingerprint:
        return _required(
            build_structural_fingerprint(
                RecipeStructure(
                    ingredients=(
                        StructuralIngredient("amount", "ingredient:flour", _exact(value, unit)),
                    ),
                    instructions=(StructuralInstruction((StructuralAction("mix", ("amount",)),)),),
                )
            )
        )

    grams = fingerprint(GRAM, "1000")
    assert not fingerprint(unreviewed_kilogram, "1").has_same_payload(grams)
    assert not fingerprint(mismatched_family, "1").has_same_payload(grams)


def test_unsupported_units_and_explicit_package_sizes_remain_distinct() -> None:
    cup = _unit("cup", "volume", "culinary-cup-unspecified")
    millilitre = _unit("ml", "volume", "metric-volume", base="ml")
    package = _unit("can", "package", "package-can-unspecified")

    def fingerprint(measure: StructuralMeasure) -> StructuralFingerprint:
        return _required(
            build_structural_fingerprint(
                RecipeStructure(
                    ingredients=(StructuralIngredient("i", "ingredient:beans", measure),),
                    instructions=(StructuralInstruction((StructuralAction("drain", ("i",)),)),),
                )
            )
        )

    assert not fingerprint(_exact("1", cup)).has_same_payload(
        fingerprint(_exact("236.588", millilitre))
    )
    first_package = StructuralMeasure(
        "exact",
        Decimal(1),
        unit=package,
        package_size_identity="package:small-can",
    )
    second_package = replace(first_package, package_size_identity="package:large-can")
    assert not fingerprint(first_package).has_same_payload(fingerprint(second_package))


def test_rational_conversion_is_exact_without_rounding() -> None:
    third_gram = _unit(
        "third-gram",
        "mass",
        "metric-mass",
        base="g",
        scale_numerator=1,
        scale_denominator=3,
    )
    structure = RecipeStructure(
        ingredients=(StructuralIngredient("i", "ingredient:test", _exact("0.1", third_gram)),),
        instructions=(StructuralInstruction((StructuralAction("mix", ("i",)),)),),
    )
    result = _required(build_structural_fingerprint(structure))
    ingredients = cast(list[CanonicalObject], result.canonical_payload["ingredients"])
    measure = cast(CanonicalObject, ingredients[0]["measure"])

    assert measure["value"] == {"denominator": 30, "numerator": 1}


def test_instruction_action_input_and_parameter_changes_are_structural() -> None:
    original_structure = _complete_structure()
    original = _required(build_structural_fingerprint(original_structure))
    first, second = original_structure.instructions
    first_actions = first.actions
    mix = first_actions[0]
    bake = second.actions[0]
    variants = (
        replace(original_structure, instructions=(second, first)),
        replace(
            original_structure,
            instructions=(replace(first, actions=tuple(reversed(first_actions))), second),
        ),
        replace(
            original_structure,
            instructions=(
                replace(
                    first,
                    actions=(
                        replace(
                            mix,
                            ingredient_occurrence_keys=tuple(
                                reversed(mix.ingredient_occurrence_keys)
                            ),
                        ),
                        first_actions[1],
                    ),
                ),
                second,
            ),
        ),
        replace(
            original_structure,
            instructions=(
                first,
                replace(second, actions=(replace(bake, action_type_key="broil"),)),
            ),
        ),
        replace(
            original_structure,
            instructions=(
                first,
                replace(second, actions=(replace(bake, duration=_exact("31", MINUTE)),)),
            ),
        ),
        replace(
            original_structure,
            instructions=(
                first,
                replace(second, actions=(replace(bake, temperature=_exact("181", CELSIUS)),)),
            ),
        ),
    )

    for variant in variants:
        assert _required(build_structural_fingerprint(variant)).digest != original.digest


def test_incomplete_or_inconsistent_structure_has_no_fingerprint() -> None:
    complete = _complete_structure()
    first_ingredient = complete.ingredients[0]
    first_instruction = complete.instructions[0]
    first_action = first_instruction.actions[0]
    invalid_structures = (
        replace(complete, ingredients=()),
        replace(complete, instructions=()),
        replace(
            complete,
            instructions=(replace(first_instruction, actions=()), *complete.instructions[1:]),
        ),
        replace(
            complete,
            ingredients=(
                replace(first_ingredient, ingredient_identity=None),
                *complete.ingredients[1:],
            ),
        ),
        replace(
            complete,
            ingredients=(replace(first_ingredient, measure=None), *complete.ingredients[1:]),
        ),
        replace(
            complete,
            instructions=(
                replace(
                    first_instruction,
                    actions=(
                        replace(first_action, action_type_key=None),
                        *first_instruction.actions[1:],
                    ),
                ),
                *complete.instructions[1:],
            ),
        ),
        replace(
            complete,
            instructions=(
                replace(
                    first_instruction,
                    actions=(
                        replace(first_action, ingredient_occurrence_keys=("missing",)),
                        *first_instruction.actions[1:],
                    ),
                ),
                *complete.instructions[1:],
            ),
        ),
        replace(
            complete,
            instructions=(
                replace(
                    first_instruction,
                    actions=(
                        replace(
                            first_action,
                            ingredient_occurrence_keys=("salt", "salt"),
                        ),
                        *first_instruction.actions[1:],
                    ),
                ),
                *complete.instructions[1:],
            ),
        ),
    )

    assert all(build_structural_fingerprint(structure) is None for structure in invalid_structures)
