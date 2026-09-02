from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import cast
from uuid import UUID

from .dataset import canonical_json
from .json_codec import (
    JsonCodecError,
    JsonDocumentLimits,
    decode_json_document,
    load_json_document,
)
from .substitution_rules import (
    CuratedSubstitution,
    SubstitutionCatalog,
    SubstitutionConstraints,
    SubstitutionIngredient,
    SubstitutionRecipeContext,
    SubstitutionTaxonomyTerm,
    validate_substitution_catalog,
)

SUBSTITUTION_BENCHMARK_SCHEMA_VERSION = "recipe-lab-substitution-benchmark-v1"
_CASE_ID_PATTERN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
_SUBSTITUTION_JSON_LIMITS = JsonDocumentLimits(
    maximum_utf8_bytes=32 * 1024 * 1024,
    maximum_depth=32,
    maximum_nodes=1_000_000,
)


class SubstitutionBenchmarkError(ValueError):
    """Raised when a substitution benchmark violates its strict contract."""


@dataclass(frozen=True, slots=True)
class SubstitutionPreferenceWeight:
    ingredient_id: UUID
    weight: int


@dataclass(frozen=True, slots=True)
class SubstitutionBenchmarkCase:
    id: str
    source_ingredient_id: UUID
    recipe_context_id: UUID
    constraints: SubstitutionConstraints
    preference_weights: tuple[SubstitutionPreferenceWeight, ...]
    limit: int
    expected_ranking: tuple[UUID, ...]


@dataclass(frozen=True, slots=True)
class SubstitutionBenchmark:
    schema_version: str
    benchmark_id: str
    limitations: tuple[str, ...]
    catalog: SubstitutionCatalog
    cases: tuple[SubstitutionBenchmarkCase, ...]
    sha256: str


