import json
from copy import deepcopy
from typing import Any, cast

import pytest
from conftest import SUBSTITUTION_FIXTURE_PATH

from recipe_lab_evaluation.dataset import canonical_json
from recipe_lab_evaluation.substitution_dataset import (
    SUBSTITUTION_BENCHMARK_SCHEMA_VERSION,
    SubstitutionBenchmark,
    SubstitutionBenchmarkError,
    parse_substitution_benchmark_json,
    substitution_benchmark_to_json,
)


def _fixture_document() -> dict[str, Any]:
    return cast(
        dict[str, Any],
        json.loads(SUBSTITUTION_FIXTURE_PATH.read_text(encoding="utf-8")),
    )


def _parse_document(document: dict[str, Any]) -> SubstitutionBenchmark:
    return parse_substitution_benchmark_json(json.dumps(document))


def _catalog(document: dict[str, Any]) -> dict[str, Any]:
    return cast(dict[str, Any], document["catalog"])


def _cases(document: dict[str, Any]) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], document["cases"])


def test_fixture_is_versioned_complete_and_round_trips_canonically(
    substitution_benchmark: SubstitutionBenchmark,
) -> None:
    serialized = substitution_benchmark_to_json(substitution_benchmark)
    reparsed = parse_substitution_benchmark_json(serialized)

    assert substitution_benchmark.schema_version == SUBSTITUTION_BENCHMARK_SCHEMA_VERSION
    assert substitution_benchmark.benchmark_id == ("recipe-lab-synthetic-substitution-rules-v1")
    assert len(substitution_benchmark.catalog.ingredients) == 11
    assert len(substitution_benchmark.catalog.relationships) == 4
    assert len(substitution_benchmark.catalog.recipe_contexts) == 7
    assert len(substitution_benchmark.cases) == 6
    assert len(substitution_benchmark.sha256) == 64
    assert serialized == canonical_json(json.loads(serialized)) + "\n"
    assert serialized.endswith("\n")
    assert reparsed == substitution_benchmark
    assert '"quantity_ratio":"1.0000"' in serialized
    assert '"relationship_confidence":"0.8000"' in serialized


def test_fingerprint_and_canonical_bytes_ignore_semantically_irrelevant_order() -> None:
    original_document = _fixture_document()
    reordered_document = deepcopy(original_document)
    catalog = _catalog(reordered_document)
    for field in (
        "dietary_flags",
        "allergens",
        "ingredients",
        "relationships",
        "recipe_contexts",
    ):
        cast(list[object], catalog[field]).reverse()
    cast(list[object], reordered_document["limitations"]).reverse()
    cast(list[object], reordered_document["cases"]).reverse()
    for ingredient in cast(list[dict[str, Any]], catalog["ingredients"]):
        cast(list[object], ingredient["dietary_flag_ids"]).reverse()
        cast(list[object], ingredient["allergen_ids"]).reverse()
    for context in cast(list[dict[str, Any]], catalog["recipe_contexts"]):
        cast(list[object], context["ingredient_ids"]).reverse()
    for case in _cases(reordered_document):
        cast(list[object], case["required_dietary_flag_ids"]).reverse()
        cast(list[object], case["excluded_allergen_ids"]).reverse()
        cast(list[object], case["preference_weights"]).reverse()

    original = _parse_document(original_document)
    reordered = _parse_document(reordered_document)

    assert reordered.sha256 == original.sha256
    assert substitution_benchmark_to_json(reordered) == substitution_benchmark_to_json(original)


def test_fixture_contains_no_user_or_request_metadata() -> None:
    raw = SUBSTITUTION_FIXTURE_PATH.read_text(encoding="utf-8").casefold()
    forbidden_fields = (
        "user_id",
        "profile_id",
        "email",
        "display_name",
        "ip_address",
        "user_agent",
        "referrer",
        "search_query",
        "request_fingerprint",
        "event_id",
        "action_id",
    )

    for field in forbidden_fields:
        assert f'"{field}"' not in raw
    assert "@" not in raw


