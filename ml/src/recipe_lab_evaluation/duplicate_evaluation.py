from __future__ import annotations

import hashlib
from collections import Counter
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction
from typing import Literal

from app.services.recipe_duplicate_scoring import (
    ACTION_ORDER_SUBWEIGHT,
    DUPLICATE_CANDIDATE_PARAMETER_HASH,
    DUPLICATE_CANDIDATE_SCORING_ALGORITHM_VERSION,
    DUPLICATE_PAIR_WORK_ESTIMATE,
    DURATION_TEMPERATURE_SUBWEIGHT,
    INGREDIENT_MULTISET_WEIGHT,
    MAX_DUPLICATE_ACTIONS,
    MAX_DUPLICATE_FLATTENED_INPUTS,
    MAX_DUPLICATE_INGREDIENT_OCCURRENCES,
    MAX_DUPLICATE_PAIR_WORK_UNITS,
    MAX_DUPLICATE_REASONS,
    NORMALIZED_QUANTITY_WEIGHT,
    ORDERED_INPUT_SUBWEIGHT,
    PROBABLE_DUPLICATE_THRESHOLD,
    STRUCTURED_ACTION_WEIGHT,
    DuplicateClassification,
    score_recipe_duplicate_candidate,
)
from app.services.recipe_fingerprints import (
    STRUCTURAL_FINGERPRINT_ALGORITHM_VERSION,
    build_structural_fingerprint,
)

from .dataset import canonical_json
from .duplicate_dataset import (
    REQUIRED_DUPLICATE_BENCHMARK_CATEGORIES,
    DuplicateBenchmark,
    DuplicateBenchmarkCategory,
    DuplicateComponentExpectations,
    duplicate_benchmark_to_json,
    parse_duplicate_benchmark_json,
)
from .reporting import decimal_text, report_envelope, serialize_report_document

DUPLICATE_EVALUATION_REPORT_SCHEMA_VERSION = "recipe-lab-duplicate-evaluation-report-v1"
DUPLICATE_EVALUATION_PROTOCOL_VERSION = "labeled-structural-pair-evaluation-v1"
METRIC_QUANTUM = Decimal("0.000001")

type DuplicateEvaluationStatus = Literal[
    "engineering_validated",
    "invalid",
    "insufficient_data",
]

_CLASSIFICATIONS: tuple[DuplicateClassification, ...] = (
    "exact_duplicate",
    "probable_duplicate",
    "distinct",
)

REQUIRED_DUPLICATE_EVALUATION_LIMITATIONS = (
    "The benchmark is a small hand-authored synthetic fixture with no confidence intervals.",
    "No independent human adjudication or real recipe-pair prevalence is available.",
    (
        "Coverage measures synthetic fixture cases and required perturbation categories, "
        "not the public catalog or a recipe population."
    ),
    (
        "The structural fingerprint omits prose, equipment, technique nuance, geometry, "
        "and doneness."
    ),
    (
        "The labels are engineering-policy examples, not findings of culinary identity, "
        "plagiarism, or copyright infringement."
    ),
    "These metrics cannot justify blocking publication or merging or deleting recipes.",
    "No learned classifier, user behavior, or cooking outcomes were trained or evaluated.",
)


@dataclass(frozen=True, slots=True)
class DuplicateClassCounts:
    exact_duplicate: int
    probable_duplicate: int
    distinct: int


@dataclass(frozen=True, slots=True)
class DuplicateEvaluationCounts:
    cases: int
    evaluated_cases: int
    classification_matches: int
    expected: DuplicateClassCounts
    predicted: DuplicateClassCounts
    expected_positive: int
    predicted_positive: int
    true_positives: int
    false_positives: int
    false_negatives: int
    cases_with_complete_explanations: int
    cases_matching_expected_components: int
    required_categories: int
    covered_categories: int


@dataclass(frozen=True, slots=True)
class DuplicateEvaluationMetrics:
    precision: Decimal | None
    recall: Decimal | None
    three_class_accuracy: Decimal | None
    evaluated_coverage: Decimal | None
    category_coverage: Decimal | None
    component_expectation_coverage: Decimal | None
    explanation_coverage: Decimal | None


@dataclass(frozen=True, slots=True)
class DuplicateErrorCategory:
    category: DuplicateBenchmarkCategory
    count: int


