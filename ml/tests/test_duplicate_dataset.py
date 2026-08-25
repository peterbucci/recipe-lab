from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

import pytest
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


def test_fixture_uses_only_structural_data_and_never_embeds_recipe_prose() -> None:
    document = _document()
    serialized = json.dumps(document)

    for forbidden_key in (
        "title",
        "description",
        "instruction_text",
        "display_name",
        "recipe_id",
        "user_id",
    ):
        assert f'"{forbidden_key}"' not in serialized
    paraphrase_case = next(
        case
        for case in cast(list[dict[str, object]], document["cases"])
        if case["category"] == "prose_paraphrase"
    )
    assert set(paraphrase_case) == {
        "category",
        "expected_classification",
        "id",
        "left_structure_id",
        "right_structure_id",
    }


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
    first = cast(list[dict[str, Any]], structure["structures"])[0]
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
    cast(list[dict[str, object]], unknown_reference["cases"])[0]["right_structure_id"] = "missing"
    with pytest.raises(DuplicateBenchmarkError, match="unknown right structure"):
        parse_duplicate_benchmark_json(json.dumps(unknown_reference))

    incomplete = _document()
    first_structure = cast(list[dict[str, Any]], incomplete["structures"])[0]
    cast(dict[str, object], first_structure["structure"])["ingredients"] = []
    with pytest.raises(DuplicateBenchmarkError, match="cannot produce"):
        parse_duplicate_benchmark_json(json.dumps(incomplete))


def test_normalized_fixture_and_hash_are_order_and_whitespace_stable(
    duplicate_benchmark: DuplicateBenchmark,
    tmp_path: Path,
) -> None:
    document = _document()
    document["structures"] = list(reversed(cast(list[object], document["structures"])))
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
