from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from fractions import Fraction
from pathlib import Path
from typing import Literal, cast

from app.services.recipe_duplicate_scoring import (
    ACTION_DUPLICATE_REASON_CODES,
    DUPLICATE_CANDIDATE_SCORING_ALGORITHM_VERSION,
    EXACT_DUPLICATE_REASON_CODES,
    INGREDIENT_DUPLICATE_REASON_CODES,
    MAX_DUPLICATE_REASONS,
    QUANTITY_DUPLICATE_REASON_CODES,
    DuplicateClassification,
    DuplicateReasonCode,
)
from app.services.recipe_fingerprints import (
    STRUCTURAL_FINGERPRINT_ALGORITHM_VERSION,
    CanonicalUnit,
    RecipeStructure,
    ReviewedAffineConversion,
    StructuralAction,
    StructuralIngredient,
    StructuralInstruction,
    StructuralMeasure,
    build_structural_fingerprint,
)

from .dataset import canonical_json

DUPLICATE_BENCHMARK_SCHEMA_VERSION = "recipe-lab-duplicate-evaluation-fixture-v1"

type DuplicateBenchmarkCategory = Literal[
    "action_change",
    "action_order_change",
    "adversarial_near_match",
    "alias_equivalence",
    "duration_change",
    "ingredient_reorder",
    "proportional_scaling",
    "prose_paraphrase",
    "quantity_change",
    "temperature_change",
    "unit_equivalence",
]
type DuplicateComponentExpectationValue = Literal["below_one", "one"]

REQUIRED_DUPLICATE_BENCHMARK_CATEGORIES: tuple[DuplicateBenchmarkCategory, ...] = (
    "action_change",
    "action_order_change",
    "adversarial_near_match",
    "alias_equivalence",
    "duration_change",
    "ingredient_reorder",
    "proportional_scaling",
    "prose_paraphrase",
    "quantity_change",
    "temperature_change",
    "unit_equivalence",
)

_CLASSIFICATIONS = frozenset({"exact_duplicate", "probable_duplicate", "distinct"})
_CATEGORY_SET = frozenset(REQUIRED_DUPLICATE_BENCHMARK_CATEGORIES)
_SLUG_PATTERN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
_IDENTITY_PATTERN = re.compile(r"[a-z0-9]+(?:(?:-|:)[a-z0-9]+)*")
_DECIMAL_PATTERN = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?")


class DuplicateBenchmarkError(ValueError):
    """Raised when the duplicate-candidate benchmark violates its strict contract."""


@dataclass(frozen=True, slots=True)
class DuplicateBenchmarkRecipe:
    id: str
    ingredient_source_labels: tuple[str, ...]
    instruction_prose: tuple[str, ...]
    structure: RecipeStructure


@dataclass(frozen=True, slots=True)
class DuplicateComponentExpectations:
    ingredient_multiset: DuplicateComponentExpectationValue
    normalized_quantities: DuplicateComponentExpectationValue
    action_order: DuplicateComponentExpectationValue
    ordered_inputs: DuplicateComponentExpectationValue
    duration_temperature: DuplicateComponentExpectationValue
    structured_actions: DuplicateComponentExpectationValue


@dataclass(frozen=True, slots=True)
class DuplicateBenchmarkCase:
    id: str
    category: DuplicateBenchmarkCategory
    left_recipe_id: str
    right_recipe_id: str
    expected_classification: DuplicateClassification
    expected_components: DuplicateComponentExpectations
    expected_reason_codes: tuple[DuplicateReasonCode, ...]


@dataclass(frozen=True, slots=True)
class DuplicateBenchmark:
    schema_version: str
    benchmark_id: str
    structure_version: str
    scoring_algorithm_version: str
    recipes: tuple[DuplicateBenchmarkRecipe, ...]
    cases: tuple[DuplicateBenchmarkCase, ...]
    sha256: str