@dataclass(frozen=True, slots=True)
class DuplicateEvaluationReport:
    schema_version: str
    protocol_version: str
    run_id: str
    benchmark_sha256: str
    status: DuplicateEvaluationStatus
    reason_codes: tuple[str, ...]
    advisory_only: bool
    learned_classifier_attempted: bool
    counts: DuplicateEvaluationCounts
    confusion_matrix: dict[DuplicateClassification, dict[DuplicateClassification, int]]
    metrics: DuplicateEvaluationMetrics
    false_positive_categories: tuple[DuplicateErrorCategory, ...]
    false_negative_categories: tuple[DuplicateErrorCategory, ...]
    classification_mismatch_categories: tuple[DuplicateErrorCategory, ...]
    component_mismatch_categories: tuple[DuplicateErrorCategory, ...]
    explanation_mismatch_categories: tuple[DuplicateErrorCategory, ...]
    limitations: tuple[str, ...]


def _ratio(numerator: int, denominator: int) -> Decimal | None:
    if denominator == 0:
        return None
    return (Decimal(numerator) / Decimal(denominator)).quantize(
        METRIC_QUANTUM,
        rounding=ROUND_HALF_UP,
    )


def _fraction_metric(value: Fraction) -> str:
    return format(
        (Decimal(value.numerator) / Decimal(value.denominator)).quantize(
            METRIC_QUANTUM,
            rounding=ROUND_HALF_UP,
        ),
        ".6f",
    )


def _class_counts(values: Counter[str]) -> DuplicateClassCounts:
    return DuplicateClassCounts(
        exact_duplicate=values["exact_duplicate"],
        probable_duplicate=values["probable_duplicate"],
        distinct=values["distinct"],
    )


def _error_categories(
    values: Counter[DuplicateBenchmarkCategory],
) -> tuple[DuplicateErrorCategory, ...]:
    return tuple(
        DuplicateErrorCategory(category=category, count=values[category])
        for category in sorted(values)
    )


def _components_match(
    expectations: DuplicateComponentExpectations,
    *,
    ingredient_multiset: Fraction,
    normalized_quantities: Fraction,
    action_order: Fraction,
    ordered_inputs: Fraction,
    duration_temperature: Fraction,
    structured_actions: Fraction,
) -> bool:
    values = {
        "action_order": action_order,
        "duration_temperature": duration_temperature,
        "ingredient_multiset": ingredient_multiset,
        "normalized_quantities": normalized_quantities,
        "ordered_inputs": ordered_inputs,
        "structured_actions": structured_actions,
    }
    return all(
        value == 1 if getattr(expectations, name) == "one" else value < 1
        for name, value in values.items()
    )


