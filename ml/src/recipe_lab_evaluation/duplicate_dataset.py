from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Literal, cast

from app.services.recipe_duplicate_scoring import (
    DUPLICATE_CANDIDATE_SCORING_ALGORITHM_VERSION,
    DuplicateClassification,
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
class DuplicateBenchmarkStructure:
    id: str
    structure: RecipeStructure


@dataclass(frozen=True, slots=True)
class DuplicateBenchmarkCase:
    id: str
    category: DuplicateBenchmarkCategory
    left_structure_id: str
    right_structure_id: str
    expected_classification: DuplicateClassification


@dataclass(frozen=True, slots=True)
class DuplicateBenchmark:
    schema_version: str
    benchmark_id: str
    structure_version: str
    scoring_algorithm_version: str
    structures: tuple[DuplicateBenchmarkStructure, ...]
    cases: tuple[DuplicateBenchmarkCase, ...]
    sha256: str


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
        "structures",
    }
)
_STRUCTURE_RECORD_KEYS = frozenset({"id", "structure"})
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
        "id",
        "left_structure_id",
        "right_structure_id",
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


def _parse_structures(value: object) -> tuple[DuplicateBenchmarkStructure, ...]:
    structures: list[DuplicateBenchmarkStructure] = []
    for index, raw in enumerate(_array(value, path="structures")):
        path = f"structures[{index}]"
        item = _object(raw, path=path)
        _exact_keys(item, expected=_STRUCTURE_RECORD_KEYS, path=path)
        structures.append(
            DuplicateBenchmarkStructure(
                id=_slug(item["id"], path=f"{path}.id"),
                structure=_parse_structure(item["structure"], path=f"{path}.structure"),
            )
        )
    return tuple(structures)


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
        cases.append(
            DuplicateBenchmarkCase(
                id=_slug(item["id"], path=f"{path}.id"),
                category=raw_category,
                left_structure_id=_slug(
                    item["left_structure_id"], path=f"{path}.left_structure_id"
                ),
                right_structure_id=_slug(
                    item["right_structure_id"], path=f"{path}.right_structure_id"
                ),
                expected_classification=cast(DuplicateClassification, raw_classification),
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


def _normalized_document(benchmark: DuplicateBenchmark) -> dict[str, object]:
    return {
        "benchmark_id": benchmark.benchmark_id,
        "cases": [
            {
                "category": case.category,
                "expected_classification": case.expected_classification,
                "id": case.id,
                "left_structure_id": case.left_structure_id,
                "right_structure_id": case.right_structure_id,
            }
            for case in sorted(benchmark.cases, key=lambda item: item.id)
        ],
        "schema_version": benchmark.schema_version,
        "scoring_algorithm_version": benchmark.scoring_algorithm_version,
        "structure_version": benchmark.structure_version,
        "structures": [
            {
                "id": item.id,
                "structure": _structure_to_document(item.structure),
            }
            for item in sorted(benchmark.structures, key=lambda item: item.id)
        ],
    }


def _validate_benchmark(benchmark: DuplicateBenchmark) -> None:
    if benchmark.schema_version != DUPLICATE_BENCHMARK_SCHEMA_VERSION:
        raise DuplicateBenchmarkError("unsupported duplicate benchmark schema version")
    if benchmark.structure_version != STRUCTURAL_FINGERPRINT_ALGORITHM_VERSION:
        raise DuplicateBenchmarkError("unsupported duplicate benchmark structure version")
    if benchmark.scoring_algorithm_version != DUPLICATE_CANDIDATE_SCORING_ALGORITHM_VERSION:
        raise DuplicateBenchmarkError("unsupported duplicate benchmark scoring version")

    structure_ids = [item.id for item in benchmark.structures]
    if not structure_ids:
        raise DuplicateBenchmarkError("structures must contain at least one entry")
    if len(structure_ids) != len(set(structure_ids)):
        raise DuplicateBenchmarkError("structure IDs must be unique")
    known_structures = set(structure_ids)

    case_ids = [case.id for case in benchmark.cases]
    if len(case_ids) != len(set(case_ids)):
        raise DuplicateBenchmarkError("case IDs must be unique")
    for case in benchmark.cases:
        if case.left_structure_id not in known_structures:
            raise DuplicateBenchmarkError("case references an unknown left structure")
        if case.right_structure_id not in known_structures:
            raise DuplicateBenchmarkError("case references an unknown right structure")

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
        structures=_parse_structures(document["structures"]),
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
        structures=benchmark.structures,
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
    "DuplicateBenchmarkStructure",
    "duplicate_benchmark_to_json",
    "load_duplicate_benchmark",
    "parse_duplicate_benchmark_json",
]
