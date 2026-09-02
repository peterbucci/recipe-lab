"""Frozen recipe-structure-v1 canonicalizer used only by migration 0011.

Copied from the production v1 implementation when revision 0011 was frozen.
Do not update this module when the current fingerprint implementation evolves.

Pure, versioned canonical fingerprints for complete recipe structures.

Version 1 deliberately fingerprints only reviewed structure. Titles, descriptions,
instruction prose, ingredient display names and preparation prose, authors, lineage
identifiers, recipe row identifiers, timestamps, servings, and display order for the
ingredient collection are outside the contract.

The canonical JSON payload has this shape::

    {
      "ingredients": [
        {
          "ingredient": "<stable curated ingredient identity>",
          "measure": <canonical measure>,
          "multiplicity": 2,
          "occurrences": ["ingredient:0000", "ingredient:0001"]
        }
      ],
      "instructions": [
        {
          "actions": [
            {
              "action": "<stable curated action key>",
              "inputs": ["ingredient:0000"],
              "parameters": [
                {"measure": <canonical measure>, "semantic": "duration"},
                {"measure": <canonical measure>, "semantic": "temperature"}
              ]
            }
          ]
        }
      ],
      "schema": "recipe-lab.recipe-structure",
      "version": 1
    }

Numeric values are exact reduced rationals represented as
``{"numerator": <integer>, "denominator": <positive integer>}``. A selected
unit's reviewed affine rule is applied only when its source and base metadata agree
on dimension and conversion family. The immutable relationship remains part of v1
even if an operator later makes the rule inactive; correcting its interpretation
requires a new fingerprint version. Unsupported units retain their curated key.
Package sizes retain their explicit curated identity. Version 1 never consults
package contents or ambient ingredient-density rules, because adding or revising
either later must not reinterpret existing recipe structure.

Ingredient occurrences form a multiset rather than a display-ordered list. Each
occurrence is grouped by its canonical ingredient-and-measure core, then ordered by
all of its ordered action-use paths ``(instruction, action, input)``. Tokens are
assigned after that ordering. Equal use paths can occur only for structurally
indistinguishable unreferenced duplicates; their repeated identical cores and
ordinal tokens serialize identically regardless of source row order. No source
occurrence identifier is emitted.

Canonical JSON uses ``sort_keys=True``, compact separators, ``ensure_ascii=False``,
and UTF-8 for hashing. The lowercase SHA-256 digest covers the exact canonical JSON,
including its schema and version. The JSON and parsed payload remain available so
callers can confirm payload equality instead of treating a digest match alone as
proof of identity.

``build_structural_fingerprint`` returns ``None`` rather than a partial digest when
the recipe has no ingredients or instructions, an instruction has no action, a
catalog identity or measure is incomplete, an input is missing or duplicated, or
the structured graph is otherwise inconsistent.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal
from fractions import Fraction
from hashlib import sha256
from typing import Literal

STRUCTURAL_FINGERPRINT_SCHEMA = "recipe-lab.recipe-structure"
STRUCTURAL_FINGERPRINT_VERSION = 1
STRUCTURAL_FINGERPRINT_ALGORITHM = "sha256"
STRUCTURAL_FINGERPRINT_ALGORITHM_VERSION = "recipe-structure-v1"
STRUCTURAL_FINGERPRINT_STORAGE_VERSION = STRUCTURAL_FINGERPRINT_ALGORITHM_VERSION

type StructuralNumber = Decimal | Fraction | int
type MeasureMode = Literal[
    "exact",
    "range",
    "to_taste",
    "as_needed",
    "unspecified",
]
type MeasureSemantic = Literal["ingredient_amount", "duration", "temperature"]
type CanonicalObject = dict[str, object]

_QUALITATIVE_MEASURE_MODES = frozenset({"to_taste", "as_needed", "unspecified"})
_SEMANTIC_DIMENSIONS: dict[MeasureSemantic, frozenset[str]] = {
    "ingredient_amount": frozenset({"mass", "volume", "count", "package"}),
    "duration": frozenset({"time"}),
    "temperature": frozenset({"temperature"}),
}


@dataclass(frozen=True, slots=True)
class ReviewedAffineConversion:
    """One reviewed unit-to-base rule and the base metadata needed to verify it.

    ``active`` is retained for catalog audit context but deliberately does not alter
    v1 output. A rule that was selected for immutable recipe structure keeps its
    reviewed meaning after catalog deactivation.
    """

    base_unit_key: str | None
    base_dimension: str | None
    base_conversion_family: str | None
    scale_numerator: int
    scale_denominator: int
    offset_numerator: int = 0
    offset_denominator: int = 1
    reviewed: bool = True
    active: bool = True


@dataclass(frozen=True, slots=True)
class CanonicalUnit:
    """Curated unit metadata required by the pure canonicalizer."""

    key: str | None
    dimension: str | None
    conversion_family: str | None
    conversion: ReviewedAffineConversion | None = None


@dataclass(frozen=True, slots=True)
class StructuralMeasure:
    """Database-shaped structured measure, without display-only snapshots."""

    mode: MeasureMode | str
    quantity_min: StructuralNumber | None = None
    quantity_max: StructuralNumber | None = None
    unit: CanonicalUnit | None = None
    package_size_identity: str | None = None


@dataclass(frozen=True, slots=True)
class StructuralIngredient:
    """One local occurrence of a curated ingredient in a recipe snapshot."""

    occurrence_key: str | None
    ingredient_identity: str | None
    measure: StructuralMeasure | None


@dataclass(frozen=True, slots=True)
class StructuralAction:
    """One ordered action and its ordered local ingredient references."""

    action_type_key: str | None
    ingredient_occurrence_keys: tuple[str, ...] = ()
    duration: StructuralMeasure | None = None
    temperature: StructuralMeasure | None = None


@dataclass(frozen=True, slots=True)
class StructuralInstruction:
    """One instruction position; prose is intentionally absent."""

    actions: tuple[StructuralAction, ...]


@dataclass(frozen=True, slots=True)
class RecipeStructure:
    """All and only the recipe fields included in fingerprint version 1."""

    ingredients: tuple[StructuralIngredient, ...]
    instructions: tuple[StructuralInstruction, ...]


@dataclass(frozen=True, slots=True)
class StructuralFingerprint:
    """Digest plus the exact payload needed for collision confirmation."""

    version: int
    algorithm: str
    algorithm_version: str
    digest: str
    canonical_payload: CanonicalObject
    canonical_json: str

    def has_same_payload(self, other: StructuralFingerprint) -> bool:
        """Confirm structural equality independently of a digest comparison."""

        return self.canonical_json == other.canonical_json


def _nonblank(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    return value


def _fraction(value: StructuralNumber) -> Fraction | None:
    if isinstance(value, bool):
        return None
    try:
        result = value if isinstance(value, Fraction) else Fraction(value)
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    return result


def _rational_payload(value: Fraction) -> CanonicalObject:
    return {
        "denominator": value.denominator,
        "numerator": value.numerator,
    }


def _reviewed_conversion(unit: CanonicalUnit) -> ReviewedAffineConversion | None:
    rule = unit.conversion
    if rule is None or not rule.reviewed or unit.dimension == "package":
        return None
    if (
        _nonblank(unit.key) is None
        or _nonblank(unit.dimension) is None
        or _nonblank(unit.conversion_family) is None
        or _nonblank(rule.base_unit_key) is None
        or rule.base_dimension != unit.dimension
        or rule.base_conversion_family != unit.conversion_family
        or rule.scale_numerator <= 0
        or rule.scale_denominator <= 0
        or rule.offset_denominator <= 0
    ):
        return None
    return rule


def _canonical_unit(
    unit: CanonicalUnit,
) -> tuple[CanonicalObject, ReviewedAffineConversion | None] | None:
    key = _nonblank(unit.key)
    dimension = _nonblank(unit.dimension)
    family = _nonblank(unit.conversion_family)
    if key is None or dimension is None or family is None:
        return None

    rule = _reviewed_conversion(unit)
    if rule is None:
        return (
            {
                "dimension": dimension,
                "family": family,
                "key": key,
                "normalization": "curated_unit",
            },
            None,
        )
    return (
        {
            "dimension": dimension,
            "family": family,
            "key": rule.base_unit_key,
            "normalization": "reviewed_base",
        },
        rule,
    )


def _converted_value(
    value: StructuralNumber,
    rule: ReviewedAffineConversion | None,
) -> Fraction | None:
    result = _fraction(value)
    if result is None:
        return None
    if rule is None:
        return result
    offset = Fraction(rule.offset_numerator, rule.offset_denominator)
    scale = Fraction(rule.scale_numerator, rule.scale_denominator)
    return (result + offset) * scale


def _canonical_measure(
    measure: StructuralMeasure,
    semantic: MeasureSemantic,
) -> CanonicalObject | None:
    if measure.mode in _QUALITATIVE_MEASURE_MODES:
        if (
            semantic != "ingredient_amount"
            or measure.quantity_min is not None
            or measure.quantity_max is not None
            or measure.unit is not None
            or measure.package_size_identity is not None
        ):
            return None
        return {"mode": measure.mode}

    if measure.mode not in {"exact", "range"} or measure.unit is None:
        return None
    unit_result = _canonical_unit(measure.unit)
    if unit_result is None or measure.unit.dimension not in _SEMANTIC_DIMENSIONS[semantic]:
        return None
    canonical_unit, rule = unit_result

    if measure.package_size_identity is not None:
        if (
            semantic != "ingredient_amount"
            or measure.unit.dimension != "package"
            or _nonblank(measure.package_size_identity) is None
        ):
            return None

    minimum = (
        _converted_value(measure.quantity_min, rule) if measure.quantity_min is not None else None
    )
    maximum = (
        _converted_value(measure.quantity_max, rule) if measure.quantity_max is not None else None
    )
    if minimum is None:
        return None
    if semantic in {"ingredient_amount", "duration"} and minimum <= 0:
        return None

    if measure.mode == "exact":
        if maximum is not None:
            return None
        result: CanonicalObject = {
            "mode": "exact",
            "unit": canonical_unit,
            "value": _rational_payload(minimum),
        }
    else:
        if maximum is None or minimum >= maximum:
            return None
        if semantic in {"ingredient_amount", "duration"} and maximum <= 0:
            return None
        result = {
            "maximum": _rational_payload(maximum),
            "minimum": _rational_payload(minimum),
            "mode": "range",
            "unit": canonical_unit,
        }

    if measure.package_size_identity is not None:
        result["package_size"] = measure.package_size_identity
    return result


def _canonical_json(payload: CanonicalObject) -> str:
    return json.dumps(
        payload,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def build_structural_fingerprint(
    structure: RecipeStructure,
) -> StructuralFingerprint | None:
    """Return the version-1 fingerprint, or ``None`` for incomplete structure."""

    if not structure.ingredients or not structure.instructions:
        return None

    ingredient_cores: dict[str, CanonicalObject] = {}
    for ingredient in structure.ingredients:
        occurrence_key = _nonblank(ingredient.occurrence_key)
        ingredient_identity = _nonblank(ingredient.ingredient_identity)
        if (
            occurrence_key is None
            or ingredient_identity is None
            or ingredient.measure is None
            or occurrence_key in ingredient_cores
        ):
            return None
        measure = _canonical_measure(ingredient.measure, "ingredient_amount")
        if measure is None:
            return None
        ingredient_cores[occurrence_key] = {
            "ingredient": ingredient_identity,
            "measure": measure,
        }

    use_paths: dict[str, list[tuple[int, int, int]]] = {
        occurrence_key: [] for occurrence_key in ingredient_cores
    }
    for instruction_index, instruction in enumerate(structure.instructions):
        if not instruction.actions:
            return None
        for action_index, action in enumerate(instruction.actions):
            if _nonblank(action.action_type_key) is None:
                return None
            seen_inputs: set[str] = set()
            for input_index, occurrence_key in enumerate(action.ingredient_occurrence_keys):
                if occurrence_key not in ingredient_cores or occurrence_key in seen_inputs:
                    return None
                seen_inputs.add(occurrence_key)
                use_paths[occurrence_key].append((instruction_index, action_index, input_index))
            if (
                action.duration is not None
                and _canonical_measure(action.duration, "duration") is None
            ):
                return None
            if (
                action.temperature is not None
                and _canonical_measure(action.temperature, "temperature") is None
            ):
                return None

    occurrences_by_core: dict[str, list[str]] = {}
    core_by_json: dict[str, CanonicalObject] = {}
    for occurrence_key, core in ingredient_cores.items():
        core_json = _canonical_json(core)
        occurrences_by_core.setdefault(core_json, []).append(occurrence_key)
        core_by_json[core_json] = core

    token_by_occurrence: dict[str, str] = {}
    ingredients: list[CanonicalObject] = []
    next_token = 0
    for core_json in sorted(occurrences_by_core):
        ordered_occurrence_keys = sorted(
            occurrences_by_core[core_json],
            key=lambda occurrence_key: tuple(use_paths[occurrence_key]),
        )
        occurrence_tokens: list[str] = []
        for occurrence_key in ordered_occurrence_keys:
            token = f"ingredient:{next_token:04d}"
            next_token += 1
            token_by_occurrence[occurrence_key] = token
            occurrence_tokens.append(token)
        ingredients.append(
            {
                **core_by_json[core_json],
                "multiplicity": len(ordered_occurrence_keys),
                "occurrences": occurrence_tokens,
            }
        )

    instructions: list[CanonicalObject] = []
    for instruction in structure.instructions:
        actions: list[CanonicalObject] = []
        for action in instruction.actions:
            parameters: list[CanonicalObject] = []
            if action.duration is not None:
                duration = _canonical_measure(action.duration, "duration")
                if duration is None:  # Already checked; keep the narrowing local.
                    return None
                parameters.append({"measure": duration, "semantic": "duration"})
            if action.temperature is not None:
                temperature = _canonical_measure(action.temperature, "temperature")
                if temperature is None:  # Already checked; keep the narrowing local.
                    return None
                parameters.append({"measure": temperature, "semantic": "temperature"})
            actions.append(
                {
                    "action": action.action_type_key,
                    "inputs": [
                        token_by_occurrence[occurrence_key]
                        for occurrence_key in action.ingredient_occurrence_keys
                    ],
                    "parameters": parameters,
                }
            )
        instructions.append({"actions": actions})

    payload: CanonicalObject = {
        "ingredients": ingredients,
        "instructions": instructions,
        "schema": STRUCTURAL_FINGERPRINT_SCHEMA,
        "version": STRUCTURAL_FINGERPRINT_VERSION,
    }
    canonical_json = _canonical_json(payload)
    digest = sha256(canonical_json.encode("utf-8")).hexdigest()
    return StructuralFingerprint(
        version=STRUCTURAL_FINGERPRINT_VERSION,
        algorithm=STRUCTURAL_FINGERPRINT_ALGORITHM,
        algorithm_version=STRUCTURAL_FINGERPRINT_ALGORITHM_VERSION,
        digest=digest,
        canonical_payload=payload,
        canonical_json=canonical_json,
    )
