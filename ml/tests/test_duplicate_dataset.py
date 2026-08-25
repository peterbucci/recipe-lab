from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

import pytest
from app.services.recipe_fingerprints import build_structural_fingerprint
from conftest import DUPLICATE_FIXTURE_PATH

from recipe_lab_evaluation.dataset import canonical_json
from recipe_lab_evaluation.duplicate_dataset import (
    DUPLICATE_BENCHMARK_SCHEMA_VERSION,
    REQUIRED_DUPLICATE_BENCHMARK_CATEGORIES,
    DuplicateBenchmark,
    DuplicateBenchmarkError,
    duplicate_benchmark_to_json,
    load_duplicate_benchmark,
    parse_duplicate_benchmark_json,
)


def _document() -> dict[str, Any]:
    return cast(
        dict[str, Any],
        json.loads(DUPLICATE_FIXTURE_PATH.read_text(encoding="utf-8")),
    )


def test_loads_strict_versioned_fixture_with_complete_category_support(
    duplicate_benchmark: DuplicateBenchmark,
) -> None:
    assert duplicate_benchmark.schema_version == DUPLICATE_BENCHMARK_SCHEMA_VERSION
    assert duplicate_benchmark.structure_version == "recipe-structure-v1"
    assert duplicate_benchmark.scoring_algorithm_version == ("duplicate-candidate-similarity-v1")
    assert len(duplicate_benchmark.cases) == 11
    assert {case.category for case in duplicate_benchmark.cases} == set(
        REQUIRED_DUPLICATE_BENCHMARK_CATEGORIES
    )
    assert {case.expected_classification for case in duplicate_benchmark.cases} == {
        "exact_duplicate",
        "probable_duplicate",
        "distinct",
    }
    assert len(duplicate_benchmark.sha256) == 64


def test_fixture_keeps_genuine_paraphrased_prose_outside_fingerprint_structure() -> None:
    document = _document()
    paraphrase_case = next(
        case
        for case in cast(list[dict[str, object]], document["cases"])
        if case["category"] == "prose_paraphrase"
    )
    assert set(paraphrase_case) == {
        "category",
        "expected_classification",
        "expected_components",
        "expected_reason_codes",
        "id",
        "left_recipe_id",
        "right_recipe_id",
    }
    assert paraphrase_case["left_recipe_id"] != paraphrase_case["right_recipe_id"]

    recipes = {item["id"]: item for item in cast(list[dict[str, Any]], document["recipes"])}
    left = recipes[paraphrase_case["left_recipe_id"]]
    right = recipes[paraphrase_case["right_recipe_id"]]
    assert left["instruction_prose"] != right["instruction_prose"]
    assert left["structure"] == right["structure"]
    assert "instruction_prose" not in cast(dict[str, object], left["structure"])


def test_paraphrase_records_derive_the_same_production_fingerprint(
    duplicate_benchmark: DuplicateBenchmark,
) -> None:
    case = next(item for item in duplicate_benchmark.cases if item.category == "prose_paraphrase")
    recipes = {item.id: item for item in duplicate_benchmark.recipes}
    left_recipe = recipes[case.left_recipe_id]
    right_recipe = recipes[case.right_recipe_id]

    left = build_structural_fingerprint(left_recipe.structure)
    right = build_structural_fingerprint(right_recipe.structure)

    assert left is not None
    assert right is not None
    assert left_recipe.instruction_prose != right_recipe.instruction_prose
    assert left.digest == right.digest
    assert left.canonical_json == right.canonical_json


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("schema_version", "recipe-lab-duplicate-evaluation-fixture-v2", "schema version"),
        ("structure_version", "recipe-structure-v2", "structure version"),
        (
            "scoring_algorithm_version",
            "duplicate-candidate-similarity-v2",
            "scoring version",
        ),
    ],
)
def test_rejects_unsupported_versions(field: str, value: str, message: str) -> None:
    document = _document()
    document[field] = value

    with pytest.raises(DuplicateBenchmarkError, match=message):
        parse_duplicate_benchmark_json(json.dumps(document))


def test_rejects_duplicate_json_keys() -> None:
    with pytest.raises(DuplicateBenchmarkError, match="duplicate JSON key"):
        parse_duplicate_benchmark_json('{"schema_version":"one","schema_version":"two"}')


def test_rejects_unknown_keys_at_every_contract_layer() -> None:
    top = _document()
    top["extra"] = True
    with pytest.raises(DuplicateBenchmarkError, match="benchmark has invalid keys"):
        parse_duplicate_benchmark_json(json.dumps(top))

    case = _document()
    cast(list[dict[str, object]], case["cases"])[0]["notes"] = "not structural"
    with pytest.raises(DuplicateBenchmarkError, match=r"cases\[0\] has invalid keys"):
        parse_duplicate_benchmark_json(json.dumps(case))

    structure = _document()
    first = cast(list[dict[str, Any]], structure["recipes"])[0]
    cast(dict[str, object], first["structure"])["title"] = "must be rejected"
    with pytest.raises(DuplicateBenchmarkError, match="structure has invalid keys"):
        parse_duplicate_benchmark_json(json.dumps(structure))


def test_rejects_missing_required_category() -> None:
    document = _document()
    cases = cast(list[dict[str, object]], document["cases"])
    document["cases"] = [case for case in cases if case["category"] != "adversarial_near_match"]

    with pytest.raises(DuplicateBenchmarkError, match="missing required categories"):
        parse_duplicate_benchmark_json(json.dumps(document))


