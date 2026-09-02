from __future__ import annotations

import hashlib
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal
from uuid import UUID

from .dataset import canonical_json
from .reporting import decimal_text, report_envelope, serialize_report_document
from .substitution_dataset import (
    SubstitutionBenchmark,
    validate_substitution_benchmark,
)
from .substitution_rules import (
    SUBSTITUTION_CAUTION,
    SUBSTITUTION_RULES_STRATEGY,
    SubstitutionQuery,
    recommend_substitutions,
)

SUBSTITUTION_EVALUATION_REPORT_SCHEMA_VERSION = "recipe-lab-substitution-evaluation-report-v1"
SUBSTITUTION_EVALUATION_PROTOCOL_VERSION = "curated-direct-rules-benchmark-v1"
METRIC_QUANTUM = Decimal("0.000001")

type SubstitutionEvaluationStatus = Literal[
    "engineering_validated",
    "invalid",
    "insufficient_data",
]

REQUIRED_LIMITATIONS = (
    "The benchmark cases are synthetic engineering fixtures, not user-outcome evidence.",
    "Ingredient metadata contains positive declarations only; missing metadata is unknown.",
    "The live demo catalog has one outgoing candidate per substitution source.",
    "No substitution impressions, selections, rejection reasons, or cooking outcomes exist.",
    "The report validates deterministic rules and constraints, not medical or food safety.",
    "No learned substitution ranking was trained or evaluated.",
)


@dataclass(frozen=True, slots=True)
class SubstitutionEvaluationCounts:
    cases: int
    cases_with_expected_results: int
    empty_expected_cases: int
    exact_ranking_matches: int
    top1_matches: int
    expected_candidates: int
    returned_candidates: int
    matching_candidates: int
    direct_candidates_considered: int
    eligible_candidates: int
    dietary_filtered: int
    allergen_filtered: int
    non_direct_outputs: int
    constraint_violations: int
    missing_ratio_or_guidance: int
    missing_provenance_or_confidence: int
    missing_explanations: int
    caution_mismatches: int


@dataclass(frozen=True, slots=True)
class SubstitutionEvaluationMetrics:
    exact_ranking_accuracy: Decimal | None
    top1_accuracy: Decimal | None
    candidate_recall: Decimal | None
    direct_edge_precision: Decimal | None
    constraint_compliance: Decimal | None
    ratio_or_guidance_coverage: Decimal | None
    provenance_or_confidence_coverage: Decimal | None
    explanation_coverage: Decimal | None
    caution_compliance: Decimal | None
    empty_result_accuracy: Decimal | None


@dataclass(frozen=True, slots=True)
class SubstitutionEvaluationReport:
    schema_version: str
    protocol_version: str
    run_id: str
    benchmark_sha256: str
    status: SubstitutionEvaluationStatus
    reason_codes: tuple[str, ...]
    strategy: str
    learned_ranking_attempted: bool
    counts: SubstitutionEvaluationCounts
    metrics: SubstitutionEvaluationMetrics
    limitations: tuple[str, ...]


def _ratio(numerator: int, denominator: int) -> Decimal | None:
    if denominator == 0:
        return None
    return (Decimal(numerator) / Decimal(denominator)).quantize(
        METRIC_QUANTUM,
        rounding=ROUND_HALF_UP,
    )


def _constraints_hold(
    *,
    dietary_flags: frozenset[UUID],
    allergens: frozenset[UUID],
    required_dietary_flags: frozenset[UUID],
    excluded_allergens: frozenset[UUID],
) -> bool:
    return required_dietary_flags <= dietary_flags and not (excluded_allergens & allergens)


