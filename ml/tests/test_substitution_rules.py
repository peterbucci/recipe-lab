from dataclasses import replace
from decimal import Decimal
from fractions import Fraction
from typing import cast
from uuid import UUID

import pytest

from recipe_lab_evaluation.substitution_dataset import (
    SubstitutionBenchmark,
    SubstitutionBenchmarkCase,
)
from recipe_lab_evaluation.substitution_rules import (
    MAX_SUBSTITUTION_RESULTS,
    SUBSTITUTION_CAUTION,
    SUBSTITUTION_RULES_STRATEGY,
    CuratedSubstitution,
    SubstitutionCatalog,
    SubstitutionQuery,
    SubstitutionResult,
    load_bundled_substitution_catalog,
    recommend_substitutions,
)


def _case(benchmark: SubstitutionBenchmark, case_id: str) -> SubstitutionBenchmarkCase:
    return next(case for case in benchmark.cases if case.id == case_id)


def _recommend_case(
    benchmark: SubstitutionBenchmark,
    case_id: str,
) -> SubstitutionResult:
    case = _case(benchmark, case_id)
    recipes = {recipe.id: recipe for recipe in benchmark.catalog.recipe_contexts}
    return recommend_substitutions(
        benchmark.catalog,
        SubstitutionQuery(
            source_ingredient_id=case.source_ingredient_id,
            recipe_ingredient_ids=recipes[case.recipe_context_id].ingredient_ids,
            constraints=case.constraints,
            preference_weights={
                preference.ingredient_id: preference.weight
                for preference in case.preference_weights
            },
            limit=case.limit,
        ),
    )


def _relationship_for(
    catalog: SubstitutionCatalog,
    source_name: str,
    replacement_name: str,
) -> CuratedSubstitution:
    ingredients = {ingredient.name.casefold(): ingredient.id for ingredient in catalog.ingredients}
    source_id = ingredients[source_name.casefold()]
    replacement_id = ingredients[replacement_name.casefold()]
    return next(
        relationship
        for relationship in catalog.relationships
        if relationship.source_ingredient_id == source_id
        and relationship.replacement_ingredient_id == replacement_id
    )


def test_fixture_context_and_preference_components_rank_candidates_deterministically(
    substitution_benchmark: SubstitutionBenchmark,
) -> None:
    context_result = _recommend_case(substitution_benchmark, "pancake-context")
    preference_result = _recommend_case(
        substitution_benchmark,
        "preference-breaks-context-tie",
    )

    assert [item.replacement.name for item in context_result.items] == [
        "Oat milk",
        "Almond milk",
        "Coconut milk",
    ]
    assert [item.components.recipe_context_similarity for item in context_result.items] == [
        Fraction(1),
        Fraction(1, 3),
        Fraction(0),
    ]
    assert [item.replacement.name for item in preference_result.items] == [
        "Almond milk",
        "Coconut milk",
        "Oat milk",
    ]
    assert [item.components.preference_affinity for item in preference_result.items] == [
        Fraction(1),
        Fraction(1, 4),
        Fraction(-1, 2),
    ]
    assert not context_result.personalized
    assert preference_result.personalized


def test_declared_constraints_are_hard_filters_and_override_preferences(
    substitution_benchmark: SubstitutionBenchmark,
) -> None:
    constrained = _recommend_case(
        substitution_benchmark,
        "constraint-overrides-preference",
    )

    assert [item.replacement.name for item in constrained.items] == ["Coconut milk"]
    assert constrained.direct_candidate_count == 3
    assert constrained.eligible_candidate_count == 1
    assert constrained.filtered_dietary_count == 1
    assert constrained.filtered_allergen_count == 1
    assert constrained.items[0].components.preference_affinity == 0
    assert "passed the requested declared-tag checks" in constrained.items[0].explanation


