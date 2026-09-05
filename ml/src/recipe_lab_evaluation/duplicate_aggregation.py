from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from app.services.recipe_duplicate_scoring import DuplicateClassification

from .duplicate_dataset import (
    REQUIRED_DUPLICATE_BENCHMARK_CATEGORIES,
    DuplicateBenchmarkCategory,
)
from .duplicate_execution import DuplicateCaseOutcome
from .duplicate_report import (
    DUPLICATE_CLASSIFICATIONS,
    DuplicateClassCounts,
    DuplicateErrorCategory,
    DuplicateEvaluationCounts,
    DuplicateEvaluationMetrics,
    DuplicateEvaluationStatus,
)
from .metrics import ratio_metric

_POSITIVE_CLASSIFICATIONS: tuple[DuplicateClassification, ...] = (
    "exact_duplicate",
    "probable_duplicate",
)


@dataclass(frozen=True, slots=True)
class DuplicateEvaluationAggregate:
    status: DuplicateEvaluationStatus
    reason_codes: tuple[str, ...]
    counts: DuplicateEvaluationCounts
    confusion_matrix: dict[DuplicateClassification, dict[DuplicateClassification, int]]
    metrics: DuplicateEvaluationMetrics
    false_positive_categories: tuple[DuplicateErrorCategory, ...]
    false_negative_categories: tuple[DuplicateErrorCategory, ...]
    classification_mismatch_categories: tuple[DuplicateErrorCategory, ...]
    component_mismatch_categories: tuple[DuplicateErrorCategory, ...]
    explanation_mismatch_categories: tuple[DuplicateErrorCategory, ...]


def _class_counts(values: Counter[DuplicateClassification]) -> DuplicateClassCounts:
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


def aggregate_duplicate_outcomes(
    outcomes: tuple[DuplicateCaseOutcome, ...],
) -> DuplicateEvaluationAggregate:
    expected_counts: Counter[DuplicateClassification] = Counter()
    predicted_counts: Counter[DuplicateClassification] = Counter()
    false_positive_categories: Counter[DuplicateBenchmarkCategory] = Counter()
    false_negative_categories: Counter[DuplicateBenchmarkCategory] = Counter()
    mismatch_categories: Counter[DuplicateBenchmarkCategory] = Counter()
    component_mismatch_categories: Counter[DuplicateBenchmarkCategory] = Counter()
    explanation_mismatch_categories: Counter[DuplicateBenchmarkCategory] = Counter()
    confusion: dict[DuplicateClassification, dict[DuplicateClassification, int]] = {
        expected: {predicted: 0 for predicted in DUPLICATE_CLASSIFICATIONS}
        for expected in DUPLICATE_CLASSIFICATIONS
    }
    covered_categories: set[DuplicateBenchmarkCategory] = set()
    matches = 0
    true_positives = 0
    false_positives = 0
    false_negatives = 0
    complete_explanations = 0
    matching_components = 0
    evaluated = 0

    for outcome in outcomes:
        if outcome.predicted is None:
            continue
        expected = outcome.expected
        predicted = outcome.predicted
        evaluated += 1
        covered_categories.add(outcome.category)
        expected_counts[expected] += 1
        predicted_counts[predicted] += 1
        confusion[expected][predicted] += 1
        classification_matches = predicted == expected
        matches += int(classification_matches)
        if not classification_matches:
            mismatch_categories[outcome.category] += 1

        expected_positive = expected != "distinct"
        predicted_positive = predicted != "distinct"
        true_positives += int(expected_positive and predicted_positive)
        false_positives += int(not expected_positive and predicted_positive)
        false_negatives += int(expected_positive and not predicted_positive)
        if not expected_positive and predicted_positive:
            false_positive_categories[outcome.category] += 1
        if expected_positive and not predicted_positive:
            false_negative_categories[outcome.category] += 1
        if outcome.explanation_matches:
            complete_explanations += 1
        else:
            explanation_mismatch_categories[outcome.category] += 1
        if outcome.components_match:
            matching_components += 1
        else:
            component_mismatch_categories[outcome.category] += 1

    case_count = len(outcomes)
    expected_positive_count = sum(
        expected_counts[classification] for classification in _POSITIVE_CLASSIFICATIONS
    )
    predicted_positive_count = sum(
        predicted_counts[classification] for classification in _POSITIVE_CLASSIFICATIONS
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
        precision=ratio_metric(true_positives, true_positives + false_positives),
        recall=ratio_metric(true_positives, true_positives + false_negatives),
        three_class_accuracy=ratio_metric(matches, evaluated),
        evaluated_coverage=ratio_metric(evaluated, case_count),
        category_coverage=ratio_metric(
            len(covered_categories), len(REQUIRED_DUPLICATE_BENCHMARK_CATEGORIES)
        ),
        component_expectation_coverage=ratio_metric(matching_components, evaluated),
        explanation_coverage=ratio_metric(complete_explanations, evaluated),
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
    return DuplicateEvaluationAggregate(
        status=status,
        reason_codes=tuple(validation_reasons),
        counts=counts,
        confusion_matrix=confusion,
        metrics=metrics,
        false_positive_categories=_error_categories(false_positive_categories),
        false_negative_categories=_error_categories(false_negative_categories),
        classification_mismatch_categories=_error_categories(mismatch_categories),
        component_mismatch_categories=_error_categories(component_mismatch_categories),
        explanation_mismatch_categories=_error_categories(explanation_mismatch_categories),
    )


__all__ = ["DuplicateEvaluationAggregate", "aggregate_duplicate_outcomes"]