def _object(value: object, *, path: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise SubstitutionBenchmarkError(f"{path} must be an object")
    return cast(dict[str, object], value)


def _array(value: object, *, path: str) -> list[object]:
    if not isinstance(value, list):
        raise SubstitutionBenchmarkError(f"{path} must be an array")
    return cast(list[object], value)


def _exact_keys(
    value: dict[str, object],
    *,
    expected: frozenset[str],
    path: str,
) -> None:
    actual = frozenset(value)
    if actual != expected:
        raise SubstitutionBenchmarkError(f"{path} has invalid keys; expected {sorted(expected)!r}")


def _string(value: object, *, path: str) -> str:
    if type(value) is not str or not value.strip():
        raise SubstitutionBenchmarkError(f"{path} must be a non-blank string")
    return value


def _optional_string(value: object, *, path: str) -> str | None:
    if value is None:
        return None
    return _string(value, path=path)


def _uuid(value: object, *, path: str) -> UUID:
    raw = _string(value, path=path)
    try:
        parsed = UUID(raw)
    except ValueError as error:
        raise SubstitutionBenchmarkError(f"{path} must be a UUID") from error
    if raw != str(parsed):
        raise SubstitutionBenchmarkError(f"{path} must use canonical lowercase UUID syntax")
    return parsed


def _uuid_array(value: object, *, path: str) -> tuple[UUID, ...]:
    parsed = tuple(
        _uuid(item, path=f"{path}[{index}]") for index, item in enumerate(_array(value, path=path))
    )
    if len(parsed) != len(set(parsed)):
        raise SubstitutionBenchmarkError(f"{path} must not contain duplicates")
    return parsed


def _integer(value: object, *, path: str, minimum: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise SubstitutionBenchmarkError(f"{path} must be an integer")
    if minimum is not None and value < minimum:
        raise SubstitutionBenchmarkError(f"{path} must be at least {minimum}")
    return value


def _optional_decimal(value: object, *, path: str) -> Decimal | None:
    if value is None:
        return None
    raw = _string(value, path=path)
    try:
        parsed = Decimal(raw)
    except InvalidOperation as error:
        raise SubstitutionBenchmarkError(f"{path} must be a decimal string") from error
    if not parsed.is_finite():
        raise SubstitutionBenchmarkError(f"{path} must be finite")
    return parsed


_TOP_LEVEL_KEYS = frozenset(
    {
        "schema_version",
        "benchmark_id",
        "limitations",
        "catalog",
        "cases",
    }
)
_CATALOG_KEYS = frozenset(
    {
        "dataset_id",
        "dietary_flags",
        "allergens",
        "ingredients",
        "relationships",
        "recipe_contexts",
    }
)
_TERM_KEYS = frozenset({"id", "name"})
_INGREDIENT_KEYS = frozenset({"id", "name", "dietary_flag_ids", "allergen_ids"})
_RELATIONSHIP_KEYS = frozenset(
    {
        "id",
        "source_ingredient_id",
        "replacement_ingredient_id",
        "quantity_ratio",
        "guidance",
        "notes",
        "provenance",
        "relationship_confidence",
    }
)
_RECIPE_CONTEXT_KEYS = frozenset({"id", "ingredient_ids"})
_CASE_KEYS = frozenset(
    {
        "id",
        "source_ingredient_id",
        "recipe_context_id",
        "required_dietary_flag_ids",
        "excluded_allergen_ids",
        "preference_weights",
        "limit",
        "expected_ranking",
    }
)
_PREFERENCE_KEYS = frozenset({"ingredient_id", "weight"})


def _parse_terms(value: object, *, path: str) -> tuple[SubstitutionTaxonomyTerm, ...]:
    terms: list[SubstitutionTaxonomyTerm] = []
    for index, raw in enumerate(_array(value, path=path)):
        item_path = f"{path}[{index}]"
        item = _object(raw, path=item_path)
        _exact_keys(item, expected=_TERM_KEYS, path=item_path)
        terms.append(
            SubstitutionTaxonomyTerm(
                id=_uuid(item["id"], path=f"{item_path}.id"),
                name=_string(item["name"], path=f"{item_path}.name"),
            )
        )
    return tuple(terms)


def _parse_catalog(value: object) -> SubstitutionCatalog:
    document = _object(value, path="catalog")
    _exact_keys(document, expected=_CATALOG_KEYS, path="catalog")
    ingredients: list[SubstitutionIngredient] = []
    for index, raw in enumerate(_array(document["ingredients"], path="catalog.ingredients")):
        path = f"catalog.ingredients[{index}]"
        item = _object(raw, path=path)
        _exact_keys(item, expected=_INGREDIENT_KEYS, path=path)
        ingredients.append(
            SubstitutionIngredient(
                id=_uuid(item["id"], path=f"{path}.id"),
                name=_string(item["name"], path=f"{path}.name"),
                dietary_flag_ids=frozenset(
                    _uuid_array(item["dietary_flag_ids"], path=f"{path}.dietary_flag_ids")
                ),
                allergen_ids=frozenset(
                    _uuid_array(item["allergen_ids"], path=f"{path}.allergen_ids")
                ),
            )
        )

    relationships: list[CuratedSubstitution] = []
    for index, raw in enumerate(_array(document["relationships"], path="catalog.relationships")):
        path = f"catalog.relationships[{index}]"
        item = _object(raw, path=path)
        _exact_keys(item, expected=_RELATIONSHIP_KEYS, path=path)
        relationships.append(
            CuratedSubstitution(
                id=_uuid(item["id"], path=f"{path}.id"),
                source_ingredient_id=_uuid(
                    item["source_ingredient_id"], path=f"{path}.source_ingredient_id"
                ),
                replacement_ingredient_id=_uuid(
                    item["replacement_ingredient_id"],
                    path=f"{path}.replacement_ingredient_id",
                ),
                quantity_ratio=_optional_decimal(
                    item["quantity_ratio"], path=f"{path}.quantity_ratio"
                ),
                guidance=_optional_string(item["guidance"], path=f"{path}.guidance"),
                notes=_optional_string(item["notes"], path=f"{path}.notes"),
                provenance=_optional_string(item["provenance"], path=f"{path}.provenance"),
                relationship_confidence=_optional_decimal(
                    item["relationship_confidence"],
                    path=f"{path}.relationship_confidence",
                ),
            )
        )

    recipe_contexts: list[SubstitutionRecipeContext] = []
    for index, raw in enumerate(
        _array(document["recipe_contexts"], path="catalog.recipe_contexts")
    ):
        path = f"catalog.recipe_contexts[{index}]"
        item = _object(raw, path=path)
        _exact_keys(item, expected=_RECIPE_CONTEXT_KEYS, path=path)
        recipe_contexts.append(
            SubstitutionRecipeContext(
                id=_uuid(item["id"], path=f"{path}.id"),
                ingredient_ids=frozenset(
                    _uuid_array(item["ingredient_ids"], path=f"{path}.ingredient_ids")
                ),
            )
        )

    return SubstitutionCatalog(
        dataset_id=_string(document["dataset_id"], path="catalog.dataset_id"),
        dietary_flags=_parse_terms(document["dietary_flags"], path="catalog.dietary_flags"),
        allergens=_parse_terms(document["allergens"], path="catalog.allergens"),
        ingredients=tuple(ingredients),
        relationships=tuple(relationships),
        recipe_contexts=tuple(recipe_contexts),
    )


def _parse_cases(value: object) -> tuple[SubstitutionBenchmarkCase, ...]:
    cases: list[SubstitutionBenchmarkCase] = []
    for index, raw in enumerate(_array(value, path="cases")):
        path = f"cases[{index}]"
        item = _object(raw, path=path)
        _exact_keys(item, expected=_CASE_KEYS, path=path)
        case_id = _string(item["id"], path=f"{path}.id")
        if _CASE_ID_PATTERN.fullmatch(case_id) is None:
            raise SubstitutionBenchmarkError(f"{path}.id must be a lowercase slug")
        preferences: list[SubstitutionPreferenceWeight] = []
        for preference_index, preference_raw in enumerate(
            _array(item["preference_weights"], path=f"{path}.preference_weights")
        ):
            preference_path = f"{path}.preference_weights[{preference_index}]"
            preference = _object(preference_raw, path=preference_path)
            _exact_keys(preference, expected=_PREFERENCE_KEYS, path=preference_path)
            weight = _integer(preference["weight"], path=f"{preference_path}.weight")
            if weight == 0:
                raise SubstitutionBenchmarkError(
                    f"{preference_path}.weight must be nonzero when present"
                )
            preferences.append(
                SubstitutionPreferenceWeight(
                    ingredient_id=_uuid(
                        preference["ingredient_id"],
                        path=f"{preference_path}.ingredient_id",
                    ),
                    weight=weight,
                )
            )
        if len({item.ingredient_id for item in preferences}) != len(preferences):
            raise SubstitutionBenchmarkError(f"{path}.preference_weights repeats an ingredient")
        cases.append(
            SubstitutionBenchmarkCase(
                id=case_id,
                source_ingredient_id=_uuid(
                    item["source_ingredient_id"], path=f"{path}.source_ingredient_id"
                ),
                recipe_context_id=_uuid(
                    item["recipe_context_id"], path=f"{path}.recipe_context_id"
                ),
                constraints=SubstitutionConstraints(
                    required_dietary_flag_ids=frozenset(
                        _uuid_array(
                            item["required_dietary_flag_ids"],
                            path=f"{path}.required_dietary_flag_ids",
                        )
                    ),
                    excluded_allergen_ids=frozenset(
                        _uuid_array(
                            item["excluded_allergen_ids"],
                            path=f"{path}.excluded_allergen_ids",
                        )
                    ),
                ),
                preference_weights=tuple(preferences),
                limit=_integer(item["limit"], path=f"{path}.limit", minimum=1),
                expected_ranking=_uuid_array(
                    item["expected_ranking"], path=f"{path}.expected_ranking"
                ),
            )
        )
    return tuple(cases)


def _normalized_document(
    *,
    schema_version: str,
    benchmark_id: str,
    limitations: tuple[str, ...],
    catalog: SubstitutionCatalog,
    cases: tuple[SubstitutionBenchmarkCase, ...],
) -> dict[str, object]:
    return {
        "schema_version": schema_version,
        "benchmark_id": benchmark_id,
        "limitations": list(sorted(limitations)),
        "catalog": {
            "dataset_id": catalog.dataset_id,
            "dietary_flags": [
                {"id": str(item.id), "name": item.name}
                for item in sorted(catalog.dietary_flags, key=lambda item: item.id.int)
            ],
            "allergens": [
                {"id": str(item.id), "name": item.name}
                for item in sorted(catalog.allergens, key=lambda item: item.id.int)
            ],
            "ingredients": [
                {
                    "id": str(item.id),
                    "name": item.name,
                    "dietary_flag_ids": [
                        str(value) for value in sorted(item.dietary_flag_ids, key=lambda x: x.int)
                    ],
                    "allergen_ids": [
                        str(value) for value in sorted(item.allergen_ids, key=lambda x: x.int)
                    ],
                }
                for item in sorted(catalog.ingredients, key=lambda item: item.id.int)
            ],
            "relationships": [
                {
                    "id": str(item.id),
                    "source_ingredient_id": str(item.source_ingredient_id),
                    "replacement_ingredient_id": str(item.replacement_ingredient_id),
                    "quantity_ratio": (
                        format(item.quantity_ratio, "f")
                        if item.quantity_ratio is not None
                        else None
                    ),
                    "guidance": item.guidance,
                    "notes": item.notes,
                    "provenance": item.provenance,
                    "relationship_confidence": (
                        format(item.relationship_confidence, "f")
                        if item.relationship_confidence is not None
                        else None
                    ),
                }
                for item in sorted(
                    catalog.relationships,
                    key=lambda item: (
                        item.source_ingredient_id.int,
                        item.replacement_ingredient_id.int,
                        item.id.int,
                    ),
                )
            ],
            "recipe_contexts": [
                {
                    "id": str(item.id),
                    "ingredient_ids": [
                        str(value) for value in sorted(item.ingredient_ids, key=lambda x: x.int)
                    ],
                }
                for item in sorted(catalog.recipe_contexts, key=lambda item: item.id.int)
            ],
        },
        "cases": [
            {
                "id": item.id,
                "source_ingredient_id": str(item.source_ingredient_id),
                "recipe_context_id": str(item.recipe_context_id),
                "required_dietary_flag_ids": [
                    str(value)
                    for value in sorted(
                        item.constraints.required_dietary_flag_ids,
                        key=lambda value: value.int,
                    )
                ],
                "excluded_allergen_ids": [
                    str(value)
                    for value in sorted(
                        item.constraints.excluded_allergen_ids,
                        key=lambda value: value.int,
                    )
                ],
                "preference_weights": [
                    {"ingredient_id": str(value.ingredient_id), "weight": value.weight}
                    for value in sorted(
                        item.preference_weights,
                        key=lambda value: value.ingredient_id.int,
                    )
                ],
                "limit": item.limit,
                "expected_ranking": [str(value) for value in item.expected_ranking],
            }
            for item in sorted(cases, key=lambda item: item.id)
        ],
    }


def _validate_benchmark(benchmark: SubstitutionBenchmark) -> None:
    if not benchmark.limitations:
        raise SubstitutionBenchmarkError("limitations must contain at least one entry")
    if len(benchmark.limitations) != len(set(benchmark.limitations)):
        raise SubstitutionBenchmarkError("limitations must not contain duplicates")
    case_ids = [case.id for case in benchmark.cases]
    if len(case_ids) != len(set(case_ids)):
        raise SubstitutionBenchmarkError("case IDs must be unique")
    ingredients = {item.id: item for item in benchmark.catalog.ingredients}
    recipe_contexts = {item.id: item for item in benchmark.catalog.recipe_contexts}
    direct_by_source: dict[UUID, set[UUID]] = {}
    for relationship in benchmark.catalog.relationships:
        direct_by_source.setdefault(relationship.source_ingredient_id, set()).add(
            relationship.replacement_ingredient_id
        )
    dietary_flags = {item.id for item in benchmark.catalog.dietary_flags}
    allergens = {item.id for item in benchmark.catalog.allergens}
    for case in benchmark.cases:
        if case.source_ingredient_id not in ingredients:
            raise SubstitutionBenchmarkError("case references an unknown source ingredient")
        recipe = recipe_contexts.get(case.recipe_context_id)
        if recipe is None:
            raise SubstitutionBenchmarkError("case references an unknown recipe context")
        if case.source_ingredient_id not in recipe.ingredient_ids:
            raise SubstitutionBenchmarkError("case source is absent from its recipe context")
        if not case.constraints.required_dietary_flag_ids <= dietary_flags:
            raise SubstitutionBenchmarkError("case references an unknown dietary flag")
        if not case.constraints.excluded_allergen_ids <= allergens:
            raise SubstitutionBenchmarkError("case references an unknown allergen")
        if any(item.ingredient_id not in ingredients for item in case.preference_weights):
            raise SubstitutionBenchmarkError("case preference references an unknown ingredient")
        if any(
            item.ingredient_id not in direct_by_source.get(case.source_ingredient_id, set())
            for item in case.preference_weights
        ):
            raise SubstitutionBenchmarkError(
                "case preference must reference a direct replacement candidate"
            )
        if case.limit > 20:
            raise SubstitutionBenchmarkError("case limit must not exceed 20")
        if not set(case.expected_ranking) <= direct_by_source.get(case.source_ingredient_id, set()):
            raise SubstitutionBenchmarkError("case expected ranking contains a non-direct edge")
        if len(case.expected_ranking) > case.limit:
            raise SubstitutionBenchmarkError("case expected ranking exceeds its result limit")
        for ingredient_id in case.expected_ranking:
            ingredient = ingredients[ingredient_id]
            if not case.constraints.required_dietary_flag_ids <= ingredient.dietary_flag_ids:
                raise SubstitutionBenchmarkError(
                    "case expected ranking violates a required dietary declaration"
                )
            if case.constraints.excluded_allergen_ids & ingredient.allergen_ids:
                raise SubstitutionBenchmarkError(
                    "case expected ranking violates an excluded allergen declaration"
                )


def _parse_substitution_benchmark_document(raw: object) -> SubstitutionBenchmark:
    document = _object(raw, path="benchmark")
    _exact_keys(document, expected=_TOP_LEVEL_KEYS, path="benchmark")
    schema_version = _string(document["schema_version"], path="schema_version")
    if schema_version != SUBSTITUTION_BENCHMARK_SCHEMA_VERSION:
        raise SubstitutionBenchmarkError("unsupported substitution benchmark schema version")
    limitations = tuple(
        sorted(
            _string(item, path=f"limitations[{index}]")
            for index, item in enumerate(_array(document["limitations"], path="limitations"))
        )
    )
    catalog = _parse_catalog(document["catalog"])
    cases = _parse_cases(document["cases"])
    normalized = _normalized_document(
        schema_version=schema_version,
        benchmark_id=_string(document["benchmark_id"], path="benchmark_id"),
        limitations=limitations,
        catalog=catalog,
        cases=cases,
    )
    benchmark = SubstitutionBenchmark(
        schema_version=schema_version,
        benchmark_id=cast(str, normalized["benchmark_id"]),
        limitations=limitations,
        catalog=catalog,
        cases=tuple(sorted(cases, key=lambda item: item.id)),
        sha256=hashlib.sha256(canonical_json(normalized).encode("utf-8")).hexdigest(),
    )
    try:
        validate_substitution_catalog(catalog)
    except ValueError as error:
        raise SubstitutionBenchmarkError("substitution catalog is invalid") from error
    _validate_benchmark(benchmark)
    return benchmark


def _substitution_codec_error(error: JsonCodecError) -> SubstitutionBenchmarkError:
    if str(error).startswith("duplicate JSON key:"):
        return SubstitutionBenchmarkError("substitution benchmark contains a duplicate JSON key")
    return SubstitutionBenchmarkError(str(error))


def parse_substitution_benchmark_json(text: str) -> SubstitutionBenchmark:
    try:
        raw = decode_json_document(
            text,
            limits=_SUBSTITUTION_JSON_LIMITS,
            document_name="substitution benchmark",
        )
    except JsonCodecError as error:
        raise _substitution_codec_error(error) from error
    return _parse_substitution_benchmark_document(raw)


def load_substitution_benchmark(path: str | Path) -> SubstitutionBenchmark:
    try:
        raw = load_json_document(
            path,
            limits=_SUBSTITUTION_JSON_LIMITS,
            document_name="substitution benchmark",
        )
    except JsonCodecError as error:
        raise _substitution_codec_error(error) from error
    return _parse_substitution_benchmark_document(raw)


def validate_substitution_benchmark(
    benchmark: SubstitutionBenchmark,
) -> SubstitutionBenchmark:
    """Validate and normalize a typed benchmark without reparsing serialized JSON."""

    document = _normalized_document(
        schema_version=benchmark.schema_version,
        benchmark_id=benchmark.benchmark_id,
        limitations=benchmark.limitations,
        catalog=benchmark.catalog,
        cases=benchmark.cases,
    )
    return _parse_substitution_benchmark_document(document)


def substitution_benchmark_to_json(benchmark: SubstitutionBenchmark) -> str:
    document = _normalized_document(
        schema_version=benchmark.schema_version,
        benchmark_id=benchmark.benchmark_id,
        limitations=benchmark.limitations,
        catalog=benchmark.catalog,
        cases=benchmark.cases,
    )
    return canonical_json(document) + "\n"


__all__ = [
    "SUBSTITUTION_BENCHMARK_SCHEMA_VERSION",
    "SubstitutionBenchmark",
    "SubstitutionBenchmarkCase",
    "SubstitutionBenchmarkError",
    "SubstitutionPreferenceWeight",
    "load_substitution_benchmark",
    "parse_substitution_benchmark_json",
    "substitution_benchmark_to_json",
    "validate_substitution_benchmark",
]
