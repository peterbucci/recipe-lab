from __future__ import annotations

import json
from dataclasses import replace
from decimal import Decimal

from recipe_lab_evaluation.dataset import canonical_json
from recipe_lab_evaluation.duplicate_dataset import DuplicateBenchmark
from recipe_lab_evaluation.duplicate_evaluation import (
    DUPLICATE_EVALUATION_PROTOCOL_VERSION,
    DUPLICATE_EVALUATION_REPORT_SCHEMA_VERSION,
    REQUIRED_DUPLICATE_EVALUATION_LIMITATIONS,
    duplicate_evaluation_report_to_json,
    evaluate_duplicate_candidates,
)


def test_fixture_engineering_validates_all_classes_categories_and_explanations(
    duplicate_benchmark: DuplicateBenchmark,
) -> None:
    report = evaluate_duplicate_candidates(duplicate_benchmark)

    assert report.status == "engineering_validated"
    assert report.reason_codes == ()
    assert report.schema_version == DUPLICATE_EVALUATION_REPORT_SCHEMA_VERSION
    assert report.protocol_version == DUPLICATE_EVALUATION_PROTOCOL_VERSION
    assert report.advisory_only
    assert not report.learned_classifier_attempted
    assert report.counts.cases == 11
    assert report.counts.evaluated_cases == 11
    assert report.counts.classification_matches == 11
    assert report.counts.expected.exact_duplicate == 4
    assert report.counts.expected.probable_duplicate == 5
    assert report.counts.expected.distinct == 2
    assert report.counts.expected == report.counts.predicted
    assert report.counts.true_positives == 9
    assert report.counts.false_positives == 0
    assert report.counts.false_negatives == 0
    assert report.counts.cases_with_complete_explanations == 11
    assert report.counts.required_categories == 11
    assert report.counts.covered_categories == 11
    assert report.metrics.precision == Decimal("1.000000")
    assert report.metrics.recall == Decimal("1.000000")
    assert report.metrics.three_class_accuracy == Decimal("1.000000")
    assert report.metrics.evaluated_coverage == Decimal("1.000000")
    assert report.metrics.category_coverage == Decimal("1.000000")
    assert report.metrics.explanation_coverage == Decimal("1.000000")
    assert report.false_positive_categories == ()
    assert report.false_negative_categories == ()
    assert report.classification_mismatch_categories == ()
    assert set(REQUIRED_DUPLICATE_EVALUATION_LIMITATIONS) == set(report.limitations)


def test_report_exposes_the_versioned_reproducible_production_scoring_contract(
    duplicate_benchmark: DuplicateBenchmark,
) -> None:
    document = json.loads(
        duplicate_evaluation_report_to_json(evaluate_duplicate_candidates(duplicate_benchmark))
    )

    assert document["scoring"] == {
        "action_subweights": {
            "action_order": "0.500000",
            "duration_temperature": "0.200000",
            "ordered_inputs": "0.300000",
        },
        "algorithm": "deterministic_explainable_structural_similarity",
        "algorithm_version": "duplicate-candidate-similarity-v1",
        "capacity": {
            "maximum_actions_per_structure": 500,
            "maximum_flattened_inputs_per_structure": 2000,
            "maximum_ingredient_occurrences_per_structure": 200,
            "maximum_nonexact_pair_work_units": 10000000,
            "overflow_behavior": "fail_closed",
            "pair_work_estimate": (
                "(1 + 2 * left_ingredients * right_ingredients) * "
                "(left_ingredients + right_ingredients) + "
                "2 * left_actions * right_actions + left_inputs * right_inputs"
            ),
        },
        "maximum_reasons": 3,
        "parameter_sha256": "51a9a0462260fb47b574c1070e90bd964dd57ab171a818f55b1897a567ce1f70",
        "probable_duplicate_threshold": "0.800000",
        "structure_version": "recipe-structure-v1",
        "weights": {
            "ingredient_multiset": "0.450000",
            "normalized_quantities": "0.250000",
            "structured_actions": "0.300000",
        },
    }
    assert document["positive_classifications"] == [
        "exact_duplicate",
        "probable_duplicate",
    ]


