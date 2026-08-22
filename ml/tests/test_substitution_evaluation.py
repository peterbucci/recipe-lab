import json
from dataclasses import replace
from decimal import Decimal

from recipe_lab_evaluation.dataset import canonical_json
from recipe_lab_evaluation.substitution_dataset import SubstitutionBenchmark
from recipe_lab_evaluation.substitution_evaluation import (
    REQUIRED_LIMITATIONS,
    SUBSTITUTION_EVALUATION_PROTOCOL_VERSION,
    SUBSTITUTION_EVALUATION_REPORT_SCHEMA_VERSION,
    evaluate_substitution_rules,
    substitution_evaluation_report_to_json,
)
from recipe_lab_evaluation.substitution_rules import SUBSTITUTION_RULES_STRATEGY


def test_fixture_engineering_validation_has_complete_exact_metrics(
    substitution_benchmark: SubstitutionBenchmark,
) -> None:
    report = evaluate_substitution_rules(substitution_benchmark)

    assert report.schema_version == SUBSTITUTION_EVALUATION_REPORT_SCHEMA_VERSION
    assert report.protocol_version == SUBSTITUTION_EVALUATION_PROTOCOL_VERSION
    assert report.strategy == SUBSTITUTION_RULES_STRATEGY
    assert report.status == "engineering_validated"
    assert report.reason_codes == ()
    assert not report.learned_ranking_attempted
    assert report.benchmark_sha256 == substitution_benchmark.sha256
    assert len(report.run_id) == 64
    assert report.counts.cases == 6
    assert report.counts.cases_with_expected_results == 5
    assert report.counts.empty_expected_cases == 1
    assert report.counts.exact_ranking_matches == 6
    assert report.counts.top1_matches == 5
    assert report.counts.expected_candidates == 9
    assert report.counts.returned_candidates == 9
    assert report.counts.matching_candidates == 9
    assert report.counts.direct_candidates_considered == 13
    assert report.counts.eligible_candidates == 9
    assert report.counts.dietary_filtered == 2
    assert report.counts.allergen_filtered == 2
    assert report.counts.non_direct_outputs == 0
    assert report.counts.constraint_violations == 0
    assert report.counts.missing_ratio_or_guidance == 0
    assert report.counts.missing_provenance_or_confidence == 0
    assert report.counts.missing_explanations == 0
    assert report.counts.caution_mismatches == 0
    assert report.metrics.exact_ranking_accuracy == Decimal("1.000000")
    assert report.metrics.top1_accuracy == Decimal("1.000000")
    assert report.metrics.candidate_recall == Decimal("1.000000")
    assert report.metrics.direct_edge_precision == Decimal("1.000000")
    assert report.metrics.constraint_compliance == Decimal("1.000000")
    assert report.metrics.ratio_or_guidance_coverage == Decimal("1.000000")
    assert report.metrics.provenance_or_confidence_coverage == Decimal("1.000000")
    assert report.metrics.explanation_coverage == Decimal("1.000000")
    assert report.metrics.caution_compliance == Decimal("1.000000")
    assert report.metrics.empty_result_accuracy == Decimal("1.000000")
    assert set(REQUIRED_LIMITATIONS) <= set(report.limitations)
    assert any("synthetic" in limitation.casefold() for limitation in report.limitations)
    assert any("medical or food safety" in limitation for limitation in report.limitations)


def test_ranking_mismatch_is_invalid_without_claiming_a_learned_result(
    substitution_benchmark: SubstitutionBenchmark,
) -> None:
    first = next(case for case in substitution_benchmark.cases if case.id == "pancake-context")
    mismatched = replace(
        first,
        expected_ranking=(
            first.expected_ranking[1],
            first.expected_ranking[0],
            first.expected_ranking[2],
        ),
    )
    benchmark = replace(
        substitution_benchmark,
        cases=tuple(
            mismatched if case.id == first.id else case for case in substitution_benchmark.cases
        ),
    )

    report = evaluate_substitution_rules(benchmark)

    assert report.status == "invalid"
    assert report.reason_codes == ("ranking_mismatch",)
    assert report.counts.exact_ranking_matches == 5
    assert report.metrics.exact_ranking_accuracy == Decimal("0.833333")
    assert report.metrics.candidate_recall == Decimal("1.000000")
    assert not report.learned_ranking_attempted


def test_evaluator_recomputes_provenance_for_programmatic_benchmark_changes(
    substitution_benchmark: SubstitutionBenchmark,
) -> None:
    first = next(case for case in substitution_benchmark.cases if case.id == "pancake-context")
    mismatched = replace(
        first,
        expected_ranking=(
            first.expected_ranking[1],
            first.expected_ranking[0],
            first.expected_ranking[2],
        ),
    )
    changed = replace(
        substitution_benchmark,
        cases=tuple(
            mismatched if case.id == first.id else case for case in substitution_benchmark.cases
        ),
    )

    original_report = evaluate_substitution_rules(substitution_benchmark)
    changed_report = evaluate_substitution_rules(changed)

    assert changed.sha256 == substitution_benchmark.sha256
    assert changed_report.benchmark_sha256 != original_report.benchmark_sha256
    assert changed_report.run_id != original_report.run_id


