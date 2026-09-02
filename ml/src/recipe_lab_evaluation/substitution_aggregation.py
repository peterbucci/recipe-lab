from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from .metrics import ratio_metric
from .substitution_execution import SubstitutionCaseOutcome
from .substitution_report import (
    SubstitutionEvaluationCounts,
    SubstitutionEvaluationMetrics,
    SubstitutionEvaluationStatus,
)


@dataclass(frozen=True, slots=True)
class SubstitutionEvaluationAggregate:
    status: SubstitutionEvaluationStatus
    reason_codes: tuple[str, ...]
    counts: SubstitutionEvaluationCounts
    metrics: SubstitutionEvaluationMetrics


def aggregate_substitution_outcomes(
    outcomes: tuple[SubstitutionCaseOutcome, ...],
) -> SubstitutionEvaluationAggregate:
    case_count = len(outcomes)
    nonempty_cases = sum(outcome.expected_nonempty for outcome in outcomes)
    empty_cases = case_count - nonempty_cases
    exact_ranking_matches = sum(outcome.exact_ranking_match for outcome in outcomes)
    top1_matches = sum(outcome.top1_match for outcome in outcomes)
    expected_candidates = sum(outcome.expected_candidates for outcome in outcomes)
    returned_candidates = sum(outcome.returned_candidates for outcome in outcomes)
    matching_candidates = sum(outcome.matching_candidates for outcome in outcomes)
    non_direct_outputs = sum(outcome.non_direct_outputs for outcome in outcomes)
    constraint_violations = sum(outcome.constraint_violations for outcome in outcomes)
    missing_ratio_or_guidance = sum(outcome.missing_ratio_or_guidance for outcome in outcomes)
    missing_provenance_or_confidence = sum(
        outcome.missing_provenance_or_confidence for outcome in outcomes
    )
    missing_explanations = sum(outcome.missing_explanations for outcome in outcomes)
    caution_mismatches = sum(outcome.caution_mismatch for outcome in outcomes)
    empty_result_matches = sum(outcome.empty_result_match for outcome in outcomes)

    counts = SubstitutionEvaluationCounts(
        cases=case_count,
        cases_with_expected_results=nonempty_cases,
        empty_expected_cases=empty_cases,
        exact_ranking_matches=exact_ranking_matches,
        top1_matches=top1_matches,
        expected_candidates=expected_candidates,
        returned_candidates=returned_candidates,
        matching_candidates=matching_candidates,
        direct_candidates_considered=sum(
            outcome.direct_candidates_considered for outcome in outcomes
        ),
        eligible_candidates=sum(outcome.eligible_candidates for outcome in outcomes),
        dietary_filtered=sum(outcome.dietary_filtered for outcome in outcomes),
        allergen_filtered=sum(outcome.allergen_filtered for outcome in outcomes),
        non_direct_outputs=non_direct_outputs,
        constraint_violations=constraint_violations,
        missing_ratio_or_guidance=missing_ratio_or_guidance,
        missing_provenance_or_confidence=missing_provenance_or_confidence,
        missing_explanations=missing_explanations,
        caution_mismatches=caution_mismatches,
    )
    metrics = SubstitutionEvaluationMetrics(
        exact_ranking_accuracy=ratio_metric(exact_ranking_matches, case_count),
        top1_accuracy=ratio_metric(top1_matches, nonempty_cases),
        candidate_recall=ratio_metric(matching_candidates, expected_candidates),
        direct_edge_precision=ratio_metric(
            returned_candidates - non_direct_outputs,
            returned_candidates,
        ),
        constraint_compliance=ratio_metric(
            returned_candidates - constraint_violations,
            returned_candidates,
        ),
        ratio_or_guidance_coverage=ratio_metric(
            returned_candidates - missing_ratio_or_guidance,
            returned_candidates,
        ),
        provenance_or_confidence_coverage=ratio_metric(
            returned_candidates - missing_provenance_or_confidence,
            returned_candidates,
        ),
        explanation_coverage=ratio_metric(
            returned_candidates - missing_explanations,
            returned_candidates,
        ),
        caution_compliance=ratio_metric(case_count - caution_mismatches, case_count),
        empty_result_accuracy=ratio_metric(empty_result_matches, empty_cases),
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
    return SubstitutionEvaluationAggregate(
        status=status,
        reason_codes=tuple(reasons),
        counts=counts,
        metrics=metrics,
    )


__all__ = ["SubstitutionEvaluationAggregate", "aggregate_substitution_outcomes"]