def evaluate_duplicate_candidates(benchmark: DuplicateBenchmark) -> DuplicateEvaluationReport:
    """Evaluate the production duplicate scorer against labeled structural pairs."""

    benchmark = parse_duplicate_benchmark_json(duplicate_benchmark_to_json(benchmark))
    recipes = {item.id: item for item in benchmark.recipes}
    expected_counts: Counter[str] = Counter()
    predicted_counts: Counter[str] = Counter()
    false_positive_categories: Counter[DuplicateBenchmarkCategory] = Counter()
    false_negative_categories: Counter[DuplicateBenchmarkCategory] = Counter()
    mismatch_categories: Counter[DuplicateBenchmarkCategory] = Counter()
    component_mismatch_categories: Counter[DuplicateBenchmarkCategory] = Counter()
    explanation_mismatch_categories: Counter[DuplicateBenchmarkCategory] = Counter()
    confusion: dict[DuplicateClassification, dict[DuplicateClassification, int]] = {
        expected: {predicted: 0 for predicted in _CLASSIFICATIONS} for expected in _CLASSIFICATIONS
    }

    matches = 0
    true_positives = 0
    false_positives = 0
    false_negatives = 0
    complete_explanations = 0
    matching_components = 0
    evaluated = 0
    covered_categories: set[DuplicateBenchmarkCategory] = set()

    for case in benchmark.cases:
        left = build_structural_fingerprint(recipes[case.left_recipe_id].structure)
        right = build_structural_fingerprint(recipes[case.right_recipe_id].structure)
        if left is None or right is None:
            continue
        result = score_recipe_duplicate_candidate(left, right)
        predicted = result.classification
        expected = case.expected_classification
        evaluated += 1
        covered_categories.add(case.category)
        expected_counts[expected] += 1
        predicted_counts[predicted] += 1
        confusion[expected][predicted] += 1
        is_match = predicted == expected
        matches += int(is_match)
        if not is_match:
            mismatch_categories[case.category] += 1

        expected_positive = expected != "distinct"
        predicted_positive = predicted != "distinct"
        true_positives += int(expected_positive and predicted_positive)
        false_positives += int(not expected_positive and predicted_positive)
        false_negatives += int(expected_positive and not predicted_positive)
        if not expected_positive and predicted_positive:
            false_positive_categories[case.category] += 1
        if expected_positive and not predicted_positive:
            false_negative_categories[case.category] += 1

        explanation_codes = tuple(reason.code for reason in result.reasons)
        explanation_matches = (
            explanation_codes == case.expected_reason_codes
            and len(explanation_codes) <= MAX_DUPLICATE_REASONS
            and len(explanation_codes) == len(set(explanation_codes))
            and all(reason.message.strip() for reason in result.reasons)
        )
        if explanation_matches:
            complete_explanations += 1
        else:
            explanation_mismatch_categories[case.category] += 1

        components_match = _components_match(
            case.expected_components,
            ingredient_multiset=result.components.ingredient_multiset,
            normalized_quantities=result.components.normalized_quantities,
            action_order=result.components.action_order,
            ordered_inputs=result.components.ordered_inputs,
            duration_temperature=result.components.duration_temperature,
            structured_actions=result.components.structured_actions,
        )
        if components_match:
            matching_components += 1
        else:
            component_mismatch_categories[case.category] += 1

    case_count = len(benchmark.cases)
    expected_positive_count = sum(
        expected_counts[classification]
        for classification in ("exact_duplicate", "probable_duplicate")
    )
    predicted_positive_count = sum(
        predicted_counts[classification]
        for classification in ("exact_duplicate", "probable_duplicate")
    )
    counts = DuplicateEvaluationCounts(
        cases=case_count,
        evaluated_cases=evaluated,
        classification_matches=matches,
        expected=_class_counts(expected_counts),
        predicted=_class_counts(predicted_counts),
        expected_positive=expected_positive_count,
        predicted_positive=predicted_positive_count,
        true_positives=true_positives,
        false_positives=false_positives,
        false_negatives=false_negatives,
        cases_with_complete_explanations=complete_explanations,
        cases_matching_expected_components=matching_components,
        required_categories=len(REQUIRED_DUPLICATE_BENCHMARK_CATEGORIES),
        covered_categories=len(covered_categories),
    )
    metrics = DuplicateEvaluationMetrics(
        precision=_ratio(true_positives, true_positives + false_positives),
        recall=_ratio(true_positives, true_positives + false_negatives),
        three_class_accuracy=_ratio(matches, evaluated),
        evaluated_coverage=_ratio(evaluated, case_count),
        category_coverage=_ratio(
            len(covered_categories), len(REQUIRED_DUPLICATE_BENCHMARK_CATEGORIES)
        ),
        component_expectation_coverage=_ratio(matching_components, evaluated),
        explanation_coverage=_ratio(complete_explanations, evaluated),
    )

    validation_reasons: list[str] = []
    if case_count == 0 or evaluated == 0:
        status: DuplicateEvaluationStatus = "insufficient_data"
        validation_reasons.append("insufficient_benchmark_cases")
    else:
        if evaluated != case_count:
            validation_reasons.append("unevaluated_case")
        if matches != evaluated:
            validation_reasons.append("classification_mismatch")
        if set(REQUIRED_DUPLICATE_BENCHMARK_CATEGORIES) - covered_categories:
            validation_reasons.append("required_category_missing")
        if complete_explanations != evaluated:
            validation_reasons.append("explanation_mismatch")
        if matching_components != evaluated:
            validation_reasons.append("component_expectation_mismatch")
        status = "invalid" if validation_reasons else "engineering_validated"

    run_material = {
        "benchmark_sha256": benchmark.sha256,
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
        benchmark_sha256=benchmark.sha256,
        status=status,
        reason_codes=tuple(validation_reasons),
        advisory_only=True,
        learned_classifier_attempted=False,
        counts=counts,
        confusion_matrix=confusion,
        metrics=metrics,
        false_positive_categories=_error_categories(false_positive_categories),
        false_negative_categories=_error_categories(false_negative_categories),
        classification_mismatch_categories=_error_categories(mismatch_categories),
        component_mismatch_categories=_error_categories(component_mismatch_categories),
        explanation_mismatch_categories=_error_categories(explanation_mismatch_categories),
        limitations=tuple(sorted(REQUIRED_DUPLICATE_EVALUATION_LIMITATIONS)),
    )


def _class_counts_document(counts: DuplicateClassCounts) -> dict[str, int]:
    return {
        "distinct": counts.distinct,
        "exact_duplicate": counts.exact_duplicate,
        "probable_duplicate": counts.probable_duplicate,
    }


def _category_document(
    values: tuple[DuplicateErrorCategory, ...],
) -> list[dict[str, object]]:
    return [{"category": item.category, "count": item.count} for item in values]