def test_only_direct_curated_edges_are_returned_and_missing_edges_stay_empty(
    substitution_benchmark: SubstitutionBenchmark,
) -> None:
    cream = _recommend_case(
        substitution_benchmark,
        "direct-only-no-transitive-expansion",
    )
    salt = _recommend_case(substitution_benchmark, "empty-when-no-curated-edge")

    assert [item.replacement.name for item in cream.items] == ["Milk"]
    assert cream.direct_candidate_count == cream.eligible_candidate_count == 1
    assert salt.items == ()
    assert salt.direct_candidate_count == salt.eligible_candidate_count == 0


def test_output_retains_ratio_guidance_provenance_explanation_and_caution(
    substitution_benchmark: SubstitutionBenchmark,
) -> None:
    result = _recommend_case(substitution_benchmark, "pancake-context")
    by_name = {item.replacement.name: item for item in result.items}

    assert result.strategy == SUBSTITUTION_RULES_STRATEGY
    assert by_name["Oat milk"].quantity_ratio == Decimal("1.0000")
    assert by_name["Oat milk"].guidance is None
    assert by_name["Coconut milk"].quantity_ratio is None
    assert by_name["Coconut milk"].guidance == (
        "Use the same volume only when coconut flavor suits the recipe."
    )
    assert all(item.provenance == "Synthetic RCP-20 engineering fixture." for item in result.items)
    assert all(
        item.explanation.startswith("Curated direct replacement for Milk.") for item in result.items
    )
    forbidden_claims = ("safe", "allergen-free", "medical", "guarante")
    assert all(
        claim not in item.explanation.casefold()
        for item in result.items
        for claim in forbidden_claims
    )
    assert result.caution == SUBSTITUTION_CAUTION
    assert "Missing data is unknown" in result.caution
    assert "cross-contact" in result.caution
    assert "qualified advice" in result.caution


def test_bundled_catalog_adapter_preserves_the_existing_curated_relationships() -> None:
    catalog = load_bundled_substitution_catalog()
    ingredients = {ingredient.name.casefold(): ingredient for ingredient in catalog.ingredients}
    walnut = ingredients["walnut"]
    pecan = ingredients["pecan"]

    result = recommend_substitutions(
        catalog,
        SubstitutionQuery(
            source_ingredient_id=walnut.id,
            recipe_ingredient_ids=frozenset({walnut.id}),
        ),
    )
    reverse = recommend_substitutions(
        catalog,
        SubstitutionQuery(
            source_ingredient_id=pecan.id,
            recipe_ingredient_ids=frozenset({pecan.id}),
        ),
    )

    assert len(catalog.ingredients) == 99
    assert len(catalog.relationships) == 12
    assert [item.replacement.name for item in result.items] == ["Pecan"]
    assert result.items[0].quantity_ratio == Decimal("1.0000")
    assert result.items[0].guidance is None
    assert result.items[0].components.relationship_confidence is None
    assert result.items[0].provenance == (
        "Recipe Lab Demo Catalog v1; independently curated demo relationship."
    )
    assert reverse.items == ()


def test_candidate_and_catalog_order_do_not_change_results(
    substitution_benchmark: SubstitutionBenchmark,
) -> None:
    original = _recommend_case(substitution_benchmark, "pancake-context")
    reordered_catalog = replace(
        substitution_benchmark.catalog,
        dietary_flags=tuple(reversed(substitution_benchmark.catalog.dietary_flags)),
        allergens=tuple(reversed(substitution_benchmark.catalog.allergens)),
        ingredients=tuple(reversed(substitution_benchmark.catalog.ingredients)),
        relationships=tuple(reversed(substitution_benchmark.catalog.relationships)),
        recipe_contexts=tuple(reversed(substitution_benchmark.catalog.recipe_contexts)),
    )
    reordered_benchmark = replace(substitution_benchmark, catalog=reordered_catalog)
    reordered = _recommend_case(reordered_benchmark, "pancake-context")

    assert reordered == original