def test_duplicate_json_keys_are_rejected_before_schema_validation() -> None:
    text = SUBSTITUTION_FIXTURE_PATH.read_text(encoding="utf-8")
    duplicate = text.replace(
        '"schema_version":',
        '"schema_version":"recipe-lab-substitution-benchmark-v1","schema_version":',
        1,
    )

    with pytest.raises(SubstitutionBenchmarkError, match="duplicate JSON key"):
        parse_substitution_benchmark_json(duplicate)


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (
            lambda document: document.update({"unexpected": "private"}),
            "invalid keys",
        ),
        (
            lambda document: document.update({"limitations": []}),
            "limitations",
        ),
        (
            lambda document: document.update({"limitations": ["Repeated.", "Repeated."]}),
            "duplicates",
        ),
        (
            lambda document: document.update({"schema_version": "future-v2"}),
            "unsupported",
        ),
        (
            lambda document: _catalog(document)["ingredients"][0].update({"unexpected": "private"}),
            "invalid keys",
        ),
        (
            lambda document: _catalog(document)["relationships"][0].pop("provenance"),
            "invalid keys",
        ),
        (
            lambda document: _catalog(document)["relationships"][0].update({"quantity_ratio": 1.0}),
            "non-blank string",
        ),
        (
            lambda document: _catalog(document)["relationships"][0].update(
                {"relationship_confidence": "NaN"}
            ),
            "finite",
        ),
        (
            lambda document: _cases(document)[0].update({"id": "Not_Canonical"}),
            "lowercase slug",
        ),
        (
            lambda document: _cases(document)[0].update({"limit": True}),
            "integer",
        ),
        (
            lambda document: _cases(document)[2]["preference_weights"][0].update({"weight": 0}),
            "nonzero",
        ),
    ],
    ids=[
        "top-level-extra",
        "limitations-empty",
        "limitations-duplicate",
        "schema-version",
        "nested-extra",
        "nested-missing",
        "decimal-not-string",
        "decimal-not-finite",
        "case-id",
        "boolean-limit",
        "zero-preference",
    ],
)
def test_strict_schema_rejects_unknown_missing_and_malformed_fields(
    mutation: Any,
    message: str,
) -> None:
    document = _fixture_document()
    mutation(document)

    with pytest.raises(SubstitutionBenchmarkError, match=message):
        _parse_document(document)


