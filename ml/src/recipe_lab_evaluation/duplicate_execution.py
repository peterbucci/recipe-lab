from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction

from app.services.recipe_duplicate_scoring import (
    MAX_DUPLICATE_REASONS,
    DuplicateClassification,
    score_recipe_duplicate_candidate,
)
from app.services.recipe_fingerprints import build_structural_fingerprint

from .duplicate_dataset import (
    DuplicateBenchmark,
    DuplicateBenchmarkCategory,
    DuplicateComponentExpectations,
)


@dataclass(frozen=True, slots=True)
class DuplicateCaseOutcome:
    category: DuplicateBenchmarkCategory
    expected: DuplicateClassification
    predicted: DuplicateClassification | None
    explanation_matches: bool
    components_match: bool

    @property
    def evaluated(self) -> bool:
        return self.predicted is not None


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


def execute_validated_duplicate_benchmark(
    benchmark: DuplicateBenchmark,
) -> tuple[DuplicateCaseOutcome, ...]:
    """Run the production scorer for a benchmark validated at the public boundary."""

    recipes = {item.id: item for item in benchmark.recipes}
    outcomes: list[DuplicateCaseOutcome] = []
    for case in benchmark.cases:
        left = build_structural_fingerprint(recipes[case.left_recipe_id].structure)
        right = build_structural_fingerprint(recipes[case.right_recipe_id].structure)
        if left is None or right is None:
            outcomes.append(
                DuplicateCaseOutcome(
                    category=case.category,
                    expected=case.expected_classification,
                    predicted=None,
                    explanation_matches=False,
                    components_match=False,
                )
            )
            continue
        result = score_recipe_duplicate_candidate(left, right)
        explanation_codes = tuple(reason.code for reason in result.reasons)
        outcomes.append(
            DuplicateCaseOutcome(
                category=case.category,
                expected=case.expected_classification,
                predicted=result.classification,
                explanation_matches=(
                    explanation_codes == case.expected_reason_codes
                    and len(explanation_codes) <= MAX_DUPLICATE_REASONS
                    and len(explanation_codes) == len(set(explanation_codes))
                    and all(reason.message.strip() for reason in result.reasons)
                ),
                components_match=_components_match(
                    case.expected_components,
                    ingredient_multiset=result.components.ingredient_multiset,
                    normalized_quantities=result.components.normalized_quantities,
                    action_order=result.components.action_order,
                    ordered_inputs=result.components.ordered_inputs,
                    duration_temperature=result.components.duration_temperature,
                    structured_actions=result.components.structured_actions,
                ),
            )
        )
    return tuple(outcomes)


__all__ = ["DuplicateCaseOutcome", "execute_validated_duplicate_benchmark"]
