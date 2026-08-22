from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from fractions import Fraction
from uuid import UUID

from app.seeds.catalog import load_bundled_catalog
from app.seeds.identifiers import seed_uuid
from app.seeds.schema import SeedCatalog

SUBSTITUTION_RULES_STRATEGY = "substitution-rules-v1"
SUBSTITUTION_RULES_VERSION = "1"
MAX_SUBSTITUTION_RESULTS = 20
DEFAULT_RELATIONSHIP_CONFIDENCE = Fraction(1, 2)
SUBSTITUTION_CAUTION = (
    "Ingredient metadata records positive demo declarations only. Missing data is unknown; "
    "verify current product labels and cross-contact information, and seek qualified advice "
    "when needed."
)


@dataclass(frozen=True, slots=True)
class SubstitutionTaxonomyTerm:
    id: UUID
    name: str


@dataclass(frozen=True, slots=True)
class SubstitutionIngredient:
    id: UUID
    name: str
    dietary_flag_ids: frozenset[UUID]
    allergen_ids: frozenset[UUID]


@dataclass(frozen=True, slots=True)
class CuratedSubstitution:
    id: UUID
    source_ingredient_id: UUID
    replacement_ingredient_id: UUID
    quantity_ratio: Decimal | None
    guidance: str | None
    notes: str | None
    provenance: str | None
    relationship_confidence: Decimal | None


@dataclass(frozen=True, slots=True)
class SubstitutionRecipeContext:
    id: UUID
    ingredient_ids: frozenset[UUID]


@dataclass(frozen=True, slots=True)
class SubstitutionCatalog:
    dataset_id: str
    dietary_flags: tuple[SubstitutionTaxonomyTerm, ...]
    allergens: tuple[SubstitutionTaxonomyTerm, ...]
    ingredients: tuple[SubstitutionIngredient, ...]
    relationships: tuple[CuratedSubstitution, ...]
    recipe_contexts: tuple[SubstitutionRecipeContext, ...]


@dataclass(frozen=True, slots=True)
class SubstitutionConstraints:
    required_dietary_flag_ids: frozenset[UUID] = frozenset()
    excluded_allergen_ids: frozenset[UUID] = frozenset()


@dataclass(frozen=True, slots=True)
class SubstitutionQuery:
    source_ingredient_id: UUID
    recipe_ingredient_ids: frozenset[UUID]
    constraints: SubstitutionConstraints = SubstitutionConstraints()
    preference_weights: Mapping[UUID, int] | None = None
    limit: int = MAX_SUBSTITUTION_RESULTS


@dataclass(frozen=True, slots=True)
class SubstitutionComponents:
    relationship_confidence: Decimal | None
    recipe_context_similarity: Fraction
    preference_affinity: Fraction


@dataclass(frozen=True, slots=True)
class SubstitutionRecommendation:
    relationship_id: UUID
    replacement: SubstitutionIngredient
    quantity_ratio: Decimal | None
    guidance: str | None
    notes: str | None
    provenance: str | None
    components: SubstitutionComponents
    explanation: str


@dataclass(frozen=True, slots=True)
class SubstitutionResult:
    strategy: str
    source_ingredient: SubstitutionIngredient
    constraints: SubstitutionConstraints
    personalized: bool
    direct_candidate_count: int
    eligible_candidate_count: int
    filtered_dietary_count: int
    filtered_allergen_count: int
    items: tuple[SubstitutionRecommendation, ...]
    caution: str


def _normalized_name(value: str) -> str:
    return value.strip().casefold()