def evaluate_substitution_rules(
    benchmark: SubstitutionBenchmark,
) -> SubstitutionEvaluationReport:
    benchmark = validate_substitution_benchmark(benchmark)
    recipes = {recipe.id: recipe for recipe in benchmark.catalog.recipe_contexts}
    direct_pairs = {
        (relationship.source_ingredient_id, relationship.replacement_ingredient_id)
        for relationship in benchmark.catalog.relationships
    }

    exact_ranking_matches = 0
    top1_matches = 0
    expected_candidates = 0
    returned_candidates = 0
    matching_candidates = 0
    direct_candidates_considered = 0
    eligible_candidates = 0
    dietary_filtered = 0
    allergen_filtered = 0
    non_direct_outputs = 0
    constraint_violations = 0
    missing_ratio_or_guidance = 0
    missing_provenance_or_confidence = 0
    missing_explanations = 0
    caution_mismatches = 0
    empty_result_matches = 0
    nonempty_cases = 0
    empty_cases = 0

    for case in benchmark.cases:
        recipe = recipes[case.recipe_context_id]
        result = recommend_substitutions(
            benchmark.catalog,
            SubstitutionQuery(
                source_ingredient_id=case.source_ingredient_id,
                recipe_ingredient_ids=recipe.ingredient_ids,
                constraints=case.constraints,
                preference_weights={
                    preference.ingredient_id: preference.weight
                    for preference in case.preference_weights
                },
                limit=case.limit,
            ),
        )
        actual = tuple(item.replacement.id for item in result.items)
        expected = case.expected_ranking
        exact_ranking_matches += int(actual == expected)
        expected_candidates += len(expected)
        returned_candidates += len(actual)
        matching_candidates += len(set(actual) & set(expected))
        direct_candidates_considered += result.direct_candidate_count
        eligible_candidates += result.eligible_candidate_count
        dietary_filtered += result.filtered_dietary_count
        allergen_filtered += result.filtered_allergen_count
        if expected:
            nonempty_cases += 1
            top1_matches += int(bool(actual) and actual[0] == expected[0])
        else:
            empty_cases += 1
            empty_result_matches += int(not actual)

        for item in result.items:
            if (case.source_ingredient_id, item.replacement.id) not in direct_pairs:
                non_direct_outputs += 1
            if not _constraints_hold(
                dietary_flags=item.replacement.dietary_flag_ids,
                allergens=item.replacement.allergen_ids,
                required_dietary_flags=case.constraints.required_dietary_flag_ids,
                excluded_allergens=case.constraints.excluded_allergen_ids,
            ):
                constraint_violations += 1
            missing_ratio_or_guidance += int(item.quantity_ratio is None and item.guidance is None)
            missing_provenance_or_confidence += int(
                item.provenance is None and item.components.relationship_confidence is None
            )
            missing_explanations += int(not item.explanation.strip())
        caution_mismatches += int(result.caution != SUBSTITUTION_CAUTION)

    case_count = len(benchmark.cases)
    counts = SubstitutionEvaluationCounts(
        cases=case_count,
        cases_with_expected_results=nonempty_cases,
        empty_expected_cases=empty_cases,
        exact_ranking_matches=exact_ranking_matches,
        top1_matches=top1_matches,
        expected_candidates=expected_candidates,
        returned_candidates=returned_candidates,
        matching_candidates=matching_candidates,
        direct_candidates_considered=direct_candidates_considered,
        eligible_candidates=eligible_candidates,
        dietary_filtered=dietary_filtered,
        allergen_filtered=allergen_filtered,
        non_direct_outputs=non_direct_outputs,
        constraint_violations=constraint_violations,
        missing_ratio_or_guidance=missing_ratio_or_guidance,
        missing_provenance_or_confidence=missing_provenance_or_confidence,
        missing_explanations=missing_explanations,
        caution_mismatches=caution_mismatches,
    )
    metrics = SubstitutionEvaluationMetrics(
        exact_ranking_accuracy=_ratio(exact_ranking_matches, case_count),
        top1_accuracy=_ratio(top1_matches, nonempty_cases),
        candidate_recall=_ratio(matching_candidates, expected_candidates),
        direct_edge_precision=_ratio(
            returned_candidates - non_direct_outputs,
            returned_candidates,
        ),
        constraint_compliance=_ratio(
            returned_candidates - constraint_violations,
            returned_candidates,
        ),
        ratio_or_guidance_coverage=_ratio(
            returned_candidates - missing_ratio_or_guidance,
            returned_candidates,
        ),
        provenance_or_confidence_coverage=_ratio(
            returned_candidates - missing_provenance_or_confidence,
            returned_candidates,
        ),
        explanation_coverage=_ratio(
            returned_candidates - missing_explanations,
            returned_candidates,
        ),
        caution_compliance=_ratio(case_count - caution_mismatches, case_count),
        empty_result_accuracy=_ratio(empty_result_matches, empty_cases),
    )

    reasons: list[str] = []
    if case_count == 0 or nonempty_cases == 0:
        status: SubstitutionEvaluationStatus = "insufficient_data"
        reasons.append("insufficient_benchmark_cases")
    else:
        if metrics.exact_ranking_accuracy != Decimal("1.000000"):
            reasons.append("ranking_mismatch")
        if metrics.candidate_recall != Decimal("1.000000"):
            reasons.append("candidate_retrieval_incomplete")
        if non_direct_outputs:
            reasons.append("non_direct_output")
        if constraint_violations:
            reasons.append("constraint_violation")
        if missing_ratio_or_guidance:
            reasons.append("missing_ratio_or_guidance")
        if missing_provenance_or_confidence:
            reasons.append("missing_provenance_or_confidence")
        if missing_explanations:
            reasons.append("missing_explanation")
        if caution_mismatches:
            reasons.append("caution_mismatch")
        if empty_cases and metrics.empty_result_accuracy != Decimal("1.000000"):
            reasons.append("empty_result_mismatch")
        status = "invalid" if reasons else "engineering_validated"

    limitations = tuple(sorted(REQUIRED_LIMITATIONS))
    run_material = {
        "schema_version": SUBSTITUTION_EVALUATION_REPORT_SCHEMA_VERSION,
        "protocol_version": SUBSTITUTION_EVALUATION_PROTOCOL_VERSION,
        "benchmark_sha256": benchmark.sha256,
        "strategy": SUBSTITUTION_RULES_STRATEGY,
    }
    return SubstitutionEvaluationReport(
        schema_version=SUBSTITUTION_EVALUATION_REPORT_SCHEMA_VERSION,
        protocol_version=SUBSTITUTION_EVALUATION_PROTOCOL_VERSION,
        run_id=hashlib.sha256(canonical_json(run_material).encode("utf-8")).hexdigest(),
        benchmark_sha256=benchmark.sha256,
        status=status,
        reason_codes=tuple(reasons),
        strategy=SUBSTITUTION_RULES_STRATEGY,
        learned_ranking_attempted=False,
        counts=counts,
        metrics=metrics,
        limitations=limitations,
    )


