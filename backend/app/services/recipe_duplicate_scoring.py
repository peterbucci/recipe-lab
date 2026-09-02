"""Deterministic, explainable duplicate-candidate scoring for recipe structures.

The v1 scorer consumes only the canonical payload emitted by
``recipe-structure-v1``.  It deliberately has no access to recipe prose,
authorship, visibility, lineage, or publication state; callers own those policy
checks before invoking this pure function.

All arithmetic is exact ``Fraction`` arithmetic.  Ingredient identity uses a
multiset Dice coefficient.  Quantity coverage finds the single positive global
scale that maximizes exact, same-ingredient measure matching.  Structured action
features retain action and input order and compare duration/temperature values.
The versioned parameter document below is the complete scoring contract.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from fractions import Fraction
from hashlib import sha256
from typing import Literal, cast

from app.services.recipe_fingerprints import (
    STRUCTURAL_FINGERPRINT_ALGORITHM_VERSION,
    STRUCTURAL_FINGERPRINT_SCHEMA,
    STRUCTURAL_FINGERPRINT_VERSION,
    StructuralFingerprint,
)

DUPLICATE_CANDIDATE_SCORING_ALGORITHM_VERSION = "duplicate-candidate-similarity-v1"
SUPPORTED_RECIPE_STRUCTURE_VERSION = STRUCTURAL_FINGERPRINT_ALGORITHM_VERSION

INGREDIENT_MULTISET_WEIGHT = Fraction(9, 20)
NORMALIZED_QUANTITY_WEIGHT = Fraction(1, 4)
STRUCTURED_ACTION_WEIGHT = Fraction(3, 10)
ACTION_ORDER_SUBWEIGHT = Fraction(1, 2)
ORDERED_INPUT_SUBWEIGHT = Fraction(3, 10)
DURATION_TEMPERATURE_SUBWEIGHT = Fraction(1, 5)
PROBABLE_DUPLICATE_THRESHOLD = Fraction(4, 5)
PROBABLE_DUPLICATE_THRESHOLD_BASIS_POINTS = int(PROBABLE_DUPLICATE_THRESHOLD * 10_000)
MAX_DUPLICATE_REASONS = 3
MAX_DUPLICATE_INGREDIENT_OCCURRENCES = 200
MAX_DUPLICATE_ACTIONS = 500
MAX_DUPLICATE_FLATTENED_INPUTS = 2_000
MAX_DUPLICATE_PAIR_WORK_UNITS = 10_000_000
DUPLICATE_PAIR_WORK_ESTIMATE = (
    "(1 + 2 * left_ingredients * right_ingredients) * "
    "(left_ingredients + right_ingredients) + "
    "2 * left_actions * right_actions + left_inputs * right_inputs"
)

type DuplicateClassification = Literal[
    "exact_duplicate",
    "probable_duplicate",
    "distinct",
]
type DuplicateReasonCode = Literal[
    "exact_structural_match",
    "same_ingredient_multiset",
    "overlapping_ingredient_multisets",
    "different_ingredient_multisets",
    "proportionally_scaled_quantities",
    "matching_quantities",
    "partially_matching_quantities",
    "different_quantities",
    "matching_structured_actions",
    "different_action_types",
    "different_action_order",
    "different_ordered_inputs",
    "different_duration_or_temperature",
]
type JsonObject = dict[str, object]

EXACT_DUPLICATE_REASON_CODES = frozenset({"exact_structural_match"})
INGREDIENT_DUPLICATE_REASON_CODES = frozenset(
    {
        "same_ingredient_multiset",
        "overlapping_ingredient_multisets",
        "different_ingredient_multisets",
    }
)
QUANTITY_DUPLICATE_REASON_CODES = frozenset(
    {
        "proportionally_scaled_quantities",
        "matching_quantities",
        "partially_matching_quantities",
        "different_quantities",
    }
)
ACTION_DUPLICATE_REASON_CODES = frozenset(
    {
        "matching_structured_actions",
        "different_action_types",
        "different_action_order",
        "different_ordered_inputs",
        "different_duration_or_temperature",
    }
)

_PARAMETER_PAYLOAD: JsonObject = {
    "algorithm_version": DUPLICATE_CANDIDATE_SCORING_ALGORITHM_VERSION,
    "arithmetic": "exact_rational",
    "capacity": {
        "maximum_actions_per_structure": MAX_DUPLICATE_ACTIONS,
        "maximum_flattened_inputs_per_structure": MAX_DUPLICATE_FLATTENED_INPUTS,
        "maximum_ingredient_occurrences_per_structure": (MAX_DUPLICATE_INGREDIENT_OCCURRENCES),
        "maximum_nonexact_pair_work_units": MAX_DUPLICATE_PAIR_WORK_UNITS,
        "overflow_behavior": "fail_closed",
        "pair_work_estimate": DUPLICATE_PAIR_WORK_ESTIMATE,
    },
    "features": {
        "ingredient_multiset": {
            "metric": "multiset_dice",
            "weight": {"denominator": 20, "numerator": 9},
        },
        "normalized_quantities": {
            "candidate_scales": "compatible_same-ingredient_numeric_endpoints_plus_one",
            "measure_match": "same_mode_unit_package_and_all_scaled_endpoints",
            "metric": "maximum_same_ingredient_multiset_dice_under_one_positive_global_scale",
            "qualitative_match": "exact_mode_and_scale_neutral",
            "scale_tiebreak": ["prefer_one", "ascending_fraction"],
            "weight": {"denominator": 4, "numerator": 1},
        },
        "structured_actions": {
            "metric": "weighted_ordered_structural_features",
            "subweights": {
                "action_order": {
                    "metric": "lcs_dice_flattened_action_type_sequence",
                    "weight": {"denominator": 2, "numerator": 1},
                },
                "duration_temperature": {
                    "metric": "lcs_dice_action_type_duration_temperature_sequence",
                    "weight": {"denominator": 5, "numerator": 1},
                },
                "ordered_inputs": {
                    "metric": "lcs_dice_flattened_action_type_canonical_ingredient_sequence",
                    "weight": {"denominator": 10, "numerator": 3},
                },
            },
            "weight": {"denominator": 10, "numerator": 3},
        },
    },
    "exact_match": "same_structure_version_digest_and_canonical_json",
    "maximum_reasons": MAX_DUPLICATE_REASONS,
    "probable_duplicate_threshold_inclusive": True,
    "probable_duplicate_threshold": {"denominator": 5, "numerator": 4},
    "reason_family_order": ["exact", "ingredients", "quantities", "actions"],
    "reason_variants": {
        "actions": [
            "matching_structured_actions",
            "different_action_types",
            "different_action_order",
            "different_ordered_inputs",
            "different_duration_or_temperature",
        ],
        "exact": ["exact_structural_match"],
        "ingredients": [
            "same_ingredient_multiset",
            "overlapping_ingredient_multisets",
            "different_ingredient_multisets",
        ],
        "quantities": [
            "proportionally_scaled_quantities",
            "matching_quantities",
            "partially_matching_quantities",
            "different_quantities",
        ],
    },
    "supported_structure_versions": [SUPPORTED_RECIPE_STRUCTURE_VERSION],
}
DUPLICATE_CANDIDATE_PARAMETER_DOCUMENT = json.dumps(
    _PARAMETER_PAYLOAD,
    allow_nan=False,
    ensure_ascii=False,
    separators=(",", ":"),
    sort_keys=True,
)
DUPLICATE_CANDIDATE_PARAMETER_HASH = sha256(
    DUPLICATE_CANDIDATE_PARAMETER_DOCUMENT.encode("utf-8")
).hexdigest()

_REASON_MESSAGES: dict[DuplicateReasonCode, str] = {
    "exact_structural_match": "The complete canonical recipe structure matches exactly.",
    "same_ingredient_multiset": "The same canonical ingredients occur with the same multiplicity.",
    "overlapping_ingredient_multisets": "The recipes share canonical ingredient occurrences.",
    "different_ingredient_multisets": "The canonical ingredient multisets differ.",
    "proportionally_scaled_quantities": (
        "All matched ingredient quantities use one consistent proportional scale."
    ),
    "matching_quantities": "Canonical ingredient quantities match at the same scale.",
    "partially_matching_quantities": "Some canonical ingredient quantities match consistently.",
    "different_quantities": "Canonical ingredient quantities do not match consistently.",
    "matching_structured_actions": "Structured actions, inputs, durations, and temperatures match.",
    "different_action_types": "One or more structured cooking-action types differ.",
    "different_action_order": "The structured cooking-action order differs.",
    "different_ordered_inputs": "The ordered canonical inputs to cooking actions differ.",
    "different_duration_or_temperature": "A structured duration or temperature differs.",
}


class UnsupportedRecipeStructureVersionError(ValueError):
    """Raised when a caller tries to score a structure outside the v1 contract."""


class InvalidRecipeStructurePayloadError(ValueError):
    """Raised when a purported v1 canonical payload is malformed or inconsistent."""


class RecipeDuplicateScoringCapacityError(ValueError):
    """Raised before scoring when a structure exceeds the fixed v1 work budget."""


@dataclass(frozen=True, slots=True)
class DuplicateCandidateFingerprint:
    """The persisted fingerprint fields required by the pure scorer."""

    algorithm_version: str
    digest: str
    canonical_json: str

    @classmethod
    def from_structural_fingerprint(
        cls,
        fingerprint: StructuralFingerprint,
    ) -> DuplicateCandidateFingerprint:
        return cls(
            algorithm_version=fingerprint.algorithm_version,
            digest=fingerprint.digest,
            canonical_json=fingerprint.canonical_json,
        )


@dataclass(frozen=True, slots=True)
class DuplicateCandidateReason:
    code: DuplicateReasonCode
    message: str


@dataclass(frozen=True, slots=True)
class DuplicateCandidateScoreComponents:
    ingredient_multiset: Fraction
    normalized_quantities: Fraction
    action_order: Fraction
    ordered_inputs: Fraction
    duration_temperature: Fraction
    structured_actions: Fraction


@dataclass(frozen=True, slots=True)
class DuplicateCandidateScore:
    algorithm_version: str
    parameter_hash: str
    classification: DuplicateClassification
    score: Fraction
    exact_match: bool
    probable_duplicate: bool
    quantity_scale: Fraction
    components: DuplicateCandidateScoreComponents
    reasons: tuple[DuplicateCandidateReason, ...]


@dataclass(frozen=True, slots=True)
class _Measure:
    mode: str
    unit_semantics: str | None
    package_size: str | None
    values: tuple[Fraction, ...]

    @property
    def is_numeric(self) -> bool:
        return bool(self.values)

    def scaled_signature(self, scale: Fraction) -> tuple[object, ...]:
        applied_scale = scale if self.is_numeric else Fraction(1)
        return (
            self.mode,
            self.unit_semantics,
            self.package_size,
            tuple(value * applied_scale for value in self.values),
        )


@dataclass(frozen=True, slots=True)
class _IngredientOccurrence:
    ingredient_identity: str
    measure: _Measure


@dataclass(frozen=True, slots=True)
class _Action:
    action_type: str
    inputs: tuple[str, ...]
    duration: _Measure | None
    temperature: _Measure | None


@dataclass(frozen=True, slots=True)
class _ParsedStructure:
    ingredients: tuple[_IngredientOccurrence, ...]
    actions: tuple[_Action, ...]


@dataclass(frozen=True, slots=True)
class RecipeDuplicateScoringShape:
    """Counts used for a conservative, deterministic pre-scoring work estimate."""

    ingredient_occurrences: int
    actions: int
    flattened_inputs: int


def _invalid(detail: str) -> InvalidRecipeStructurePayloadError:
    return InvalidRecipeStructurePayloadError(f"invalid recipe-structure-v1 payload: {detail}")


def _object(value: object, detail: str) -> JsonObject:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise _invalid(detail)
    return cast(JsonObject, value)


def _list(value: object, detail: str) -> list[object]:
    if not isinstance(value, list):
        raise _invalid(detail)
    return cast(list[object], value)


def _string(value: object, detail: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise _invalid(detail)
    return value


def _positive_int(value: object, detail: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise _invalid(detail)
    return value


def _fraction(value: object, detail: str) -> Fraction:
    payload = _object(value, detail)
    if set(payload) != {"denominator", "numerator"}:
        raise _invalid(detail)
    numerator = payload["numerator"]
    denominator = payload["denominator"]
    if (
        isinstance(numerator, bool)
        or not isinstance(numerator, int)
        or isinstance(denominator, bool)
        or not isinstance(denominator, int)
        or denominator <= 0
    ):
        raise _invalid(detail)
    result = Fraction(numerator, denominator)
    if result.numerator != numerator or result.denominator != denominator:
        raise _invalid(f"{detail} is not a reduced rational")
    return result


def _measure(value: object, detail: str) -> _Measure:
    payload = _object(value, detail)
    mode = _string(payload.get("mode"), f"{detail}.mode")
    if mode in {"to_taste", "as_needed", "unspecified"}:
        if set(payload) != {"mode"}:
            raise _invalid(detail)
        return _Measure(mode=mode, unit_semantics=None, package_size=None, values=())
    if mode not in {"exact", "range"}:
        raise _invalid(f"{detail}.mode")

    expected_keys = (
        {"mode", "unit", "value"}
        if mode == "exact"
        else {
            "maximum",
            "minimum",
            "mode",
            "unit",
        }
    )
    if "package_size" in payload:
        expected_keys.add("package_size")
    if set(payload) != expected_keys:
        raise _invalid(detail)

    unit = _object(payload["unit"], f"{detail}.unit")
    if set(unit) != {"dimension", "family", "key", "normalization"}:
        raise _invalid(f"{detail}.unit")
    for key in ("dimension", "family", "key", "normalization"):
        _string(unit[key], f"{detail}.unit.{key}")
    unit_semantics = json.dumps(
        unit,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    package_size = None
    if "package_size" in payload:
        package_size = _string(payload["package_size"], f"{detail}.package_size")

    values: tuple[Fraction, ...]
    if mode == "exact":
        values = (_fraction(payload["value"], f"{detail}.value"),)
    else:
        minimum = _fraction(payload["minimum"], f"{detail}.minimum")
        maximum = _fraction(payload["maximum"], f"{detail}.maximum")
        if minimum >= maximum:
            raise _invalid(detail)
        values = (minimum, maximum)
    return _Measure(
        mode=mode,
        unit_semantics=unit_semantics,
        package_size=package_size,
        values=values,
    )


def _parse_structure(fingerprint: DuplicateCandidateFingerprint) -> _ParsedStructure:
    if fingerprint.algorithm_version != SUPPORTED_RECIPE_STRUCTURE_VERSION:
        raise UnsupportedRecipeStructureVersionError(
            "duplicate-candidate-similarity-v1 supports only recipe-structure-v1; "
            f"received {fingerprint.algorithm_version!r}"
        )
    try:
        raw_payload: object = json.loads(fingerprint.canonical_json)
    except (json.JSONDecodeError, TypeError) as exc:
        raise _invalid("canonical JSON") from exc
    payload = _object(raw_payload, "root")
    if set(payload) != {"ingredients", "instructions", "schema", "version"}:
        raise _invalid("root")
    if payload["schema"] != STRUCTURAL_FINGERPRINT_SCHEMA:
        raise _invalid("schema")
    if payload["version"] != STRUCTURAL_FINGERPRINT_VERSION:
        raise _invalid("version")

    occurrence_identity: dict[str, str] = {}
    ingredients: list[_IngredientOccurrence] = []
    raw_ingredients = _list(payload["ingredients"], "ingredients")
    if not raw_ingredients:
        raise _invalid("ingredients")
    ingredient_occurrence_count = 0
    for index, value in enumerate(raw_ingredients):
        item = _object(value, f"ingredients[{index}]")
        if set(item) != {"ingredient", "measure", "multiplicity", "occurrences"}:
            raise _invalid(f"ingredients[{index}]")
        identity = _string(item["ingredient"], f"ingredients[{index}].ingredient")
        measure = _measure(item["measure"], f"ingredients[{index}].measure")
        multiplicity = _positive_int(item["multiplicity"], f"ingredients[{index}].multiplicity")
        occurrences = _list(item["occurrences"], f"ingredients[{index}].occurrences")
        if len(occurrences) != multiplicity:
            raise _invalid(f"ingredients[{index}].occurrences")
        ingredient_occurrence_count += len(occurrences)
        if ingredient_occurrence_count > MAX_DUPLICATE_INGREDIENT_OCCURRENCES:
            raise RecipeDuplicateScoringCapacityError(
                "Recipe structure exceeds the ingredient-occurrence scoring budget."
            )
        for occurrence in occurrences:
            token = _string(occurrence, f"ingredients[{index}].occurrences")
            if token in occurrence_identity:
                raise _invalid("duplicate ingredient occurrence token")
            occurrence_identity[token] = identity
            ingredients.append(_IngredientOccurrence(identity, measure))

    actions: list[_Action] = []
    flattened_input_count = 0
    raw_instructions = _list(payload["instructions"], "instructions")
    if not raw_instructions:
        raise _invalid("instructions")
    for instruction_index, value in enumerate(raw_instructions):
        instruction = _object(value, f"instructions[{instruction_index}]")
        if set(instruction) != {"actions"}:
            raise _invalid(f"instructions[{instruction_index}]")
        raw_actions = _list(instruction["actions"], f"instructions[{instruction_index}].actions")
        if not raw_actions:
            raise _invalid(f"instructions[{instruction_index}].actions")
        for action_index, action_value in enumerate(raw_actions):
            if len(actions) >= MAX_DUPLICATE_ACTIONS:
                raise RecipeDuplicateScoringCapacityError(
                    "Recipe structure exceeds the structured-action scoring budget."
                )
            detail = f"instructions[{instruction_index}].actions[{action_index}]"
            action = _object(action_value, detail)
            if set(action) != {"action", "inputs", "parameters"}:
                raise _invalid(detail)
            action_type = _string(action["action"], f"{detail}.action")
            input_tokens = _list(action["inputs"], f"{detail}.inputs")
            flattened_input_count += len(input_tokens)
            if flattened_input_count > MAX_DUPLICATE_FLATTENED_INPUTS:
                raise RecipeDuplicateScoringCapacityError(
                    "Recipe structure exceeds the ordered-input scoring budget."
                )
            seen_inputs: set[str] = set()
            inputs: list[str] = []
            for input_value in input_tokens:
                token = _string(input_value, f"{detail}.inputs")
                if token in seen_inputs or token not in occurrence_identity:
                    raise _invalid(f"{detail}.inputs")
                seen_inputs.add(token)
                inputs.append(occurrence_identity[token])

            duration: _Measure | None = None
            temperature: _Measure | None = None
            for parameter_value in _list(action["parameters"], f"{detail}.parameters"):
                parameter = _object(parameter_value, f"{detail}.parameters")
                if set(parameter) != {"measure", "semantic"}:
                    raise _invalid(f"{detail}.parameters")
                semantic = _string(parameter["semantic"], f"{detail}.parameters.semantic")
                parsed_measure = _measure(parameter["measure"], f"{detail}.parameters.measure")
                if semantic == "duration" and duration is None:
                    duration = parsed_measure
                elif semantic == "temperature" and temperature is None:
                    temperature = parsed_measure
                else:
                    raise _invalid(f"{detail}.parameters")
            actions.append(_Action(action_type, tuple(inputs), duration, temperature))
    return _ParsedStructure(tuple(ingredients), tuple(actions))


def validate_recipe_duplicate_scoring_capacity(
    fingerprint: DuplicateCandidateFingerprint | StructuralFingerprint,
) -> None:
    """Validate one fingerprint and enforce the fixed v1 structural work budget."""

    _parse_structure(_coerce_fingerprint(fingerprint))


def get_recipe_duplicate_scoring_shape(
    fingerprint: DuplicateCandidateFingerprint | StructuralFingerprint,
) -> RecipeDuplicateScoringShape:
    """Parse one bounded structure and return only its scoring dimensions."""

    parsed = _parse_structure(_coerce_fingerprint(fingerprint))
    return RecipeDuplicateScoringShape(
        ingredient_occurrences=len(parsed.ingredients),
        actions=len(parsed.actions),
        flattened_inputs=sum(len(action.inputs) for action in parsed.actions),
    )


def get_recipe_duplicate_canonical_ingredient_identities(
    fingerprint: DuplicateCandidateFingerprint | StructuralFingerprint,
) -> tuple[str, ...]:
    """Return the stable, distinct ingredient identities used for shortlisting."""

    parsed = _parse_structure(_coerce_fingerprint(fingerprint))
    return tuple(sorted({item.ingredient_identity for item in parsed.ingredients}))


def estimate_recipe_duplicate_pair_work(
    left: RecipeDuplicateScoringShape,
    right: RecipeDuplicateScoringShape,
) -> int:
    """Conservatively bound v1 quantity scans and dynamic-programming cells."""

    quantity_work = (1 + 2 * left.ingredient_occurrences * right.ingredient_occurrences) * (
        left.ingredient_occurrences + right.ingredient_occurrences
    )
    action_work = 2 * left.actions * right.actions
    input_work = left.flattened_inputs * right.flattened_inputs
    return quantity_work + action_work + input_work


def recipe_duplicate_fingerprints_are_exact(
    left: DuplicateCandidateFingerprint,
    right: DuplicateCandidateFingerprint,
) -> bool:
    """Confirm exact structural identity without trusting a digest match alone."""

    return (
        left.algorithm_version == right.algorithm_version
        and left.digest == right.digest
        and left.canonical_json == right.canonical_json
    )


def _dice(matched: int, left_count: int, right_count: int) -> Fraction:
    total = left_count + right_count
    if total == 0:
        return Fraction(1)
    return Fraction(2 * matched, total)


def _ingredient_score(left: _ParsedStructure, right: _ParsedStructure) -> Fraction:
    left_counts = Counter(item.ingredient_identity for item in left.ingredients)
    right_counts = Counter(item.ingredient_identity for item in right.ingredients)
    matched = sum((left_counts & right_counts).values())
    return _dice(matched, len(left.ingredients), len(right.ingredients))


def _compatible_numeric(left: _Measure, right: _Measure) -> bool:
    return (
        left.is_numeric
        and right.is_numeric
        and left.mode == right.mode
        and left.unit_semantics == right.unit_semantics
        and left.package_size == right.package_size
    )


def _candidate_scales(
    left: _ParsedStructure,
    right: _ParsedStructure,
) -> tuple[Fraction, ...]:
    right_by_ingredient: dict[str, list[_Measure]] = defaultdict(list)
    for occurrence in right.ingredients:
        right_by_ingredient[occurrence.ingredient_identity].append(occurrence.measure)

    scales = {Fraction(1)}
    for occurrence in left.ingredients:
        for other in right_by_ingredient[occurrence.ingredient_identity]:
            if not _compatible_numeric(occurrence.measure, other):
                continue
            for left_value, right_value in zip(
                occurrence.measure.values,
                other.values,
                strict=True,
            ):
                if left_value != 0:
                    scale = right_value / left_value
                    if scale > 0:
                        scales.add(scale)
    return tuple(sorted(scales, key=lambda scale: (scale != 1, scale)))


def _quantity_matches(
    left: _ParsedStructure,
    right: _ParsedStructure,
    scale: Fraction,
) -> int:
    left_counts = Counter(
        (item.ingredient_identity, item.measure.scaled_signature(scale))
        for item in left.ingredients
    )
    right_counts = Counter(
        (item.ingredient_identity, item.measure.scaled_signature(Fraction(1)))
        for item in right.ingredients
    )
    return sum((left_counts & right_counts).values())


def _quantity_score(
    left: _ParsedStructure,
    right: _ParsedStructure,
) -> tuple[Fraction, Fraction]:
    best_scale = Fraction(1)
    best_matches = -1
    for scale in _candidate_scales(left, right):
        matches = _quantity_matches(left, right, scale)
        if matches > best_matches:
            best_matches = matches
            best_scale = scale
    return (
        _dice(best_matches, len(left.ingredients), len(right.ingredients)),
        best_scale,
    )


def _lcs_length(left: tuple[object, ...], right: tuple[object, ...]) -> int:
    previous = [0] * (len(right) + 1)
    for left_item in left:
        current = [0]
        for right_index, right_item in enumerate(right, start=1):
            if left_item == right_item:
                current.append(previous[right_index - 1] + 1)
            else:
                current.append(max(previous[right_index], current[-1]))
        previous = current
    return previous[-1]


def _action_scores(
    left: _ParsedStructure,
    right: _ParsedStructure,
) -> tuple[Fraction, Fraction, Fraction, Fraction]:
    left_action_types = tuple(action.action_type for action in left.actions)
    right_action_types = tuple(action.action_type for action in right.actions)
    action_order = _dice(
        _lcs_length(left_action_types, right_action_types),
        len(left.actions),
        len(right.actions),
    )

    left_inputs: tuple[object, ...] = tuple(
        (action.action_type, ingredient_identity)
        for action in left.actions
        for ingredient_identity in action.inputs
    )
    right_inputs: tuple[object, ...] = tuple(
        (action.action_type, ingredient_identity)
        for action in right.actions
        for ingredient_identity in action.inputs
    )
    ordered_inputs = _dice(
        _lcs_length(left_inputs, right_inputs),
        len(left_inputs),
        len(right_inputs),
    )

    left_parameters: tuple[object, ...] = tuple(
        (action.action_type, action.duration, action.temperature) for action in left.actions
    )
    right_parameters: tuple[object, ...] = tuple(
        (action.action_type, action.duration, action.temperature) for action in right.actions
    )
    duration_temperature = _dice(
        _lcs_length(left_parameters, right_parameters),
        len(left_parameters),
        len(right_parameters),
    )
    structured_actions = (
        ACTION_ORDER_SUBWEIGHT * action_order
        + ORDERED_INPUT_SUBWEIGHT * ordered_inputs
        + DURATION_TEMPERATURE_SUBWEIGHT * duration_temperature
    )
    return action_order, ordered_inputs, duration_temperature, structured_actions


def _reason(code: DuplicateReasonCode) -> DuplicateCandidateReason:
    return DuplicateCandidateReason(code=code, message=_REASON_MESSAGES[code])


def _reasons(
    *,
    exact_match: bool,
    action_types_match: bool,
    components: DuplicateCandidateScoreComponents,
    quantity_scale: Fraction,
) -> tuple[DuplicateCandidateReason, ...]:
    if exact_match:
        return (_reason("exact_structural_match"),)

    if components.ingredient_multiset == 1:
        ingredient_reason: DuplicateReasonCode = "same_ingredient_multiset"
    elif components.ingredient_multiset > 0:
        ingredient_reason = "overlapping_ingredient_multisets"
    else:
        ingredient_reason = "different_ingredient_multisets"

    if components.normalized_quantities == 1 and quantity_scale != 1:
        quantity_reason: DuplicateReasonCode = "proportionally_scaled_quantities"
    elif components.normalized_quantities == 1:
        quantity_reason = "matching_quantities"
    elif components.normalized_quantities > 0:
        quantity_reason = "partially_matching_quantities"
    else:
        quantity_reason = "different_quantities"

    if components.structured_actions == 1:
        action_reason: DuplicateReasonCode = "matching_structured_actions"
    elif not action_types_match:
        action_reason = "different_action_types"
    elif components.action_order < 1:
        action_reason = "different_action_order"
    elif components.ordered_inputs < 1:
        action_reason = "different_ordered_inputs"
    else:
        action_reason = "different_duration_or_temperature"

    return tuple(
        _reason(code)
        for code in (ingredient_reason, quantity_reason, action_reason)[:MAX_DUPLICATE_REASONS]
    )


def _coerce_fingerprint(
    fingerprint: DuplicateCandidateFingerprint | StructuralFingerprint,
) -> DuplicateCandidateFingerprint:
    if isinstance(fingerprint, DuplicateCandidateFingerprint):
        return fingerprint
    return DuplicateCandidateFingerprint.from_structural_fingerprint(fingerprint)


def score_recipe_duplicate_candidates(
    left_fingerprint: DuplicateCandidateFingerprint | StructuralFingerprint,
    right_fingerprint: DuplicateCandidateFingerprint | StructuralFingerprint,
) -> DuplicateCandidateScore:
    """Classify one canonical recipe pair under the immutable v1 contract."""

    left_input = _coerce_fingerprint(left_fingerprint)
    right_input = _coerce_fingerprint(right_fingerprint)
    left = _parse_structure(left_input)
    right = _parse_structure(right_input)

    exact_match = recipe_duplicate_fingerprints_are_exact(left_input, right_input)
    if exact_match:
        components = DuplicateCandidateScoreComponents(
            ingredient_multiset=Fraction(1),
            normalized_quantities=Fraction(1),
            action_order=Fraction(1),
            ordered_inputs=Fraction(1),
            duration_temperature=Fraction(1),
            structured_actions=Fraction(1),
        )
        return DuplicateCandidateScore(
            algorithm_version=DUPLICATE_CANDIDATE_SCORING_ALGORITHM_VERSION,
            parameter_hash=DUPLICATE_CANDIDATE_PARAMETER_HASH,
            classification="exact_duplicate",
            score=Fraction(1),
            exact_match=True,
            probable_duplicate=False,
            quantity_scale=Fraction(1),
            components=components,
            reasons=(_reason("exact_structural_match"),),
        )

    left_shape = RecipeDuplicateScoringShape(
        ingredient_occurrences=len(left.ingredients),
        actions=len(left.actions),
        flattened_inputs=sum(len(action.inputs) for action in left.actions),
    )
    right_shape = RecipeDuplicateScoringShape(
        ingredient_occurrences=len(right.ingredients),
        actions=len(right.actions),
        flattened_inputs=sum(len(action.inputs) for action in right.actions),
    )
    if estimate_recipe_duplicate_pair_work(left_shape, right_shape) > (
        MAX_DUPLICATE_PAIR_WORK_UNITS
    ):
        raise RecipeDuplicateScoringCapacityError(
            "Recipe pair exceeds the duplicate-scoring work budget."
        )
    ingredient_multiset = _ingredient_score(left, right)
    normalized_quantities, quantity_scale = _quantity_score(left, right)
    action_order, ordered_inputs, duration_temperature, structured_actions = _action_scores(
        left, right
    )
    components = DuplicateCandidateScoreComponents(
        ingredient_multiset=ingredient_multiset,
        normalized_quantities=normalized_quantities,
        action_order=action_order,
        ordered_inputs=ordered_inputs,
        duration_temperature=duration_temperature,
        structured_actions=structured_actions,
    )
    score = (
        INGREDIENT_MULTISET_WEIGHT * ingredient_multiset
        + NORMALIZED_QUANTITY_WEIGHT * normalized_quantities
        + STRUCTURED_ACTION_WEIGHT * structured_actions
    )
    if score >= PROBABLE_DUPLICATE_THRESHOLD:
        classification: DuplicateClassification = "probable_duplicate"
    else:
        classification = "distinct"

    return DuplicateCandidateScore(
        algorithm_version=DUPLICATE_CANDIDATE_SCORING_ALGORITHM_VERSION,
        parameter_hash=DUPLICATE_CANDIDATE_PARAMETER_HASH,
        classification=classification,
        score=score,
        exact_match=exact_match,
        probable_duplicate=classification == "probable_duplicate",
        quantity_scale=quantity_scale,
        components=components,
        reasons=_reasons(
            exact_match=exact_match,
            action_types_match=(
                Counter(action.action_type for action in left.actions)
                == Counter(action.action_type for action in right.actions)
            ),
            components=components,
            quantity_scale=quantity_scale,
        ),
    )


# Singular alias for adapters that score one existing candidate at a time.
score_recipe_duplicate_candidate = score_recipe_duplicate_candidates