def validate_substitution_catalog(catalog: SubstitutionCatalog) -> None:
    """Validate the immutable catalog contract used by the rules engine."""

    if not catalog.dataset_id.strip():
        raise ValueError("substitution catalog dataset_id must not be blank")
    ingredients = {ingredient.id: ingredient for ingredient in catalog.ingredients}
    if len(ingredients) != len(catalog.ingredients):
        raise ValueError("substitution catalog ingredient IDs must be unique")
    dietary_flag_ids = {term.id for term in catalog.dietary_flags}
    allergen_ids = {term.id for term in catalog.allergens}
    if len(dietary_flag_ids) != len(catalog.dietary_flags):
        raise ValueError("substitution catalog dietary flag IDs must be unique")
    if len(allergen_ids) != len(catalog.allergens):
        raise ValueError("substitution catalog allergen IDs must be unique")
    if any(not term.name.strip() for term in (*catalog.dietary_flags, *catalog.allergens)):
        raise ValueError("substitution catalog taxonomy names must not be blank")
    if any(
        not ingredient.name.strip()
        or not ingredient.dietary_flag_ids <= dietary_flag_ids
        or not ingredient.allergen_ids <= allergen_ids
        for ingredient in catalog.ingredients
    ):
        raise ValueError("substitution catalog ingredients reference unknown metadata")

    relationship_ids: set[UUID] = set()
    directed_pairs: set[tuple[UUID, UUID]] = set()
    for relationship in catalog.relationships:
        if relationship.id in relationship_ids:
            raise ValueError("substitution relationship IDs must be unique")
        relationship_ids.add(relationship.id)
        pair = (relationship.source_ingredient_id, relationship.replacement_ingredient_id)
        if pair in directed_pairs:
            raise ValueError("substitution relationships must be unique and directed")
        directed_pairs.add(pair)
        if pair[0] not in ingredients or pair[1] not in ingredients:
            raise ValueError("substitution relationship references an unknown ingredient")
        if pair[0] == pair[1]:
            raise ValueError("substitution relationship cannot replace an ingredient with itself")
        if relationship.quantity_ratio is None and relationship.guidance is None:
            raise ValueError("substitution relationship requires a ratio or guidance")
        if relationship.quantity_ratio is not None:
            if not relationship.quantity_ratio.is_finite() or relationship.quantity_ratio <= 0:
                raise ValueError("substitution quantity ratio must be finite and positive")
        if relationship.guidance is not None and not relationship.guidance.strip():
            raise ValueError("substitution relationship guidance must not be blank")
        if relationship.notes is not None and not relationship.notes.strip():
            raise ValueError("substitution relationship notes must not be blank")
        if relationship.provenance is not None and not relationship.provenance.strip():
            raise ValueError("substitution relationship provenance must not be blank")
        if relationship.provenance is None and relationship.relationship_confidence is None:
            raise ValueError("substitution relationship requires provenance or confidence")
        confidence = relationship.relationship_confidence
        if confidence is not None:
            if not confidence.is_finite() or not Decimal(0) <= confidence <= Decimal(1):
                raise ValueError(
                    "substitution relationship confidence must be finite and between zero and one"
                )

    recipe_ids: set[UUID] = set()
    for recipe in catalog.recipe_contexts:
        if recipe.id in recipe_ids:
            raise ValueError("substitution recipe context IDs must be unique")
        recipe_ids.add(recipe.id)
        if not recipe.ingredient_ids <= frozenset(ingredients):
            raise ValueError("substitution recipe context references an unknown ingredient")


def _jaccard(left: frozenset[UUID], right: frozenset[UUID]) -> Fraction:
    if not left or not right:
        return Fraction(0)
    return Fraction(len(left & right), len(left | right))


def _context_similarity(
    *,
    source_ingredient_id: UUID,
    replacement_ingredient_id: UUID,
    recipe_ingredient_ids: frozenset[UUID],
    recipe_contexts: Sequence[SubstitutionRecipeContext],
) -> Fraction:
    target_context = recipe_ingredient_ids - {source_ingredient_id}
    similarities = (
        _jaccard(target_context, recipe.ingredient_ids - {replacement_ingredient_id})
        for recipe in recipe_contexts
        if replacement_ingredient_id in recipe.ingredient_ids
    )
    return max(similarities, default=Fraction(0))


def _preference_affinity(
    replacement_ingredient_id: UUID,
    preference_weights: Mapping[UUID, int],
) -> Fraction:
    maximum = max((abs(value) for value in preference_weights.values()), default=0)
    if maximum == 0:
        return Fraction(0)
    return Fraction(preference_weights.get(replacement_ingredient_id, 0), maximum)


def _confidence_fraction(value: Decimal | None) -> Fraction:
    if value is None:
        return DEFAULT_RELATIONSHIP_CONFIDENCE
    return Fraction(value)


