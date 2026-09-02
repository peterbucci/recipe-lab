from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from .substitution_dataset import SubstitutionBenchmark
from .substitution_rules import (
    SUBSTITUTION_CAUTION,
    SubstitutionQuery,
    recommend_substitutions,
)


@dataclass(frozen=True, slots=True)
class SubstitutionCaseOutcome:
    expected_nonempty: bool
    exact_ranking_match: bool
    top1_match: bool
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
    caution_mismatch: bool
    empty_result_match: bool


def _constraints_hold(
    *,
    dietary_flags: frozenset[UUID],
    allergens: frozenset[UUID],
    required_dietary_flags: frozenset[UUID],
    excluded_allergens: frozenset[UUID],
) -> bool:
    return required_dietary_flags <= dietary_flags and not (excluded_allergens & allergens)


def execute_validated_substitution_benchmark(
    benchmark: SubstitutionBenchmark,
) -> tuple[SubstitutionCaseOutcome, ...]:
    """Execute rules for a benchmark already validated at the public boundary."""

    recipes = {recipe.id: recipe for recipe in benchmark.catalog.recipe_contexts}
    direct_pairs = {
        (relationship.source_ingredient_id, relationship.replacement_ingredient_id)
        for relationship in benchmark.catalog.relationships
    }
    outcomes: list[SubstitutionCaseOutcome] = []
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
        outcomes.append(
            SubstitutionCaseOutcome(
                expected_nonempty=bool(expected),
                exact_ranking_match=actual == expected,
                top1_match=bool(expected and actual and actual[0] == expected[0]),
                expected_candidates=len(expected),
                returned_candidates=len(actual),
                matching_candidates=len(set(actual) & set(expected)),
                direct_candidates_considered=result.direct_candidate_count,
                eligible_candidates=result.eligible_candidate_count,
                dietary_filtered=result.filtered_dietary_count,
                allergen_filtered=result.filtered_allergen_count,
                non_direct_outputs=sum(
                    (case.source_ingredient_id, item.replacement.id) not in direct_pairs
                    for item in result.items
                ),
                constraint_violations=sum(
                    not _constraints_hold(
                        dietary_flags=item.replacement.dietary_flag_ids,
                        allergens=item.replacement.allergen_ids,
                        required_dietary_flags=case.constraints.required_dietary_flag_ids,
                        excluded_allergens=case.constraints.excluded_allergen_ids,
                    )
                    for item in result.items
                ),
                missing_ratio_or_guidance=sum(
                    item.quantity_ratio is None and item.guidance is None for item in result.items
                ),
                missing_provenance_or_confidence=sum(
                    item.provenance is None and item.components.relationship_confidence is None
                    for item in result.items
                ),
                missing_explanations=sum(not item.explanation.strip() for item in result.items),
                caution_mismatch=result.caution != SUBSTITUTION_CAUTION,
                empty_result_match=not expected and not actual,
            )
        )
    return tuple(outcomes)


__all__ = ["SubstitutionCaseOutcome", "execute_validated_substitution_benchmark"]