def test_rejects_duplicate_ids_unknown_references_and_incomplete_structures() -> None:
    duplicate_id = _document()
    cases = cast(list[dict[str, object]], duplicate_id["cases"])
    cases[1]["id"] = cases[0]["id"]
    with pytest.raises(DuplicateBenchmarkError, match="case IDs must be unique"):
        parse_duplicate_benchmark_json(json.dumps(duplicate_id))

    unknown_reference = _document()
    cast(list[dict[str, object]], unknown_reference["cases"])[0]["right_recipe_id"] = "missing"
    with pytest.raises(DuplicateBenchmarkError, match="unknown right recipe"):
        parse_duplicate_benchmark_json(json.dumps(unknown_reference))

    incomplete = _document()
    first_recipe = cast(list[dict[str, Any]], incomplete["recipes"])[0]
    cast(dict[str, object], first_recipe["structure"])["ingredients"] = []
    with pytest.raises(DuplicateBenchmarkError, match="cannot produce"):
        parse_duplicate_benchmark_json(json.dumps(incomplete))


def test_rejects_reflexive_fake_paraphrases_and_structural_changes() -> None:
    reflexive = _document()
    cases = cast(list[dict[str, object]], reflexive["cases"])
    paraphrase = next(case for case in cases if case["category"] == "prose_paraphrase")
    paraphrase["right_recipe_id"] = paraphrase["left_recipe_id"]
    with pytest.raises(DuplicateBenchmarkError, match="two different recipe records"):
        parse_duplicate_benchmark_json(json.dumps(reflexive))

    same_prose = _document()
    recipes = cast(list[dict[str, Any]], same_prose["recipes"])
    base = next(recipe for recipe in recipes if recipe["id"] == "base")
    changed = next(recipe for recipe in recipes if recipe["id"] == "paraphrased-prose")
    base_prose = cast(list[str], base["instruction_prose"])
    changed["instruction_prose"] = [f"  {value.upper()}  " for value in base_prose]
    with pytest.raises(DuplicateBenchmarkError, match="genuinely different"):
        parse_duplicate_benchmark_json(json.dumps(same_prose))

    structural_change = _document()
    recipes = cast(list[dict[str, Any]], structural_change["recipes"])
    changed = next(recipe for recipe in recipes if recipe["id"] == "paraphrased-prose")
    structure = cast(dict[str, Any], changed["structure"])
    ingredients = cast(list[dict[str, Any]], structure["ingredients"])
    measure = cast(dict[str, object], ingredients[0]["measure"])
    measure["value"] = "121"
    with pytest.raises(DuplicateBenchmarkError, match="fingerprint relation"):
        parse_duplicate_benchmark_json(json.dumps(structural_change))


def test_alias_case_uses_distinct_source_labels_outside_identical_curated_structure(
    duplicate_benchmark: DuplicateBenchmark,
) -> None:
    case = next(item for item in duplicate_benchmark.cases if item.category == "alias_equivalence")
    recipes = {item.id: item for item in duplicate_benchmark.recipes}
    left = recipes[case.left_recipe_id]
    right = recipes[case.right_recipe_id]

    assert left.structure == right.structure
    assert left.ingredient_source_labels != right.ingredient_source_labels
    assert build_structural_fingerprint(left.structure) == build_structural_fingerprint(
        right.structure
    )


@pytest.mark.parametrize(
    ("category", "replacement_recipe_id"),
    [
        ("unit_equivalence", "paraphrased-prose"),
        ("alias_equivalence", "paraphrased-prose"),
        ("ingredient_reorder", "paraphrased-prose"),
        ("prose_paraphrase", "alias-equivalent"),
        ("proportional_scaling", "unit-equivalent"),
        ("quantity_change", "scaled"),
        ("action_change", "action-reordered"),
        ("action_order_change", "action-changed"),
        ("duration_change", "temperature-changed"),
        ("temperature_change", "duration-changed"),
        ("adversarial_near_match", "quantity-changed"),
    ],
)
def test_rejects_category_labels_that_do_not_exercise_the_claimed_semantics(
    category: str,
    replacement_recipe_id: str,
) -> None:
    document = _document()
    case = next(
        item
        for item in cast(list[dict[str, object]], document["cases"])
        if item["category"] == category
    )
    case["right_recipe_id"] = replacement_recipe_id

    with pytest.raises(DuplicateBenchmarkError, match="does not exercise"):
        parse_duplicate_benchmark_json(json.dumps(document))


def test_normalized_fixture_and_hash_are_order_and_whitespace_stable(
    duplicate_benchmark: DuplicateBenchmark,
    tmp_path: Path,
) -> None:
    document = _document()
    document["recipes"] = list(reversed(cast(list[object], document["recipes"])))
    document["cases"] = list(reversed(cast(list[object], document["cases"])))
    reordered_path = tmp_path / "reordered.json"
    reordered_path.write_text(json.dumps(document, indent=7), encoding="utf-8")
    reordered = load_duplicate_benchmark(reordered_path)

    first = duplicate_benchmark_to_json(duplicate_benchmark)
    second = duplicate_benchmark_to_json(reordered)
    assert first == second
    assert duplicate_benchmark.sha256 == reordered.sha256
    assert first == canonical_json(json.loads(first)) + "\n"
    assert first.endswith("\n")