def substitution_evaluation_report_to_document(
    report: SubstitutionEvaluationReport,
) -> dict[str, object]:
    return report_envelope(
        schema_version=report.schema_version,
        protocol_version=report.protocol_version,
        run_id=report.run_id,
        status=report.status,
        reason_codes=report.reason_codes,
        limitations=report.limitations,
        payload={
            "benchmark_sha256": report.benchmark_sha256,
            "strategy": report.strategy,
            "learned_ranking_attempted": report.learned_ranking_attempted,
            "counts": {
                "cases": report.counts.cases,
                "cases_with_expected_results": report.counts.cases_with_expected_results,
                "empty_expected_cases": report.counts.empty_expected_cases,
                "exact_ranking_matches": report.counts.exact_ranking_matches,
                "top1_matches": report.counts.top1_matches,
                "expected_candidates": report.counts.expected_candidates,
                "returned_candidates": report.counts.returned_candidates,
                "matching_candidates": report.counts.matching_candidates,
                "direct_candidates_considered": report.counts.direct_candidates_considered,
                "eligible_candidates": report.counts.eligible_candidates,
                "dietary_filtered": report.counts.dietary_filtered,
                "allergen_filtered": report.counts.allergen_filtered,
                "non_direct_outputs": report.counts.non_direct_outputs,
                "constraint_violations": report.counts.constraint_violations,
                "missing_ratio_or_guidance": report.counts.missing_ratio_or_guidance,
                "missing_provenance_or_confidence": (
                    report.counts.missing_provenance_or_confidence
                ),
                "missing_explanations": report.counts.missing_explanations,
                "caution_mismatches": report.counts.caution_mismatches,
            },
            "metrics": {
                "exact_ranking_accuracy": decimal_text(
                    report.metrics.exact_ranking_accuracy, places=6
                ),
                "top1_accuracy": decimal_text(report.metrics.top1_accuracy, places=6),
                "candidate_recall": decimal_text(report.metrics.candidate_recall, places=6),
                "direct_edge_precision": decimal_text(
                    report.metrics.direct_edge_precision, places=6
                ),
                "constraint_compliance": decimal_text(
                    report.metrics.constraint_compliance, places=6
                ),
                "ratio_or_guidance_coverage": decimal_text(
                    report.metrics.ratio_or_guidance_coverage, places=6
                ),
                "provenance_or_confidence_coverage": decimal_text(
                    report.metrics.provenance_or_confidence_coverage, places=6
                ),
                "explanation_coverage": decimal_text(report.metrics.explanation_coverage, places=6),
                "caution_compliance": decimal_text(report.metrics.caution_compliance, places=6),
                "empty_result_accuracy": decimal_text(
                    report.metrics.empty_result_accuracy, places=6
                ),
            },
        },
    )


def substitution_evaluation_report_to_json(report: SubstitutionEvaluationReport) -> str:
    return serialize_report_document(substitution_evaluation_report_to_document(report))


__all__ = [
    "METRIC_QUANTUM",
    "REQUIRED_LIMITATIONS",
    "SUBSTITUTION_EVALUATION_PROTOCOL_VERSION",
    "SUBSTITUTION_EVALUATION_REPORT_SCHEMA_VERSION",
    "SubstitutionEvaluationCounts",
    "SubstitutionEvaluationMetrics",
    "SubstitutionEvaluationReport",
    "SubstitutionEvaluationStatus",
    "evaluate_substitution_rules",
    "substitution_evaluation_report_to_document",
    "substitution_evaluation_report_to_json",
]