def test_documented_confidence_precedes_provenance_only_even_when_numerically_lower(
    substitution_benchmark: SubstitutionBenchmark,
) -> None:
    catalog = substitution_benchmark.catalog
    oat = _relationship_for(catalog, "Milk", "Oat milk")
    coconut = _relationship_for(catalog, "Milk", "Coconut milk")
    almond = _relationship_for(catalog, "Milk", "Almond milk")
    catalog = replace(
        catalog,
        relationships=(
            replace(oat, relationship_confidence=None),
            replace(coconut, relationship_confidence=Decimal("0.0000")),
            replace(almond, relationship_confidence=None),
            *catalog.relationships[3:],
        ),
        recipe_contexts=(),
    )
    milk_id = oat.source_ingredient_id

    result = recommend_substitutions(
        catalog,
        SubstitutionQuery(
            source_ingredient_id=milk_id,
            recipe_ingredient_ids=frozenset({milk_id}),
        ),
    )

    assert [item.replacement.name for item in result.items] == [
        "Coconut milk",
        "Almond milk",
        "Oat milk",
    ]


@pytest.mark.parametrize(
    "limit",
    [
        0,
        MAX_SUBSTITUTION_RESULTS + 1,
        True,
        "1",
        None,
        1.0,
        Decimal("1"),
        Fraction(1),
    ],
)
def test_query_rejects_invalid_limits(
    substitution_benchmark: SubstitutionBenchmark,
    limit: object,
) -> None:
    case = _case(substitution_benchmark, "pancake-context")

    with pytest.raises(ValueError, match="limit"):
        recommend_substitutions(
            substitution_benchmark.catalog,
            SubstitutionQuery(
                source_ingredient_id=case.source_ingredient_id,
                recipe_ingredient_ids=frozenset({case.source_ingredient_id}),
                limit=cast(int, limit),
            ),
        )


@pytest.mark.parametrize(
    ("query", "message"),
    [
        (
            lambda case: SubstitutionQuery(
                source_ingredient_id=UUID("ffffffff-ffff-4fff-8fff-ffffffffffff"),
                recipe_ingredient_ids=frozenset({case.source_ingredient_id}),
            ),
            "source ingredient",
        ),
        (
            lambda case: SubstitutionQuery(
                source_ingredient_id=case.source_ingredient_id,
                recipe_ingredient_ids=frozenset({UUID("ffffffff-ffff-4fff-8fff-ffffffffffff")}),
            ),
            "recipe context",
        ),
        (
            lambda case: SubstitutionQuery(
                source_ingredient_id=case.source_ingredient_id,
                recipe_ingredient_ids=frozenset({case.source_ingredient_id}),
                constraints=replace(
                    case.constraints,
                    required_dietary_flag_ids=frozenset(
                        {UUID("ffffffff-ffff-4fff-8fff-ffffffffffff")}
                    ),
                ),
            ),
            "dietary constraint",
        ),
        (
            lambda case: SubstitutionQuery(
                source_ingredient_id=case.source_ingredient_id,
                recipe_ingredient_ids=frozenset({case.source_ingredient_id}),
                constraints=replace(
                    case.constraints,
                    excluded_allergen_ids=frozenset({UUID("ffffffff-ffff-4fff-8fff-ffffffffffff")}),
                ),
            ),
            "allergen constraint",
        ),
        (
            lambda case: SubstitutionQuery(
                source_ingredient_id=case.source_ingredient_id,
                recipe_ingredient_ids=frozenset({case.source_ingredient_id}),
                preference_weights={
                    UUID("ffffffff-ffff-4fff-8fff-ffffffffffff"): 1,
                },
            ),
            "preference",
        ),
        (
            lambda case: SubstitutionQuery(
                source_ingredient_id=case.source_ingredient_id,
                recipe_ingredient_ids=frozenset({case.source_ingredient_id}),
                preference_weights={
                    UUID("30000000-0000-4000-8000-000000000006"): 1,
                },
            ),
            "direct replacement candidates",
        ),
        (
            lambda case: SubstitutionQuery(
                source_ingredient_id=case.source_ingredient_id,
                recipe_ingredient_ids=frozenset({UUID("30000000-0000-4000-8000-000000000006")}),
            ),
            "absent from the recipe context",
        ),
    ],
    ids=[
        "source",
        "context",
        "dietary",
        "allergen",
        "unknown-preference",
        "non-direct-preference",
        "source-absent",
    ],
)
def test_query_rejects_unknown_identifiers(
    substitution_benchmark: SubstitutionBenchmark,
    query: object,
    message: str,
) -> None:
    case = _case(substitution_benchmark, "pancake-context")

    with pytest.raises(ValueError, match=message):
        recommend_substitutions(
            substitution_benchmark.catalog,
            query(case),  # type: ignore[operator]
        )