def _explanation(
    *,
    source_name: str,
    confidence: Decimal | None,
    context_similarity: Fraction,
    preference_affinity: Fraction,
    constrained: bool,
) -> str:
    relationship_text = (
        "The curated relationship includes a documented confidence value."
        if confidence is not None
        else "The curated relationship is supported by recorded provenance."
    )
    context_text = (
        "Similar recipe contexts supported its position."
        if context_similarity > 0
        else "No matching recipe-context evidence changed its position."
    )
    if preference_affinity > 0:
        preference_text = "Available preference signals favored this replacement."
    elif preference_affinity < 0:
        preference_text = "Available preference signals weighed against this replacement."
    else:
        preference_text = "No preference signal changed its position."
    constraint_text = (
        "It passed the requested declared-tag checks."
        if constrained
        else "No dietary or allergen tag filters were requested."
    )
    return (
        f"Curated direct replacement for {source_name}. {relationship_text} "
        f"{context_text} {preference_text} {constraint_text}"
    )


def recommend_substitutions(
    catalog: SubstitutionCatalog,
    query: SubstitutionQuery,
) -> SubstitutionResult:
    """Return deterministic direct substitutions after hard constraint filtering."""

    validate_substitution_catalog(catalog)
    if type(query.limit) is not int or not 1 <= query.limit <= MAX_SUBSTITUTION_RESULTS:
        raise ValueError(f"substitution limit must be between 1 and {MAX_SUBSTITUTION_RESULTS}")
    ingredients = {ingredient.id: ingredient for ingredient in catalog.ingredients}
    source = ingredients.get(query.source_ingredient_id)
    if source is None:
        raise ValueError("substitution source ingredient is outside the catalog")
    if not query.recipe_ingredient_ids <= ingredients.keys():
        raise ValueError("substitution recipe context references an unknown ingredient")
    if source.id not in query.recipe_ingredient_ids:
        raise ValueError("substitution source ingredient is absent from the recipe context")
    known_dietary_flags = {term.id for term in catalog.dietary_flags}
    known_allergens = {term.id for term in catalog.allergens}
    if not query.constraints.required_dietary_flag_ids <= known_dietary_flags:
        raise ValueError("substitution query contains an unknown dietary constraint")
    if not query.constraints.excluded_allergen_ids <= known_allergens:
        raise ValueError("substitution query contains an unknown allergen constraint")

    preference_weights = query.preference_weights or {}
    if any(
        isinstance(value, bool) or not isinstance(value, int)
        for value in preference_weights.values()
    ):
        raise ValueError("substitution preference weights must be integers")
    if not frozenset(preference_weights) <= frozenset(ingredients):
        raise ValueError("substitution preference weights reference an unknown ingredient")
    personalized = any(weight != 0 for weight in preference_weights.values())
    direct = tuple(
        relationship
        for relationship in catalog.relationships
        if relationship.source_ingredient_id == source.id
    )
    direct_replacement_ids = frozenset(
        relationship.replacement_ingredient_id for relationship in direct
    )
    if not frozenset(preference_weights) <= direct_replacement_ids:
        raise ValueError(
            "substitution preference weights must reference direct replacement candidates"
        )
    dietary_filtered = 0
    allergen_filtered = 0
    scored: list[tuple[SubstitutionRecommendation, Fraction]] = []
    constrained = bool(
        query.constraints.required_dietary_flag_ids or query.constraints.excluded_allergen_ids
    )
    for relationship in direct:
        replacement = ingredients[relationship.replacement_ingredient_id]
        missing_dietary = not query.constraints.required_dietary_flag_ids <= (
            replacement.dietary_flag_ids
        )
        allergen_conflict = bool(query.constraints.excluded_allergen_ids & replacement.allergen_ids)
        dietary_filtered += int(missing_dietary)
        allergen_filtered += int(allergen_conflict)
        if missing_dietary or allergen_conflict:
            continue

        context_similarity = _context_similarity(
            source_ingredient_id=source.id,
            replacement_ingredient_id=replacement.id,
            recipe_ingredient_ids=query.recipe_ingredient_ids,
            recipe_contexts=catalog.recipe_contexts,
        )
        preference_affinity = _preference_affinity(replacement.id, preference_weights)
        recommendation = SubstitutionRecommendation(
            relationship_id=relationship.id,
            replacement=replacement,
            quantity_ratio=relationship.quantity_ratio,
            guidance=relationship.guidance,
            notes=relationship.notes,
            provenance=relationship.provenance,
            components=SubstitutionComponents(
                relationship_confidence=relationship.relationship_confidence,
                recipe_context_similarity=context_similarity,
                preference_affinity=preference_affinity,
            ),
            explanation=_explanation(
                source_name=source.name,
                confidence=relationship.relationship_confidence,
                context_similarity=context_similarity,
                preference_affinity=preference_affinity,
                constrained=constrained,
            ),
        )
        scored.append((recommendation, _confidence_fraction(relationship.relationship_confidence)))

    scored.sort(
        key=lambda item: (
            item[0].components.relationship_confidence is None,
            -item[1],
            -item[0].components.recipe_context_similarity,
            -item[0].components.preference_affinity,
            _normalized_name(item[0].replacement.name),
            item[0].replacement.id.int,
        )
    )
    items = tuple(item[0] for item in scored[: query.limit])
    return SubstitutionResult(
        strategy=SUBSTITUTION_RULES_STRATEGY,
        source_ingredient=source,
        constraints=query.constraints,
        personalized=personalized,
        direct_candidate_count=len(direct),
        eligible_candidate_count=len(scored),
        filtered_dietary_count=dietary_filtered,
        filtered_allergen_count=allergen_filtered,
        items=items,
        caution=SUBSTITUTION_CAUTION,
    )