def test_empty_or_empty_only_benchmarks_are_insufficient_not_validated(
    substitution_benchmark: SubstitutionBenchmark,
) -> None:
    no_cases = evaluate_substitution_rules(replace(substitution_benchmark, cases=()))
    empty_case = next(
        case for case in substitution_benchmark.cases if case.id == "empty-when-no-curated-edge"
    )
    empty_only = evaluate_substitution_rules(replace(substitution_benchmark, cases=(empty_case,)))

    assert no_cases.status == "insufficient_data"
    assert no_cases.reason_codes == ("insufficient_benchmark_cases",)
    assert no_cases.metrics.exact_ranking_accuracy is None
    assert no_cases.metrics.candidate_recall is None
    assert no_cases.metrics.direct_edge_precision is None
    assert empty_only.status == "insufficient_data"
    assert empty_only.reason_codes == ("insufficient_benchmark_cases",)
    assert empty_only.metrics.exact_ranking_accuracy == Decimal("1.000000")
    assert empty_only.metrics.empty_result_accuracy == Decimal("1.000000")
    assert empty_only.metrics.top1_accuracy is None


def test_report_is_canonical_byte_deterministic_for_equivalent_catalog_order(
    substitution_benchmark: SubstitutionBenchmark,
) -> None:
    reordered_catalog = replace(
        substitution_benchmark.catalog,
        dietary_flags=tuple(reversed(substitution_benchmark.catalog.dietary_flags)),
        allergens=tuple(reversed(substitution_benchmark.catalog.allergens)),
        ingredients=tuple(reversed(substitution_benchmark.catalog.ingredients)),
        relationships=tuple(reversed(substitution_benchmark.catalog.relationships)),
        recipe_contexts=tuple(reversed(substitution_benchmark.catalog.recipe_contexts)),
    )
    reordered_benchmark = replace(
        substitution_benchmark,
        catalog=reordered_catalog,
        cases=tuple(reversed(substitution_benchmark.cases)),
    )

    first = substitution_evaluation_report_to_json(
        evaluate_substitution_rules(substitution_benchmark)
    )
    repeated = substitution_evaluation_report_to_json(
        evaluate_substitution_rules(substitution_benchmark)
    )
    reordered = substitution_evaluation_report_to_json(
        evaluate_substitution_rules(reordered_benchmark)
    )

    assert first == repeated == reordered
    assert first == canonical_json(json.loads(first)) + "\n"
    assert first.endswith("\n")
    assert "generated_at" not in first
    assert "host" not in first
    assert "path" not in first


def test_aggregate_report_omits_catalog_case_and_user_level_identifiers(
    substitution_benchmark: SubstitutionBenchmark,
) -> None:
    raw = substitution_evaluation_report_to_json(
        evaluate_substitution_rules(substitution_benchmark)
    )

    assert substitution_benchmark.benchmark_id not in raw
    for case in substitution_benchmark.cases:
        assert case.id not in raw
    for ingredient in substitution_benchmark.catalog.ingredients:
        assert str(ingredient.id) not in raw
        assert ingredient.name not in raw
    for relationship in substitution_benchmark.catalog.relationships:
        assert str(relationship.id) not in raw
    for context in substitution_benchmark.catalog.recipe_contexts:
        assert str(context.id) not in raw
    for forbidden_field in (
        "user_id",
        "profile_id",
        "event_id",
        "email",
        "display_name",
        "ip_address",
        "request_fingerprint",
    ):
        assert f'"{forbidden_field}"' not in raw


def test_aggregate_report_does_not_copy_caller_supplied_labels_or_limitations(
    substitution_benchmark: SubstitutionBenchmark,
) -> None:
    private_text = "private-profile-note-11111111-1111-4111-8111-111111111111"
    benchmark = replace(
        substitution_benchmark,
        benchmark_id=private_text,
        limitations=(private_text,),
    )

    raw = substitution_evaluation_report_to_json(evaluate_substitution_rules(benchmark))

    assert private_text not in raw
    assert json.loads(raw)["limitations"] == sorted(REQUIRED_LIMITATIONS)


def test_report_serializes_metrics_as_fixed_precision_strings(
    substitution_benchmark: SubstitutionBenchmark,
) -> None:
    document = json.loads(
        substitution_evaluation_report_to_json(evaluate_substitution_rules(substitution_benchmark))
    )

    assert set(document) == {
        "benchmark_sha256",
        "counts",
        "learned_ranking_attempted",
        "limitations",
        "metrics",
        "protocol_version",
        "reason_codes",
        "run_id",
        "schema_version",
        "status",
        "strategy",
    }
    assert set(document["metrics"].values()) == {"1.000000"}