def test_noncanonical_uuid_and_duplicate_uuid_arrays_are_rejected() -> None:
    uppercase = _fixture_document()
    _catalog(uppercase)["ingredients"][0]["id"] = "30000000-0000-4000-8000-00000000ABCD"

    with pytest.raises(SubstitutionBenchmarkError, match="canonical lowercase UUID"):
        _parse_document(uppercase)

    duplicate = _fixture_document()
    expected = cast(list[str], _cases(duplicate)[0]["expected_ranking"])
    expected.append(expected[0])

    with pytest.raises(SubstitutionBenchmarkError, match="must not contain duplicates"):
        _parse_document(duplicate)


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (
            lambda document: _cases(document)[0].update(
                {"source_ingredient_id": "ffffffff-ffff-4fff-8fff-ffffffffffff"}
            ),
            "unknown source ingredient",
        ),
        (
            lambda document: _cases(document)[0].update(
                {"recipe_context_id": "ffffffff-ffff-4fff-8fff-ffffffffffff"}
            ),
            "unknown recipe context",
        ),
        (
            lambda document: _cases(document)[0].update(
                {"source_ingredient_id": "30000000-0000-4000-8000-000000000010"}
            ),
            "source is absent",
        ),
        (
            lambda document: _cases(document)[0].update(
                {"required_dietary_flag_ids": ["ffffffff-ffff-4fff-8fff-ffffffffffff"]}
            ),
            "unknown dietary flag",
        ),
        (
            lambda document: _cases(document)[0].update(
                {"excluded_allergen_ids": ["ffffffff-ffff-4fff-8fff-ffffffffffff"]}
            ),
            "unknown allergen",
        ),
        (
            lambda document: _cases(document)[2]["preference_weights"][0].update(
                {"ingredient_id": "ffffffff-ffff-4fff-8fff-ffffffffffff"}
            ),
            "preference references an unknown ingredient",
        ),
        (
            lambda document: _cases(document)[2]["preference_weights"][0].update(
                {"ingredient_id": "30000000-0000-4000-8000-000000000006"}
            ),
            "direct replacement candidate",
        ),
        (
            lambda document: _cases(document)[0].update(
                {"expected_ranking": ["30000000-0000-4000-8000-000000000006"]}
            ),
            "non-direct edge",
        ),
        (
            lambda document: _cases(document)[0].update({"limit": 2}),
            "exceeds its result limit",
        ),
        (
            lambda document: _cases(document)[0].update(
                {"required_dietary_flag_ids": ["10000000-0000-4000-8000-000000000003"]}
            ),
            "required dietary declaration",
        ),
        (
            lambda document: _cases(document)[0].update(
                {"excluded_allergen_ids": ["20000000-0000-4000-8000-000000000002"]}
            ),
            "excluded allergen declaration",
        ),
        (
            lambda document: _cases(document)[0].update({"limit": 21}),
            "must not exceed 20",
        ),
    ],
    ids=[
        "source",
        "context",
        "source-absent",
        "dietary",
        "allergen",
        "preference",
        "non-direct-preference",
        "non-direct",
        "limit-ranking",
        "expected-dietary",
        "expected-allergen",
        "maximum-limit",
    ],
)
def test_case_references_expectations_and_limits_are_validated(
    mutation: Any,
    message: str,
) -> None:
    document = _fixture_document()
    mutation(document)

    with pytest.raises(SubstitutionBenchmarkError, match=message):
        _parse_document(document)


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (
            lambda document: _catalog(document)["ingredients"].append(
                deepcopy(_catalog(document)["ingredients"][0])
            ),
            "catalog is invalid",
        ),
        (
            lambda document: _catalog(document)["relationships"].append(
                deepcopy(_catalog(document)["relationships"][0])
            ),
            "catalog is invalid",
        ),
        (
            lambda document: _catalog(document)["relationships"][0].update(
                {"quantity_ratio": None, "guidance": None}
            ),
            "catalog is invalid",
        ),
        (
            lambda document: _catalog(document)["relationships"][0].update(
                {"provenance": None, "relationship_confidence": None}
            ),
            "catalog is invalid",
        ),
        (
            lambda document: _catalog(document)["recipe_contexts"][-1]["ingredient_ids"].append(
                "ffffffff-ffff-4fff-8fff-ffffffffffff"
            ),
            "catalog is invalid",
        ),
    ],
    ids=[
        "duplicate-ingredient",
        "duplicate-relationship",
        "missing-guidance",
        "missing-evidence",
        "dangling-context",
    ],
)
def test_strict_loader_rejects_invalid_catalog_graphs(
    mutation: Any,
    message: str,
) -> None:
    document = _fixture_document()
    mutation(document)

    with pytest.raises(SubstitutionBenchmarkError, match=message):
        _parse_document(document)


def test_case_and_preference_ids_must_be_unique() -> None:
    duplicate_case = _fixture_document()
    _cases(duplicate_case).append(deepcopy(_cases(duplicate_case)[0]))

    with pytest.raises(SubstitutionBenchmarkError, match="case IDs must be unique"):
        _parse_document(duplicate_case)

    duplicate_preference = _fixture_document()
    preferences = cast(
        list[dict[str, Any]],
        _cases(duplicate_preference)[2]["preference_weights"],
    )
    preferences.append(deepcopy(preferences[0]))

    with pytest.raises(SubstitutionBenchmarkError, match="repeats an ingredient"):
        _parse_document(duplicate_preference)