def catalog_from_seed(seed: SeedCatalog) -> SubstitutionCatalog:
    """Build the rules catalog from the validated packaged demo catalog."""

    dataset_id = seed.metadata.dataset_id
    ingredient_ids = {
        ingredient.key: seed_uuid(dataset_id, "ingredient", ingredient.key)
        for ingredient in seed.ingredients
    }
    dietary_flag_ids = {
        flag.key: seed_uuid(dataset_id, "dietary-flag", flag.key) for flag in seed.dietary_flags
    }
    allergen_ids = {
        allergen.key: seed_uuid(dataset_id, "allergen", allergen.key) for allergen in seed.allergens
    }
    catalog = SubstitutionCatalog(
        dataset_id=dataset_id,
        dietary_flags=tuple(
            SubstitutionTaxonomyTerm(id=dietary_flag_ids[flag.key], name=flag.name)
            for flag in seed.dietary_flags
        ),
        allergens=tuple(
            SubstitutionTaxonomyTerm(id=allergen_ids[allergen.key], name=allergen.name)
            for allergen in seed.allergens
        ),
        ingredients=tuple(
            SubstitutionIngredient(
                id=ingredient_ids[ingredient.key],
                name=ingredient.canonical_name,
                dietary_flag_ids=frozenset(
                    dietary_flag_ids[flag] for flag in ingredient.dietary_flags
                ),
                allergen_ids=frozenset(allergen_ids[item] for item in ingredient.allergens),
            )
            for ingredient in seed.ingredients
        ),
        relationships=tuple(
            CuratedSubstitution(
                id=seed_uuid(
                    dataset_id,
                    "ingredient-substitution",
                    f"{relationship.source}-to-{relationship.replacement}",
                ),
                source_ingredient_id=ingredient_ids[relationship.source],
                replacement_ingredient_id=ingredient_ids[relationship.replacement],
                quantity_ratio=relationship.quantity_ratio,
                guidance=relationship.guidance,
                notes=relationship.notes,
                provenance=relationship.provenance,
                relationship_confidence=relationship.confidence,
            )
            for relationship in seed.substitutions
        ),
        recipe_contexts=tuple(
            SubstitutionRecipeContext(
                id=seed_uuid(dataset_id, "recipe-version", recipe.key),
                ingredient_ids=frozenset(
                    ingredient_ids[item.ingredient] for item in recipe.ingredients
                ),
            )
            for recipe in seed.recipes
        ),
    )
    validate_substitution_catalog(catalog)
    return catalog


def load_bundled_substitution_catalog() -> SubstitutionCatalog:
    return catalog_from_seed(load_bundled_catalog())


__all__ = [
    "DEFAULT_RELATIONSHIP_CONFIDENCE",
    "MAX_SUBSTITUTION_RESULTS",
    "SUBSTITUTION_CAUTION",
    "SUBSTITUTION_RULES_STRATEGY",
    "SUBSTITUTION_RULES_VERSION",
    "CuratedSubstitution",
    "SubstitutionCatalog",
    "SubstitutionComponents",
    "SubstitutionConstraints",
    "SubstitutionIngredient",
    "SubstitutionQuery",
    "SubstitutionRecipeContext",
    "SubstitutionRecommendation",
    "SubstitutionResult",
    "SubstitutionTaxonomyTerm",
    "catalog_from_seed",
    "load_bundled_substitution_catalog",
    "recommend_substitutions",
    "validate_substitution_catalog",
]
