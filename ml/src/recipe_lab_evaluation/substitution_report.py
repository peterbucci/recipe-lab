from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

from .reporting import decimal_text, report_envelope, serialize_report_document

SUBSTITUTION_EVALUATION_REPORT_SCHEMA_VERSION = "recipe-lab-substitution-evaluation-report-v1"
SUBSTITUTION_EVALUATION_PROTOCOL_VERSION = "curated-direct-rules-benchmark-v1"

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
    "REQUIRED_LIMITATIONS",
    "SUBSTITUTION_EVALUATION_PROTOCOL_VERSION",
    "SUBSTITUTION_EVALUATION_REPORT_SCHEMA_VERSION",
    "SubstitutionEvaluationCounts",
    "SubstitutionEvaluationMetrics",
    "SubstitutionEvaluationReport",
    "SubstitutionEvaluationStatus",
    "substitution_evaluation_report_to_document",
    "substitution_evaluation_report_to_json",
]
