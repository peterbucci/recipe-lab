from __future__ import annotations

import hashlib

from app.services.recipe_duplicate_scoring import (
    DUPLICATE_CANDIDATE_PARAMETER_HASH,
    DUPLICATE_CANDIDATE_SCORING_ALGORITHM_VERSION,
)
from app.services.recipe_fingerprints import STRUCTURAL_FINGERPRINT_ALGORITHM_VERSION

from .dataset import canonical_json
from .duplicate_aggregation import aggregate_duplicate_outcomes
from .duplicate_dataset import DuplicateBenchmark, validate_duplicate_benchmark
from .duplicate_execution import execute_validated_duplicate_benchmark
from .duplicate_report import (
    DUPLICATE_EVALUATION_PROTOCOL_VERSION,
    DUPLICATE_EVALUATION_REPORT_SCHEMA_VERSION,
    REQUIRED_DUPLICATE_EVALUATION_LIMITATIONS,
    DuplicateClassCounts,
    DuplicateErrorCategory,
    DuplicateEvaluationCounts,
    DuplicateEvaluationMetrics,
    DuplicateEvaluationReport,
    DuplicateEvaluationStatus,
    duplicate_evaluation_report_to_document,
    duplicate_evaluation_report_to_json,
)
from .metrics import METRIC_QUANTUM


def evaluate_duplicate_candidates(benchmark: DuplicateBenchmark) -> DuplicateEvaluationReport:
    """Validate, execute, aggregate, and describe the production duplicate scorer."""

    normalized_benchmark = validate_duplicate_benchmark(benchmark)
    aggregate = aggregate_duplicate_outcomes(
        execute_validated_duplicate_benchmark(normalized_benchmark)
    )
    run_material = {
        "benchmark_sha256": normalized_benchmark.sha256,
        "parameter_sha256": DUPLICATE_CANDIDATE_PARAMETER_HASH,
        "protocol_version": DUPLICATE_EVALUATION_PROTOCOL_VERSION,
        "schema_version": DUPLICATE_EVALUATION_REPORT_SCHEMA_VERSION,
        "scoring_algorithm_version": DUPLICATE_CANDIDATE_SCORING_ALGORITHM_VERSION,
        "structure_version": STRUCTURAL_FINGERPRINT_ALGORITHM_VERSION,
    }
    return DuplicateEvaluationReport(
        schema_version=DUPLICATE_EVALUATION_REPORT_SCHEMA_VERSION,
        protocol_version=DUPLICATE_EVALUATION_PROTOCOL_VERSION,
        run_id=hashlib.sha256(canonical_json(run_material).encode("utf-8")).hexdigest(),
        benchmark_sha256=normalized_benchmark.sha256,
        status=aggregate.status,
        reason_codes=aggregate.reason_codes,
        advisory_only=True,
        learned_classifier_attempted=False,
        counts=aggregate.counts,
        confusion_matrix=aggregate.confusion_matrix,
        metrics=aggregate.metrics,
        false_positive_categories=aggregate.false_positive_categories,
        false_negative_categories=aggregate.false_negative_categories,
        classification_mismatch_categories=aggregate.classification_mismatch_categories,
        component_mismatch_categories=aggregate.component_mismatch_categories,
        explanation_mismatch_categories=aggregate.explanation_mismatch_categories,
        limitations=tuple(sorted(REQUIRED_DUPLICATE_EVALUATION_LIMITATIONS)),
    )


__all__ = [
    "DUPLICATE_EVALUATION_PROTOCOL_VERSION",
    "DUPLICATE_EVALUATION_REPORT_SCHEMA_VERSION",
    "METRIC_QUANTUM",
    "REQUIRED_DUPLICATE_EVALUATION_LIMITATIONS",
    "DuplicateClassCounts",
    "DuplicateErrorCategory",
    "DuplicateEvaluationCounts",
    "DuplicateEvaluationMetrics",
    "DuplicateEvaluationReport",
    "DuplicateEvaluationStatus",
    "duplicate_evaluation_report_to_document",
    "duplicate_evaluation_report_to_json",
    "evaluate_duplicate_candidates",
]