def test_exact_vs_probable_mismatch_is_aggregate_without_positive_boundary_error(
    duplicate_benchmark: DuplicateBenchmark,
) -> None:
    scaled = next(
        case for case in duplicate_benchmark.cases if case.category == "proportional_scaling"
    )
    changed = replace(
        duplicate_benchmark,
        cases=tuple(
            replace(case, expected_classification="exact_duplicate")
            if case.id == scaled.id
            else case
            for case in duplicate_benchmark.cases
        ),
    )

    report = evaluate_duplicate_candidates(changed)

    assert report.status == "invalid"
    assert report.reason_codes == ("classification_mismatch",)
    assert report.counts.classification_matches == 10
    assert report.counts.false_negatives == 0
    assert report.counts.false_positives == 0
    assert report.classification_mismatch_categories[0].category == "proportional_scaling"
    assert report.classification_mismatch_categories[0].count == 1


def test_positive_boundary_errors_report_sorted_false_positive_and_negative_categories(
    duplicate_benchmark: DuplicateBenchmark,
) -> None:
    changed = replace(
        duplicate_benchmark,
        cases=tuple(
            replace(case, expected_classification="distinct")
            if case.category == "action_change"
            else replace(case, expected_classification="probable_duplicate")
            if case.category == "adversarial_near_match"
            else case
            for case in duplicate_benchmark.cases
        ),
    )

    report = evaluate_duplicate_candidates(changed)

    assert report.status == "invalid"
    assert report.counts.false_positives == 1
    assert report.counts.false_negatives == 1
    assert [(item.category, item.count) for item in report.false_positive_categories] == [
        ("action_change", 1)
    ]
    assert [(item.category, item.count) for item in report.false_negative_categories] == [
        ("adversarial_near_match", 1)
    ]


def test_report_is_byte_deterministic_and_omits_pair_ids_prose_and_identity_fields(
    duplicate_benchmark: DuplicateBenchmark,
) -> None:
    first = duplicate_evaluation_report_to_json(evaluate_duplicate_candidates(duplicate_benchmark))
    repeated = duplicate_evaluation_report_to_json(
        evaluate_duplicate_candidates(duplicate_benchmark)
    )

    assert first == repeated
    assert first == canonical_json(json.loads(first)) + "\n"
    assert first.endswith("\n")
    assert "generated_at" not in first
    assert "host" not in first
    assert "path" not in first
    assert duplicate_benchmark.benchmark_id not in first
    for recipe in duplicate_benchmark.recipes:
        for prose in recipe.instruction_prose:
            assert prose not in first
    for forbidden_field in (
        "case_id",
        "left_recipe_id",
        "right_recipe_id",
        "recipe_id",
        "user_id",
        "profile_id",
        "email",
        "title",
        "description",
        "instruction_text",
    ):
        assert f'"{forbidden_field}"' not in first


def test_report_omits_caller_supplied_recipe_and_pair_identifiers(
    duplicate_benchmark: DuplicateBenchmark,
) -> None:
    recipe_ids = {
        recipe.id: f"private-recipe-record-{index:02d}"
        for index, recipe in enumerate(duplicate_benchmark.recipes)
    }
    private_pair_ids = [
        f"private-pair-record-{index:02d}" for index in range(len(duplicate_benchmark.cases))
    ]
    changed = replace(
        duplicate_benchmark,
        recipes=tuple(
            replace(recipe, id=recipe_ids[recipe.id]) for recipe in duplicate_benchmark.recipes
        ),
        cases=tuple(
            replace(
                case,
                id=private_pair_ids[index],
                left_recipe_id=recipe_ids[case.left_recipe_id],
                right_recipe_id=recipe_ids[case.right_recipe_id],
            )
            for index, case in enumerate(duplicate_benchmark.cases)
        ),
    )

    raw = duplicate_evaluation_report_to_json(evaluate_duplicate_candidates(changed))

    for private_id in (*recipe_ids.values(), *private_pair_ids):
        assert private_id not in raw