def duplicate_evaluation_report_to_document(
    report: DuplicateEvaluationReport,
) -> dict[str, object]:
    return report_envelope(
        schema_version=report.schema_version,
        protocol_version=report.protocol_version,
        run_id=report.run_id,
        status=report.status,
        reason_codes=report.reason_codes,
        limitations=report.limitations,
        payload={
            "advisory_only": report.advisory_only,
            "benchmark_sha256": report.benchmark_sha256,
            "confusion_matrix": {
                expected: {
                    predicted: report.confusion_matrix[expected][predicted]
                    for predicted in _CLASSIFICATIONS
                }
                for expected in _CLASSIFICATIONS
            },
            "counts": {
                "cases": report.counts.cases,
                "cases_with_complete_explanations": (
                    report.counts.cases_with_complete_explanations
                ),
                "cases_matching_expected_components": (
                    report.counts.cases_matching_expected_components
                ),
                "classification_matches": report.counts.classification_matches,
                "covered_categories": report.counts.covered_categories,
                "evaluated_cases": report.counts.evaluated_cases,
                "expected": _class_counts_document(report.counts.expected),
                "expected_positive": report.counts.expected_positive,
                "false_negatives": report.counts.false_negatives,
                "false_positives": report.counts.false_positives,
                "predicted": _class_counts_document(report.counts.predicted),
                "predicted_positive": report.counts.predicted_positive,
                "required_categories": report.counts.required_categories,
                "true_positives": report.counts.true_positives,
            },
            "error_categories": {
                "classification_mismatches": _category_document(
                    report.classification_mismatch_categories
                ),
                "component_mismatches": _category_document(report.component_mismatch_categories),
                "explanation_mismatches": _category_document(
                    report.explanation_mismatch_categories
                ),
                "false_negatives": _category_document(report.false_negative_categories),
                "false_positives": _category_document(report.false_positive_categories),
            },
            "learned_classifier_attempted": report.learned_classifier_attempted,
            "metrics": {
                "category_coverage": decimal_text(report.metrics.category_coverage, places=6),
                "component_expectation_coverage": decimal_text(
                    report.metrics.component_expectation_coverage, places=6
                ),
                "evaluated_coverage": decimal_text(report.metrics.evaluated_coverage, places=6),
                "explanation_coverage": decimal_text(report.metrics.explanation_coverage, places=6),
                "precision": decimal_text(report.metrics.precision, places=6),
                "recall": decimal_text(report.metrics.recall, places=6),
                "three_class_accuracy": decimal_text(report.metrics.three_class_accuracy, places=6),
            },
            "positive_classifications": ["exact_duplicate", "probable_duplicate"],
            "required_categories": list(REQUIRED_DUPLICATE_BENCHMARK_CATEGORIES),
            "scoring": {
                "action_subweights": {
                    "action_order": _fraction_metric(ACTION_ORDER_SUBWEIGHT),
                    "duration_temperature": _fraction_metric(DURATION_TEMPERATURE_SUBWEIGHT),
                    "ordered_inputs": _fraction_metric(ORDERED_INPUT_SUBWEIGHT),
                },
                "algorithm": "deterministic_explainable_structural_similarity",
                "algorithm_version": DUPLICATE_CANDIDATE_SCORING_ALGORITHM_VERSION,
                "capacity": {
                    "maximum_actions_per_structure": MAX_DUPLICATE_ACTIONS,
                    "maximum_flattened_inputs_per_structure": MAX_DUPLICATE_FLATTENED_INPUTS,
                    "maximum_ingredient_occurrences_per_structure": (
                        MAX_DUPLICATE_INGREDIENT_OCCURRENCES
                    ),
                    "maximum_nonexact_pair_work_units": MAX_DUPLICATE_PAIR_WORK_UNITS,
                    "overflow_behavior": "fail_closed",
                    "pair_work_estimate": DUPLICATE_PAIR_WORK_ESTIMATE,
                },
                "maximum_reasons": MAX_DUPLICATE_REASONS,
                "parameter_sha256": DUPLICATE_CANDIDATE_PARAMETER_HASH,
                "probable_duplicate_threshold": _fraction_metric(PROBABLE_DUPLICATE_THRESHOLD),
                "structure_version": STRUCTURAL_FINGERPRINT_ALGORITHM_VERSION,
                "weights": {
                    "ingredient_multiset": _fraction_metric(INGREDIENT_MULTISET_WEIGHT),
                    "normalized_quantities": _fraction_metric(NORMALIZED_QUANTITY_WEIGHT),
                    "structured_actions": _fraction_metric(STRUCTURED_ACTION_WEIGHT),
                },
            },
        },
    )


def duplicate_evaluation_report_to_json(report: DuplicateEvaluationReport) -> str:
    return serialize_report_document(duplicate_evaluation_report_to_document(report))


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