@pytest.mark.parametrize(
    "weight",
    [True, 1.5, "1"],
)
def test_query_rejects_non_integer_preference_weights(
    substitution_benchmark: SubstitutionBenchmark,
    weight: object,
) -> None:
    case = _case(substitution_benchmark, "pancake-context")
    replacement_id = case.expected_ranking[0]

    with pytest.raises(ValueError, match="preference weights"):
        recommend_substitutions(
            substitution_benchmark.catalog,
            SubstitutionQuery(
                source_ingredient_id=case.source_ingredient_id,
                recipe_ingredient_ids=frozenset({case.source_ingredient_id}),
                preference_weights={replacement_id: weight},  # type: ignore[dict-item]
            ),
        )


@pytest.mark.parametrize(
    ("catalog_mutation", "message"),
    [
        (
            lambda catalog: replace(
                catalog,
                ingredients=(*catalog.ingredients, catalog.ingredients[0]),
            ),
            "ingredient IDs must be unique",
        ),
        (
            lambda catalog: replace(
                catalog,
                ingredients=(
                    replace(
                        catalog.ingredients[0],
                        dietary_flag_ids=frozenset({UUID("ffffffff-ffff-4fff-8fff-ffffffffffff")}),
                    ),
                    *catalog.ingredients[1:],
                ),
            ),
            "unknown metadata",
        ),
        (
            lambda catalog: replace(
                catalog,
                relationships=(*catalog.relationships, catalog.relationships[0]),
            ),
            "relationship IDs must be unique",
        ),
        (
            lambda catalog: replace(
                catalog,
                relationships=(
                    replace(
                        catalog.relationships[0],
                        replacement_ingredient_id=catalog.relationships[0].source_ingredient_id,
                    ),
                    *catalog.relationships[1:],
                ),
            ),
            "cannot replace an ingredient with itself",
        ),
        (
            lambda catalog: replace(
                catalog,
                relationships=(
                    replace(catalog.relationships[0], quantity_ratio=None, guidance=None),
                    *catalog.relationships[1:],
                ),
            ),
            "requires a ratio or guidance",
        ),
        (
            lambda catalog: replace(
                catalog,
                relationships=(
                    replace(
                        catalog.relationships[0],
                        provenance=None,
                        relationship_confidence=None,
                    ),
                    *catalog.relationships[1:],
                ),
            ),
            "requires provenance or confidence",
        ),
        (
            lambda catalog: replace(
                catalog,
                relationships=(
                    replace(
                        catalog.relationships[0],
                        relationship_confidence=Decimal("1.0001"),
                    ),
                    *catalog.relationships[1:],
                ),
            ),
            "between zero and one",
        ),
    ],
    ids=[
        "duplicate-ingredient",
        "unknown-metadata",
        "duplicate-relationship",
        "self-edge",
        "missing-guidance",
        "missing-evidence",
        "confidence-range",
    ],
)
def test_rules_reject_malformed_catalogs(
    substitution_benchmark: SubstitutionBenchmark,
    catalog_mutation: object,
    message: str,
) -> None:
    case = _case(substitution_benchmark, "pancake-context")
    catalog = catalog_mutation(substitution_benchmark.catalog)  # type: ignore[operator]

    with pytest.raises(ValueError, match=message):
        recommend_substitutions(
            catalog,
            SubstitutionQuery(
                source_ingredient_id=case.source_ingredient_id,
                recipe_ingredient_ids=frozenset({case.source_ingredient_id}),
            ),
        )