_ALL_ONE_COMPONENTS = DuplicateComponentExpectations(
    ingredient_multiset="one",
    normalized_quantities="one",
    action_order="one",
    ordered_inputs="one",
    duration_temperature="one",
    structured_actions="one",
)
_QUANTITY_CHANGE_COMPONENTS = DuplicateComponentExpectations(
    ingredient_multiset="one",
    normalized_quantities="below_one",
    action_order="one",
    ordered_inputs="one",
    duration_temperature="one",
    structured_actions="one",
)
_ACTION_CHANGE_COMPONENTS = DuplicateComponentExpectations(
    ingredient_multiset="one",
    normalized_quantities="one",
    action_order="below_one",
    ordered_inputs="below_one",
    duration_temperature="below_one",
    structured_actions="below_one",
)
_PARAMETER_CHANGE_COMPONENTS = DuplicateComponentExpectations(
    ingredient_multiset="one",
    normalized_quantities="one",
    action_order="one",
    ordered_inputs="one",
    duration_temperature="below_one",
    structured_actions="below_one",
)
_ADVERSARIAL_COMPONENTS = DuplicateComponentExpectations(
    ingredient_multiset="one",
    normalized_quantities="below_one",
    action_order="below_one",
    ordered_inputs="below_one",
    duration_temperature="below_one",
    structured_actions="below_one",
)
_EXPECTED_COMPONENTS_BY_CATEGORY: dict[
    DuplicateBenchmarkCategory, DuplicateComponentExpectations
] = {
    "action_change": _ACTION_CHANGE_COMPONENTS,
    "action_order_change": _ACTION_CHANGE_COMPONENTS,
    "adversarial_near_match": _ADVERSARIAL_COMPONENTS,
    "alias_equivalence": _ALL_ONE_COMPONENTS,
    "duration_change": _PARAMETER_CHANGE_COMPONENTS,
    "ingredient_reorder": _ALL_ONE_COMPONENTS,
    "proportional_scaling": _ALL_ONE_COMPONENTS,
    "prose_paraphrase": _ALL_ONE_COMPONENTS,
    "quantity_change": _QUANTITY_CHANGE_COMPONENTS,
    "temperature_change": _PARAMETER_CHANGE_COMPONENTS,
    "unit_equivalence": _ALL_ONE_COMPONENTS,
}
_EXACT_REASONS: tuple[DuplicateReasonCode, ...] = ("exact_structural_match",)
_EXPECTED_REASONS_BY_CATEGORY: dict[DuplicateBenchmarkCategory, tuple[DuplicateReasonCode, ...]] = {
    "action_change": (
        "same_ingredient_multiset",
        "matching_quantities",
        "different_action_types",
    ),
    "action_order_change": (
        "same_ingredient_multiset",
        "matching_quantities",
        "different_action_order",
    ),
    "adversarial_near_match": (
        "same_ingredient_multiset",
        "partially_matching_quantities",
        "different_action_types",
    ),
    "alias_equivalence": _EXACT_REASONS,
    "duration_change": (
        "same_ingredient_multiset",
        "matching_quantities",
        "different_duration_or_temperature",
    ),
    "ingredient_reorder": _EXACT_REASONS,
    "proportional_scaling": (
        "same_ingredient_multiset",
        "proportionally_scaled_quantities",
        "matching_structured_actions",
    ),
    "prose_paraphrase": _EXACT_REASONS,
    "quantity_change": (
        "same_ingredient_multiset",
        "partially_matching_quantities",
        "matching_structured_actions",
    ),
    "temperature_change": (
        "same_ingredient_multiset",
        "matching_quantities",
        "different_duration_or_temperature",
    ),
    "unit_equivalence": _EXACT_REASONS,
}
_REASON_CODE_SET = frozenset(
    EXACT_DUPLICATE_REASON_CODES
    | INGREDIENT_DUPLICATE_REASON_CODES
    | QUANTITY_DUPLICATE_REASON_CODES
    | ACTION_DUPLICATE_REASON_CODES
)


def _reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise DuplicateBenchmarkError("duplicate benchmark contains a duplicate JSON key")
        result[key] = value
    return result


