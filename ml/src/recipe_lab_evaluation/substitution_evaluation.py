from __future__ import annotations

import hashlib

from .dataset import canonical_json
from .metrics import METRIC_QUANTUM
from .substitution_aggregation import aggregate_substitution_outcomes
from .substitution_dataset import SubstitutionBenchmark, validate_substitution_benchmark
from .substitution_execution import execute_validated_substitution_benchmark
from .substitution_report import (
    REQUIRED_LIMITATIONS,
    SUBSTITUTION_EVALUATION_PROTOCOL_VERSION,
    SUBSTITUTION_EVALUATION_REPORT_SCHEMA_VERSION,
    SubstitutionEvaluationCounts,
    SubstitutionEvaluationMetrics,
    SubstitutionEvaluationReport,
    SubstitutionEvaluationStatus,
    substitution_evaluation_report_to_document,
    substitution_evaluation_report_to_json,
)
from .substitution_rules import SUBSTITUTION_RULES_STRATEGY


def evaluate_substitution_rules(
    benchmark: SubstitutionBenchmark,
) -> SubstitutionEvaluationReport:
    """Validate, execute, aggregate, and describe the deterministic rules benchmark."""

    normalized_benchmark = validate_substitution_benchmark(benchmark)
    aggregate = aggregate_substitution_outcomes(
        execute_validated_substitution_benchmark(normalized_benchmark)
    )
    run_material = {
        "schema_version": SUBSTITUTION_EVALUATION_REPORT_SCHEMA_VERSION,
        "protocol_version": SUBSTITUTION_EVALUATION_PROTOCOL_VERSION,
        "benchmark_sha256": normalized_benchmark.sha256,
        "strategy": SUBSTITUTION_RULES_STRATEGY,
    }
    return SubstitutionEvaluationReport(
        schema_version=SUBSTITUTION_EVALUATION_REPORT_SCHEMA_VERSION,
        protocol_version=SUBSTITUTION_EVALUATION_PROTOCOL_VERSION,
        run_id=hashlib.sha256(canonical_json(run_material).encode("utf-8")).hexdigest(),
        benchmark_sha256=normalized_benchmark.sha256,
        status=aggregate.status,
        reason_codes=aggregate.reason_codes,
        strategy=SUBSTITUTION_RULES_STRATEGY,
        learned_ranking_attempted=False,
        counts=aggregate.counts,
        metrics=aggregate.metrics,
        limitations=tuple(sorted(REQUIRED_LIMITATIONS)),
    )


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