def _object(value: object, *, path: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise DuplicateBenchmarkError(f"{path} must be an object")
    return cast(dict[str, object], value)


def _array(value: object, *, path: str) -> list[object]:
    if not isinstance(value, list):
        raise DuplicateBenchmarkError(f"{path} must be an array")
    return cast(list[object], value)


def _exact_keys(
    value: dict[str, object],
    *,
    expected: frozenset[str],
    path: str,
) -> None:
    if frozenset(value) != expected:
        raise DuplicateBenchmarkError(f"{path} has invalid keys; expected {sorted(expected)!r}")


def _string(value: object, *, path: str) -> str:
    if type(value) is not str or not value.strip():
        raise DuplicateBenchmarkError(f"{path} must be a non-blank string")
    return value


def _slug(value: object, *, path: str) -> str:
    result = _string(value, path=path)
    if _SLUG_PATTERN.fullmatch(result) is None:
        raise DuplicateBenchmarkError(f"{path} must be a lowercase slug")
    return result


def _identity(value: object, *, path: str) -> str:
    result = _string(value, path=path)
    if _IDENTITY_PATTERN.fullmatch(result) is None:
        raise DuplicateBenchmarkError(f"{path} must be a stable lowercase identity")
    return result


def _prose_signature(values: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(" ".join(value.split()).casefold() for value in values)


def _integer(value: object, *, path: str, positive: bool = False) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise DuplicateBenchmarkError(f"{path} must be an integer")
    if positive and value <= 0:
        raise DuplicateBenchmarkError(f"{path} must be positive")
    return value


def _decimal(value: object, *, path: str) -> Decimal:
    raw = _string(value, path=path)
    if _DECIMAL_PATTERN.fullmatch(raw) is None:
        raise DuplicateBenchmarkError(f"{path} must be a canonical decimal string")
    try:
        result = Decimal(raw)
    except InvalidOperation as error:
        raise DuplicateBenchmarkError(f"{path} must be a decimal string") from error
    if not result.is_finite():
        raise DuplicateBenchmarkError(f"{path} must be finite")
    return result


_TOP_LEVEL_KEYS = frozenset(
    {
        "benchmark_id",
        "cases",
        "schema_version",
        "scoring_algorithm_version",
        "structure_version",
        "recipes",
    }
)
_RECIPE_RECORD_KEYS = frozenset(
    {"id", "ingredient_source_labels", "instruction_prose", "structure"}
)
_STRUCTURE_KEYS = frozenset({"ingredients", "instructions"})
_INGREDIENT_KEYS = frozenset({"canonical_ingredient", "measure", "occurrence"})
_INSTRUCTION_KEYS = frozenset({"actions"})
_ACTION_KEYS = frozenset({"action", "duration", "inputs", "temperature"})
_QUALITATIVE_MEASURE_KEYS = frozenset({"mode"})
_EXACT_MEASURE_KEYS = frozenset({"mode", "unit", "value"})
_RANGE_MEASURE_KEYS = frozenset({"maximum", "minimum", "mode", "unit"})
_UNIT_KEYS = frozenset(
    {
        "base_key",
        "dimension",
        "family",
        "key",
        "offset_denominator",
        "offset_numerator",
        "scale_denominator",
        "scale_numerator",
    }
)
_CASE_KEYS = frozenset(
    {
        "category",
        "expected_classification",
        "expected_components",
        "expected_reason_codes",
        "id",
        "left_recipe_id",
        "right_recipe_id",
    }
)
_COMPONENT_KEYS = frozenset(
    {
        "action_order",
        "duration_temperature",
        "ingredient_multiset",
        "normalized_quantities",
        "ordered_inputs",
        "structured_actions",
    }
)


def _parse_unit(value: object, *, path: str) -> CanonicalUnit:
    document = _object(value, path=path)
    _exact_keys(document, expected=_UNIT_KEYS, path=path)
    key = _identity(document["key"], path=f"{path}.key")
    dimension = _identity(document["dimension"], path=f"{path}.dimension")
    family = _identity(document["family"], path=f"{path}.family")
    return CanonicalUnit(
        key=key,
        dimension=dimension,
        conversion_family=family,
        conversion=ReviewedAffineConversion(
            base_unit_key=_identity(document["base_key"], path=f"{path}.base_key"),
            base_dimension=dimension,
            base_conversion_family=family,
            scale_numerator=_integer(
                document["scale_numerator"],
                path=f"{path}.scale_numerator",
                positive=True,
            ),
            scale_denominator=_integer(
                document["scale_denominator"],
                path=f"{path}.scale_denominator",
                positive=True,
            ),
            offset_numerator=_integer(
                document["offset_numerator"], path=f"{path}.offset_numerator"
            ),
            offset_denominator=_integer(
                document["offset_denominator"],
                path=f"{path}.offset_denominator",
                positive=True,
            ),
        ),
    )


def _parse_measure(value: object, *, path: str) -> StructuralMeasure:
    document = _object(value, path=path)
    mode = _string(document.get("mode"), path=f"{path}.mode")
    if mode in {"as_needed", "to_taste", "unspecified"}:
        _exact_keys(document, expected=_QUALITATIVE_MEASURE_KEYS, path=path)
        return StructuralMeasure(mode=mode)
    if mode == "exact":
        _exact_keys(document, expected=_EXACT_MEASURE_KEYS, path=path)
        return StructuralMeasure(
            mode=mode,
            quantity_min=_decimal(document["value"], path=f"{path}.value"),
            unit=_parse_unit(document["unit"], path=f"{path}.unit"),
        )
    if mode == "range":
        _exact_keys(document, expected=_RANGE_MEASURE_KEYS, path=path)
        return StructuralMeasure(
            mode=mode,
            quantity_min=_decimal(document["minimum"], path=f"{path}.minimum"),
            quantity_max=_decimal(document["maximum"], path=f"{path}.maximum"),
            unit=_parse_unit(document["unit"], path=f"{path}.unit"),
        )
    raise DuplicateBenchmarkError(f"{path}.mode is unsupported")


def _parse_optional_measure(value: object, *, path: str) -> StructuralMeasure | None:
    if value is None:
        return None
    return _parse_measure(value, path=path)


def _parse_structure(value: object, *, path: str) -> RecipeStructure:
    document = _object(value, path=path)
    _exact_keys(document, expected=_STRUCTURE_KEYS, path=path)

    ingredients: list[StructuralIngredient] = []
    for index, raw in enumerate(_array(document["ingredients"], path=f"{path}.ingredients")):
        item_path = f"{path}.ingredients[{index}]"
        item = _object(raw, path=item_path)
        _exact_keys(item, expected=_INGREDIENT_KEYS, path=item_path)
        ingredients.append(
            StructuralIngredient(
                occurrence_key=_identity(item["occurrence"], path=f"{item_path}.occurrence"),
                ingredient_identity=_identity(
                    item["canonical_ingredient"],
                    path=f"{item_path}.canonical_ingredient",
                ),
                measure=_parse_measure(item["measure"], path=f"{item_path}.measure"),
            )
        )

    instructions: list[StructuralInstruction] = []
    for index, raw in enumerate(_array(document["instructions"], path=f"{path}.instructions")):
        item_path = f"{path}.instructions[{index}]"
        item = _object(raw, path=item_path)
        _exact_keys(item, expected=_INSTRUCTION_KEYS, path=item_path)
        actions: list[StructuralAction] = []
        for action_index, action_raw in enumerate(
            _array(item["actions"], path=f"{item_path}.actions")
        ):
            action_path = f"{item_path}.actions[{action_index}]"
            action = _object(action_raw, path=action_path)
            _exact_keys(action, expected=_ACTION_KEYS, path=action_path)
            inputs = tuple(
                _identity(input_value, path=f"{action_path}.inputs[{input_index}]")
                for input_index, input_value in enumerate(
                    _array(action["inputs"], path=f"{action_path}.inputs")
                )
            )
            if len(inputs) != len(set(inputs)):
                raise DuplicateBenchmarkError(f"{action_path}.inputs must not contain duplicates")
            actions.append(
                StructuralAction(
                    action_type_key=_identity(action["action"], path=f"{action_path}.action"),
                    ingredient_occurrence_keys=inputs,
                    duration=_parse_optional_measure(
                        action["duration"], path=f"{action_path}.duration"
                    ),
                    temperature=_parse_optional_measure(
                        action["temperature"], path=f"{action_path}.temperature"
                    ),
                )
            )
        instructions.append(StructuralInstruction(actions=tuple(actions)))

    structure = RecipeStructure(
        ingredients=tuple(ingredients),
        instructions=tuple(instructions),
    )
    if build_structural_fingerprint(structure) is None:
        raise DuplicateBenchmarkError(f"{path} cannot produce a complete recipe-structure-v1")
    return structure


def _parse_recipes(value: object) -> tuple[DuplicateBenchmarkRecipe, ...]:
    recipes: list[DuplicateBenchmarkRecipe] = []
    for index, raw in enumerate(_array(value, path="recipes")):
        path = f"recipes[{index}]"
        item = _object(raw, path=path)
        _exact_keys(item, expected=_RECIPE_RECORD_KEYS, path=path)
        instruction_prose = tuple(
            _string(prose, path=f"{path}.instruction_prose[{prose_index}]")
            for prose_index, prose in enumerate(
                _array(item["instruction_prose"], path=f"{path}.instruction_prose")
            )
        )
        structure = _parse_structure(item["structure"], path=f"{path}.structure")
        ingredient_source_labels = tuple(
            _string(label, path=f"{path}.ingredient_source_labels[{label_index}]")
            for label_index, label in enumerate(
                _array(
                    item["ingredient_source_labels"],
                    path=f"{path}.ingredient_source_labels",
                )
            )
        )
        if len(ingredient_source_labels) != len(structure.ingredients):
            raise DuplicateBenchmarkError(
                f"{path}.ingredient_source_labels must align with the structured ingredients"
            )
        if len(instruction_prose) != len(structure.instructions):
            raise DuplicateBenchmarkError(
                f"{path}.instruction_prose must align with the structured instructions"
            )
        recipes.append(
            DuplicateBenchmarkRecipe(
                id=_slug(item["id"], path=f"{path}.id"),
                ingredient_source_labels=ingredient_source_labels,
                instruction_prose=instruction_prose,
                structure=structure,
            )
        )
    return tuple(recipes)


def _parse_component_expectations(
    value: object,
    *,
    path: str,
) -> DuplicateComponentExpectations:
    document = _object(value, path=path)
    _exact_keys(document, expected=_COMPONENT_KEYS, path=path)

    def expectation(key: str) -> DuplicateComponentExpectationValue:
        raw = _string(document[key], path=f"{path}.{key}")
        if raw not in {"below_one", "one"}:
            raise DuplicateBenchmarkError(f"{path}.{key} has an unsupported expectation")
        return cast(DuplicateComponentExpectationValue, raw)

    return DuplicateComponentExpectations(
        ingredient_multiset=expectation("ingredient_multiset"),
        normalized_quantities=expectation("normalized_quantities"),
        action_order=expectation("action_order"),
        ordered_inputs=expectation("ordered_inputs"),
        duration_temperature=expectation("duration_temperature"),
        structured_actions=expectation("structured_actions"),
    )


def _parse_cases(value: object) -> tuple[DuplicateBenchmarkCase, ...]:
    cases: list[DuplicateBenchmarkCase] = []
    for index, raw in enumerate(_array(value, path="cases")):
        path = f"cases[{index}]"
        item = _object(raw, path=path)
        _exact_keys(item, expected=_CASE_KEYS, path=path)
        raw_category = _string(item["category"], path=f"{path}.category")
        if raw_category not in _CATEGORY_SET:
            raise DuplicateBenchmarkError(f"{path}.category is unsupported")
        raw_classification = _string(
            item["expected_classification"], path=f"{path}.expected_classification"
        )
        if raw_classification not in _CLASSIFICATIONS:
            raise DuplicateBenchmarkError(f"{path}.expected_classification is unsupported")
        expected_reason_codes = tuple(
            _string(reason, path=f"{path}.expected_reason_codes[{reason_index}]")
            for reason_index, reason in enumerate(
                _array(item["expected_reason_codes"], path=f"{path}.expected_reason_codes")
            )
        )
        if (
            not expected_reason_codes
            or len(expected_reason_codes) > MAX_DUPLICATE_REASONS
            or len(expected_reason_codes) != len(set(expected_reason_codes))
            or any(reason not in _REASON_CODE_SET for reason in expected_reason_codes)
        ):
            raise DuplicateBenchmarkError(
                f"{path}.expected_reason_codes must be unique, supported, and bounded"
            )
        cases.append(
            DuplicateBenchmarkCase(
                id=_slug(item["id"], path=f"{path}.id"),
                category=raw_category,
                left_recipe_id=_slug(item["left_recipe_id"], path=f"{path}.left_recipe_id"),
                right_recipe_id=_slug(item["right_recipe_id"], path=f"{path}.right_recipe_id"),
                expected_classification=cast(DuplicateClassification, raw_classification),
                expected_components=_parse_component_expectations(
                    item["expected_components"], path=f"{path}.expected_components"
                ),
                expected_reason_codes=cast(tuple[DuplicateReasonCode, ...], expected_reason_codes),
            )
        )
    return tuple(cases)


def _measure_to_document(measure: StructuralMeasure) -> dict[str, object]:
    if measure.mode in {"as_needed", "to_taste", "unspecified"}:
        return {"mode": measure.mode}
    if measure.unit is None or measure.unit.conversion is None:
        raise DuplicateBenchmarkError("benchmark measure lost its reviewed unit conversion")
    rule = measure.unit.conversion
    unit: dict[str, object] = {
        "base_key": rule.base_unit_key,
        "dimension": measure.unit.dimension,
        "family": measure.unit.conversion_family,
        "key": measure.unit.key,
        "offset_denominator": rule.offset_denominator,
        "offset_numerator": rule.offset_numerator,
        "scale_denominator": rule.scale_denominator,
        "scale_numerator": rule.scale_numerator,
    }
    if measure.mode == "exact" and measure.quantity_min is not None:
        return {
            "mode": "exact",
            "unit": unit,
            "value": _number_to_document(measure.quantity_min),
        }
    if (
        measure.mode == "range"
        and measure.quantity_min is not None
        and measure.quantity_max is not None
    ):
        return {
            "maximum": _number_to_document(measure.quantity_max),
            "minimum": _number_to_document(measure.quantity_min),
            "mode": "range",
            "unit": unit,
        }
    raise DuplicateBenchmarkError("benchmark contains an incomplete structured measure")


def _number_to_document(value: Decimal | object) -> str:
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    raise DuplicateBenchmarkError("benchmark numeric values must originate as decimals")


def _structure_to_document(structure: RecipeStructure) -> dict[str, object]:
    return {
        "ingredients": [
            {
                "canonical_ingredient": ingredient.ingredient_identity,
                "measure": (
                    _measure_to_document(ingredient.measure)
                    if ingredient.measure is not None
                    else None
                ),
                "occurrence": ingredient.occurrence_key,
            }
            for ingredient in structure.ingredients
        ],
        "instructions": [
            {
                "actions": [
                    {
                        "action": action.action_type_key,
                        "duration": (
                            _measure_to_document(action.duration)
                            if action.duration is not None
                            else None
                        ),
                        "inputs": list(action.ingredient_occurrence_keys),
                        "temperature": (
                            _measure_to_document(action.temperature)
                            if action.temperature is not None
                            else None
                        ),
                    }
                    for action in instruction.actions
                ]
            }
            for instruction in structure.instructions
        ],
    }


def _component_expectations_to_document(
    expectations: DuplicateComponentExpectations,
) -> dict[str, str]:
    return {
        "action_order": expectations.action_order,
        "duration_temperature": expectations.duration_temperature,
        "ingredient_multiset": expectations.ingredient_multiset,
        "normalized_quantities": expectations.normalized_quantities,
        "ordered_inputs": expectations.ordered_inputs,
        "structured_actions": expectations.structured_actions,
    }


def _normalized_document(benchmark: DuplicateBenchmark) -> dict[str, object]:
    return {
        "benchmark_id": benchmark.benchmark_id,
        "cases": [
            {
                "category": case.category,
                "expected_classification": case.expected_classification,
                "expected_components": _component_expectations_to_document(
                    case.expected_components
                ),
                "expected_reason_codes": list(case.expected_reason_codes),
                "id": case.id,
                "left_recipe_id": case.left_recipe_id,
                "right_recipe_id": case.right_recipe_id,
            }
            for case in sorted(benchmark.cases, key=lambda item: item.id)
        ],
        "schema_version": benchmark.schema_version,
        "scoring_algorithm_version": benchmark.scoring_algorithm_version,
        "structure_version": benchmark.structure_version,
        "recipes": [
            {
                "id": item.id,
                "ingredient_source_labels": list(item.ingredient_source_labels),
                "instruction_prose": list(item.instruction_prose),
                "structure": _structure_to_document(item.structure),
            }
            for item in sorted(benchmark.recipes, key=lambda item: item.id)
        ],
    }


def _case_error(case: DuplicateBenchmarkCase, detail: str) -> DuplicateBenchmarkError:
    return DuplicateBenchmarkError(
        f"case {case.id!r} does not exercise {case.category!r}: {detail}"
    )


def _flatten_actions(recipe: DuplicateBenchmarkRecipe) -> tuple[StructuralAction, ...]:
    return tuple(
        action for instruction in recipe.structure.instructions for action in instruction.actions
    )


def _ingredient_identity_order(recipe: DuplicateBenchmarkRecipe) -> tuple[str | None, ...]:
    return tuple(item.ingredient_identity for item in recipe.structure.ingredients)


def _ingredient_occurrence_order(recipe: DuplicateBenchmarkRecipe) -> tuple[str | None, ...]:
    return tuple(item.occurrence_key for item in recipe.structure.ingredients)


def _source_unit_keys(recipe: DuplicateBenchmarkRecipe) -> tuple[str | None, ...]:
    return tuple(
        item.measure.unit.key
        if item.measure is not None and item.measure.unit is not None
        else None
        for item in recipe.structure.ingredients
    )


def _measure_base_values(measure: StructuralMeasure | None) -> tuple[Fraction, ...] | None:
    if measure is None or measure.mode not in {"exact", "range"} or measure.unit is None:
        return None
    rule = measure.unit.conversion
    if rule is None or not rule.reviewed:
        return None
    raw_values = (
        (measure.quantity_min,)
        if measure.mode == "exact"
        else (measure.quantity_min, measure.quantity_max)
    )
    if any(value is None for value in raw_values):
        return None
    scale = Fraction(rule.scale_numerator, rule.scale_denominator)
    offset = Fraction(rule.offset_numerator, rule.offset_denominator)
    return tuple((Fraction(cast(Decimal, value)) + offset) * scale for value in raw_values)


def _positive_global_quantity_scale(
    left: DuplicateBenchmarkRecipe,
    right: DuplicateBenchmarkRecipe,
) -> Fraction | None:
    if _ingredient_identity_order(left) != _ingredient_identity_order(right):
        return None
    ratios: set[Fraction] = set()
    for left_item, right_item in zip(
        left.structure.ingredients,
        right.structure.ingredients,
        strict=True,
    ):
        left_values = _measure_base_values(left_item.measure)
        right_values = _measure_base_values(right_item.measure)
        if (
            left_values is None
            or right_values is None
            or len(left_values) != len(right_values)
            or any(value == 0 for value in left_values)
        ):
            return None
        ratios.update(
            right_value / left_value
            for left_value, right_value in zip(left_values, right_values, strict=True)
        )
    if len(ratios) != 1:
        return None
    result = next(iter(ratios))
    return result if result > 0 else None


def _validate_case_semantics(
    case: DuplicateBenchmarkCase,
    left: DuplicateBenchmarkRecipe,
    right: DuplicateBenchmarkRecipe,
) -> None:
    if left.id == right.id:
        raise _case_error(case, "the pair must use two different recipe records")
    if case.expected_components != _EXPECTED_COMPONENTS_BY_CATEGORY[case.category]:
        raise _case_error(case, "the expected component profile is not the category contract")
    if case.expected_reason_codes != _EXPECTED_REASONS_BY_CATEGORY[case.category]:
        raise _case_error(case, "the expected ordered reasons are not the category contract")

    left_fingerprint = build_structural_fingerprint(left.structure)
    right_fingerprint = build_structural_fingerprint(right.structure)
    if left_fingerprint is None or right_fingerprint is None:
        raise _case_error(case, "both recipes must produce complete production fingerprints")
    exact_structure = (
        left_fingerprint.digest == right_fingerprint.digest
        and left_fingerprint.canonical_json == right_fingerprint.canonical_json
    )
    exact_categories = {
        "alias_equivalence",
        "ingredient_reorder",
        "prose_paraphrase",
        "unit_equivalence",
    }
    if (case.category in exact_categories) != exact_structure:
        raise _case_error(case, "the production fingerprint relation is incorrect")

    left_actions = _flatten_actions(left)
    right_actions = _flatten_actions(right)
    left_measures = tuple(item.measure for item in left.structure.ingredients)
    right_measures = tuple(item.measure for item in right.structure.ingredients)

    if case.category == "unit_equivalence":
        if not (
            _ingredient_identity_order(left) == _ingredient_identity_order(right)
            and _ingredient_occurrence_order(left) == _ingredient_occurrence_order(right)
            and left.structure.instructions == right.structure.instructions
            and left.ingredient_source_labels == right.ingredient_source_labels
            and _prose_signature(left.instruction_prose)
            == _prose_signature(right.instruction_prose)
            and _source_unit_keys(left) != _source_unit_keys(right)
        ):
            raise _case_error(
                case,
                "only equivalent reviewed source-unit representations may differ",
            )
    elif case.category == "alias_equivalence":
        if not (
            left.structure == right.structure
            and _prose_signature(left.instruction_prose)
            == _prose_signature(right.instruction_prose)
            and tuple(label.casefold() for label in left.ingredient_source_labels)
            != tuple(label.casefold() for label in right.ingredient_source_labels)
        ):
            raise _case_error(
                case,
                "distinct source ingredient labels must map to identical curated structure",
            )
    elif case.category == "ingredient_reorder":
        left_entries = tuple(
            zip(left.structure.ingredients, left.ingredient_source_labels, strict=True)
        )
        right_entries = tuple(
            zip(right.structure.ingredients, right.ingredient_source_labels, strict=True)
        )
        if not (
            left_entries != right_entries
            and Counter(left_entries) == Counter(right_entries)
            and left.structure.instructions == right.structure.instructions
            and _prose_signature(left.instruction_prose)
            == _prose_signature(right.instruction_prose)
        ):
            raise _case_error(case, "the same ingredient records must appear in a new order")
    elif case.category == "prose_paraphrase":
        if not (
            left.structure == right.structure
            and left.ingredient_source_labels == right.ingredient_source_labels
            and _prose_signature(left.instruction_prose)
            != _prose_signature(right.instruction_prose)
        ):
            raise _case_error(
                case,
                "genuinely different prose must retain identical curated structure",
            )
    elif case.category in {"proportional_scaling", "quantity_change"}:
        common_quantity_frame = (
            _ingredient_identity_order(left) == _ingredient_identity_order(right)
            and _ingredient_occurrence_order(left) == _ingredient_occurrence_order(right)
            and left.structure.instructions == right.structure.instructions
            and left.ingredient_source_labels == right.ingredient_source_labels
            and left_measures != right_measures
        )
        scale = _positive_global_quantity_scale(left, right)
        if not common_quantity_frame:
            raise _case_error(case, "only structured ingredient quantities may differ")
        if case.category == "proportional_scaling" and (scale is None or scale == 1):
            raise _case_error(case, "all quantities must use one non-unit positive scale")
        if case.category == "quantity_change" and scale is not None:
            raise _case_error(case, "quantities must not share one positive global scale")
    elif case.category == "action_change":
        left_non_types = tuple(
            (action.ingredient_occurrence_keys, action.duration, action.temperature)
            for action in left_actions
        )
        right_non_types = tuple(
            (action.ingredient_occurrence_keys, action.duration, action.temperature)
            for action in right_actions
        )
        if not (
            left.structure.ingredients == right.structure.ingredients
            and left.ingredient_source_labels == right.ingredient_source_labels
            and left_non_types == right_non_types
            and Counter(action.action_type_key for action in left_actions)
            != Counter(action.action_type_key for action in right_actions)
        ):
            raise _case_error(case, "action types must change while their other fields match")
    elif case.category == "action_order_change":
        if not (
            left.structure.ingredients == right.structure.ingredients
            and left.ingredient_source_labels == right.ingredient_source_labels
            and left_actions != right_actions
            and Counter(left_actions) == Counter(right_actions)
        ):
            raise _case_error(case, "the same complete actions must appear in a new order")
    elif case.category in {"duration_change", "temperature_change"}:
        left_common = tuple(
            (
                action.action_type_key,
                action.ingredient_occurrence_keys,
                action.temperature if case.category == "duration_change" else action.duration,
            )
            for action in left_actions
        )
        right_common = tuple(
            (
                action.action_type_key,
                action.ingredient_occurrence_keys,
                action.temperature if case.category == "duration_change" else action.duration,
            )
            for action in right_actions
        )
        left_changed = tuple(
            action.duration if case.category == "duration_change" else action.temperature
            for action in left_actions
        )
        right_changed = tuple(
            action.duration if case.category == "duration_change" else action.temperature
            for action in right_actions
        )
        if not (
            left.structure.ingredients == right.structure.ingredients
            and left.ingredient_source_labels == right.ingredient_source_labels
            and left_common == right_common
            and left_changed != right_changed
        ):
            raise _case_error(
                case, f"only structured {case.category.removesuffix('_change')} may differ"
            )
    elif case.category == "adversarial_near_match":
        if not (
            Counter(_ingredient_identity_order(left)) == Counter(_ingredient_identity_order(right))
            and left_measures != right_measures
            and Counter(action.action_type_key for action in left_actions)
            != Counter(action.action_type_key for action in right_actions)
            and tuple(action.ingredient_occurrence_keys for action in left_actions)
            != tuple(action.ingredient_occurrence_keys for action in right_actions)
        ):
            raise _case_error(
                case,
                "shared ingredients must conceal quantity, action-type, and input-order changes",
            )


def _validate_benchmark(benchmark: DuplicateBenchmark) -> None:
    if benchmark.schema_version != DUPLICATE_BENCHMARK_SCHEMA_VERSION:
        raise DuplicateBenchmarkError("unsupported duplicate benchmark schema version")
    if benchmark.structure_version != STRUCTURAL_FINGERPRINT_ALGORITHM_VERSION:
        raise DuplicateBenchmarkError("unsupported duplicate benchmark structure version")
    if benchmark.scoring_algorithm_version != DUPLICATE_CANDIDATE_SCORING_ALGORITHM_VERSION:
        raise DuplicateBenchmarkError("unsupported duplicate benchmark scoring version")

    recipe_ids = [item.id for item in benchmark.recipes]
    if not recipe_ids:
        raise DuplicateBenchmarkError("recipes must contain at least one entry")
    if len(recipe_ids) != len(set(recipe_ids)):
        raise DuplicateBenchmarkError("recipe IDs must be unique")
    recipes = {item.id: item for item in benchmark.recipes}

    case_ids = [case.id for case in benchmark.cases]
    if len(case_ids) != len(set(case_ids)):
        raise DuplicateBenchmarkError("case IDs must be unique")
    for case in benchmark.cases:
        if case.left_recipe_id not in recipes:
            raise DuplicateBenchmarkError("case references an unknown left recipe")
        if case.right_recipe_id not in recipes:
            raise DuplicateBenchmarkError("case references an unknown right recipe")
        _validate_case_semantics(
            case,
            recipes[case.left_recipe_id],
            recipes[case.right_recipe_id],
        )

    categories = {case.category for case in benchmark.cases}
    missing_categories = _CATEGORY_SET - categories
    if missing_categories:
        raise DuplicateBenchmarkError(
            f"benchmark is missing required categories: {sorted(missing_categories)!r}"
        )
    expected_classes = {case.expected_classification for case in benchmark.cases}
    if expected_classes != _CLASSIFICATIONS:
        raise DuplicateBenchmarkError("benchmark must label exact, probable, and distinct cases")


def parse_duplicate_benchmark_json(text: str) -> DuplicateBenchmark:
    try:
        raw = json.loads(text, object_pairs_hook=_reject_duplicate_keys)
    except json.JSONDecodeError as error:
        raise DuplicateBenchmarkError(f"invalid JSON: {error.msg}") from error
    document = _object(raw, path="benchmark")
    _exact_keys(document, expected=_TOP_LEVEL_KEYS, path="benchmark")
    benchmark = DuplicateBenchmark(
        schema_version=_string(document["schema_version"], path="schema_version"),
        benchmark_id=_slug(document["benchmark_id"], path="benchmark_id"),
        structure_version=_string(document["structure_version"], path="structure_version"),
        scoring_algorithm_version=_string(
            document["scoring_algorithm_version"], path="scoring_algorithm_version"
        ),
        recipes=_parse_recipes(document["recipes"]),
        cases=_parse_cases(document["cases"]),
        sha256="",
    )
    _validate_benchmark(benchmark)
    normalized = canonical_json(_normalized_document(benchmark))
    return DuplicateBenchmark(
        schema_version=benchmark.schema_version,
        benchmark_id=benchmark.benchmark_id,
        structure_version=benchmark.structure_version,
        scoring_algorithm_version=benchmark.scoring_algorithm_version,
        recipes=benchmark.recipes,
        cases=benchmark.cases,
        sha256=hashlib.sha256(normalized.encode("utf-8")).hexdigest(),
    )


def load_duplicate_benchmark(path: Path) -> DuplicateBenchmark:
    return parse_duplicate_benchmark_json(path.read_text(encoding="utf-8"))


def duplicate_benchmark_to_json(benchmark: DuplicateBenchmark) -> str:
    return canonical_json(_normalized_document(benchmark)) + "\n"


__all__ = [
    "DUPLICATE_BENCHMARK_SCHEMA_VERSION",
    "REQUIRED_DUPLICATE_BENCHMARK_CATEGORIES",
    "DuplicateBenchmark",
    "DuplicateBenchmarkCase",
    "DuplicateBenchmarkCategory",
    "DuplicateBenchmarkError",
    "DuplicateBenchmarkRecipe",
    "DuplicateComponentExpectationValue",
    "DuplicateComponentExpectations",
    "duplicate_benchmark_to_json",
    "load_duplicate_benchmark",
    "parse_duplicate_benchmark_json",
]
