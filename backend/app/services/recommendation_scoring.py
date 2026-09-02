from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal
from uuid import UUID

BASELINE_STRATEGY: Literal["baseline-v1"] = "baseline-v1"
RATING_PRIOR_MEAN = Decimal("3")
RATING_PRIOR_STRENGTH = Decimal("5")
QUALITY_WEIGHT = Decimal("0.55")
SAVE_POPULARITY_WEIGHT = Decimal("0.20")
FORK_POPULARITY_WEIGHT = Decimal("0.15")
VIEW_POPULARITY_WEIGHT = Decimal("0.10")
PERSONALIZED_GLOBAL_WEIGHT = Decimal("0.60")
INGREDIENT_SIMILARITY_WEIGHT = Decimal("0.40")

MAX_RECOMMENDATIONS = 50
SCORE_QUANTUM = Decimal("0.000001")
_ZERO = Decimal(0)
_ONE = Decimal(1)
_FOUR = Decimal(4)

type RecommendationSourceKind = Literal["save", "rating", "fork", "view"]
type IngredientMeasureKind = Literal["exact", "range", "qualitative"]
type QualitativeIngredientMeasure = Literal["to_taste", "as_needed", "unspecified"]

_SOURCE_KIND_ORDER: dict[RecommendationSourceKind, int] = {
    "save": 0,
    "rating": 1,
    "fork": 2,
    "view": 3,
}
_PERSONAL_REASONS: dict[RecommendationSourceKind, str] = {
    "save": "Similar ingredients to a recipe you saved.",
    "rating": "Similar ingredients to a recipe you rated highly.",
    "fork": "Similar ingredients to a recipe you adapted.",
    "view": "Similar ingredients to a recipe you viewed.",
}
_GLOBAL_QUALITY_REASON = "Current ratings informed this baseline pick."
_GLOBAL_SAVE_REASON = "Active saves support this baseline pick."
_GLOBAL_FORK_REASON = "Recipe adaptations support this baseline pick."
_GLOBAL_VIEW_REASON = "Recipe views support this baseline pick."
_COLD_START_REASON = "A deterministic cold-start pick from the Recipe Lab catalog."


@dataclass(frozen=True, slots=True)
class RecommendationIngredientMeasure:
    """One occurrence-preserving structured ingredient amount signal.

    The record carries curated identities and decimals only. It deliberately
    excludes author-entered display labels so recommendation adapters and
    offline exports never have to recover semantics from presentation text.
    """

    ingredient_id: UUID
    kind: IngredientMeasureKind
    value: Decimal | None = None
    minimum: Decimal | None = None
    maximum: Decimal | None = None
    unit_id: UUID | None = None
    package_size_id: UUID | None = None
    qualitative_value: QualitativeIngredientMeasure | None = None

    def __post_init__(self) -> None:
        if self.kind == "exact":
            valid = (
                self.value is not None
                and self.value.is_finite()
                and self.value > 0
                and self.minimum is None
                and self.maximum is None
                and self.unit_id is not None
                and self.qualitative_value is None
            )
        elif self.kind == "range":
            valid = (
                self.value is None
                and self.minimum is not None
                and self.minimum.is_finite()
                and self.minimum > 0
                and self.maximum is not None
                and self.maximum.is_finite()
                and self.maximum > self.minimum
                and self.unit_id is not None
                and self.qualitative_value is None
            )
        elif self.kind == "qualitative":
            valid = (
                self.value is None
                and self.minimum is None
                and self.maximum is None
                and self.unit_id is None
                and self.package_size_id is None
                and self.qualitative_value in {"to_taste", "as_needed", "unspecified"}
            )
        else:
            valid = False
        if not valid:
            raise ValueError("ingredient measure signal has an invalid structured shape")


@dataclass(frozen=True, slots=True)
class BaselineCandidate:
    recipe_version_id: UUID
    title: str
    version_number: int
    ingredient_measures: tuple[RecommendationIngredientMeasure, ...]
    rating_sum: int
    rating_count: int
    save_count: int
    fork_count: int
    view_count: int
    # Snapshot-v1 compatibility only. Production and v2 adapters derive IDs
    # exclusively from truthful structured occurrence records.
    legacy_ingredient_ids: frozenset[UUID] = frozenset()

    @property
    def ingredient_ids(self) -> frozenset[UUID]:
        """Retain baseline-v1 set behavior while carrying richer future signals."""

        structured_ids = frozenset(measure.ingredient_id for measure in self.ingredient_measures)
        return structured_ids | self.legacy_ingredient_ids


@dataclass(frozen=True, slots=True)
class BaselineProfileRating:
    recipe_version_id: UUID
    rating: int


@dataclass(frozen=True, slots=True)
class BaselineProfileEvent:
    recipe_version_id: UUID
    event_type: str
    related_recipe_version_id: UUID | None


@dataclass(frozen=True, slots=True)
class BaselineScoringInput:
    candidates: tuple[BaselineCandidate, ...]
    saved_recipe_version_ids: frozenset[UUID]
    ratings: tuple[BaselineProfileRating, ...]
    events: tuple[BaselineProfileEvent, ...]
    normalization: "BaselineNormalization | None" = None


@dataclass(frozen=True, slots=True)
class BaselineNormalization:
    """Catalog-wide maxima retained when a database shortlist is scored."""

    maximum_save_count: int = 0
    maximum_fork_count: int = 0
    maximum_view_count: int = 0


@dataclass(frozen=True, slots=True)
class BaselineScoredItem:
    recipe_version_id: UUID
    score: Decimal
    quality: Decimal
    save_popularity: Decimal
    fork_popularity: Decimal
    view_popularity: Decimal
    global_score: Decimal
    ingredient_similarity: Decimal
    rating_count: int
    save_count: int
    fork_count: int
    view_count: int
    strongest_source_kind: RecommendationSourceKind | None
    ingredient_overlap_count: int
    reason: str


@dataclass(frozen=True, slots=True)
class BaselineScoringResult:
    strategy: str
    items: tuple[BaselineScoredItem, ...]
    personalized: bool


@dataclass(frozen=True, slots=True)
class _PositiveSource:
    recipe_version_id: UUID
    kind: RecommendationSourceKind
    strength: Decimal


@dataclass(frozen=True, slots=True)
class _IngredientMatch:
    source: _PositiveSource
    score: Decimal
    overlap_count: int


def _quantize(value: Decimal) -> Decimal:
    return value.quantize(SCORE_QUANTUM, rounding=ROUND_HALF_UP)


def _quality(candidate: BaselineCandidate) -> Decimal:
    posterior = (Decimal(candidate.rating_sum) + RATING_PRIOR_MEAN * RATING_PRIOR_STRENGTH) / (
        Decimal(candidate.rating_count) + RATING_PRIOR_STRENGTH
    )
    return (posterior - _ONE) / _FOUR


def _normalized_count(count: int, maximum: int) -> Decimal:
    if maximum == 0:
        return _ZERO
    return Decimal(count) / Decimal(maximum)


def _add_positive_source(
    sources: dict[UUID, _PositiveSource],
    *,
    recipe_version_id: UUID,
    kind: RecommendationSourceKind,
    strength: Decimal,
) -> None:
    existing = sources.get(recipe_version_id)
    if (
        existing is None
        or strength > existing.strength
        or (
            strength == existing.strength
            and _SOURCE_KIND_ORDER[kind] < _SOURCE_KIND_ORDER[existing.kind]
        )
    ):
        sources[recipe_version_id] = _PositiveSource(
            recipe_version_id=recipe_version_id,
            kind=kind,
            strength=strength,
        )


def _positive_sources(data: BaselineScoringInput) -> dict[UUID, _PositiveSource]:
    sources: dict[UUID, _PositiveSource] = {}
    for recipe_version_id in data.saved_recipe_version_ids:
        _add_positive_source(
            sources,
            recipe_version_id=recipe_version_id,
            kind="save",
            strength=_ONE,
        )
    for rating in data.ratings:
        if rating.rating >= 4:
            _add_positive_source(
                sources,
                recipe_version_id=rating.recipe_version_id,
                kind="rating",
                strength=Decimal(rating.rating - 3) / Decimal(2),
            )
    for event in data.events:
        if event.event_type == "fork":
            _add_positive_source(
                sources,
                recipe_version_id=event.recipe_version_id,
                kind="fork",
                strength=_ONE,
            )
            if event.related_recipe_version_id is not None:
                _add_positive_source(
                    sources,
                    recipe_version_id=event.related_recipe_version_id,
                    kind="fork",
                    strength=_ONE,
                )
        elif event.event_type == "view":
            _add_positive_source(
                sources,
                recipe_version_id=event.recipe_version_id,
                kind="view",
                strength=Decimal("0.25"),
            )
    return sources


def _excluded_recipe_ids(data: BaselineScoringInput) -> frozenset[UUID]:
    excluded = set(data.saved_recipe_version_ids)
    excluded.update(rating.recipe_version_id for rating in data.ratings)
    for event in data.events:
        excluded.add(event.recipe_version_id)
        if event.related_recipe_version_id is not None:
            excluded.add(event.related_recipe_version_id)
    return frozenset(excluded)


def _best_ingredient_match(
    candidate_ingredients: frozenset[UUID],
    sources: tuple[_PositiveSource, ...],
    ingredients_by_recipe: dict[UUID, frozenset[UUID]],
) -> _IngredientMatch | None:
    matches: list[_IngredientMatch] = []
    for source in sources:
        source_ingredients = ingredients_by_recipe[source.recipe_version_id]
        overlap_count = len(candidate_ingredients & source_ingredients)
        if overlap_count == 0:
            continue
        union_count = len(candidate_ingredients | source_ingredients)
        if union_count == 0:
            continue
        matches.append(
            _IngredientMatch(
                source=source,
                score=source.strength * Decimal(overlap_count) / Decimal(union_count),
                overlap_count=overlap_count,
            )
        )
    if not matches:
        return None
    return min(
        matches,
        key=lambda match: (
            -match.score,
            -match.overlap_count,
            -match.source.strength,
            _SOURCE_KIND_ORDER[match.source.kind],
            match.source.recipe_version_id.int,
        ),
    )


def _global_reason(
    *,
    candidate: BaselineCandidate,
    quality: Decimal,
    save_popularity: Decimal,
    fork_popularity: Decimal,
    view_popularity: Decimal,
) -> str:
    supported: list[tuple[Decimal, int, str]] = []
    if candidate.rating_count > 0:
        supported.append((QUALITY_WEIGHT * quality, 0, _GLOBAL_QUALITY_REASON))
    if candidate.save_count > 0:
        supported.append((SAVE_POPULARITY_WEIGHT * save_popularity, 1, _GLOBAL_SAVE_REASON))
    if candidate.fork_count > 0:
        supported.append((FORK_POPULARITY_WEIGHT * fork_popularity, 2, _GLOBAL_FORK_REASON))
    if candidate.view_count > 0:
        supported.append((VIEW_POPULARITY_WEIGHT * view_popularity, 3, _GLOBAL_VIEW_REASON))
    if not supported:
        return _COLD_START_REASON
    return min(supported, key=lambda item: (-item[0], item[1]))[2]


def score_baseline_recommendations(
    data: BaselineScoringInput,
    limit: int,
) -> BaselineScoringResult:
    """Rank baseline-v1 recommendations from an immutable, database-free snapshot."""

    if not 1 <= limit <= MAX_RECOMMENDATIONS:
        raise ValueError(f"limit must be between 1 and {MAX_RECOMMENDATIONS}.")

    excluded_ids = _excluded_recipe_ids(data)
    eligible = tuple(
        candidate
        for candidate in data.candidates
        if candidate.recipe_version_id not in excluded_ids
    )
    ingredients_by_recipe = {
        candidate.recipe_version_id: candidate.ingredient_ids for candidate in data.candidates
    }
    sources_by_id = _positive_sources(data)
    usable_sources = tuple(
        source
        for source in sources_by_id.values()
        if ingredients_by_recipe.get(source.recipe_version_id)
    )
    usable_sources = tuple(
        sorted(
            usable_sources,
            key=lambda source: (
                _SOURCE_KIND_ORDER[source.kind],
                source.recipe_version_id.int,
            ),
        )
    )
    personalized = bool(usable_sources)

    maximum_save_count = (
        data.normalization.maximum_save_count
        if data.normalization is not None
        else max((candidate.save_count for candidate in eligible), default=0)
    )
    maximum_fork_count = (
        data.normalization.maximum_fork_count
        if data.normalization is not None
        else max((candidate.fork_count for candidate in eligible), default=0)
    )
    maximum_view_count = (
        data.normalization.maximum_view_count
        if data.normalization is not None
        else max((candidate.view_count for candidate in eligible), default=0)
    )

    items: list[tuple[BaselineCandidate, BaselineScoredItem]] = []
    for candidate in eligible:
        quality = _quality(candidate)
        save_popularity = _normalized_count(candidate.save_count, maximum_save_count)
        fork_popularity = _normalized_count(candidate.fork_count, maximum_fork_count)
        view_popularity = _normalized_count(candidate.view_count, maximum_view_count)
        global_score = (
            QUALITY_WEIGHT * quality
            + SAVE_POPULARITY_WEIGHT * save_popularity
            + FORK_POPULARITY_WEIGHT * fork_popularity
            + VIEW_POPULARITY_WEIGHT * view_popularity
        )
        best_match = _best_ingredient_match(
            candidate.ingredient_ids,
            usable_sources,
            ingredients_by_recipe,
        )
        ingredient_similarity = best_match.score if best_match is not None else _ZERO
        score = (
            PERSONALIZED_GLOBAL_WEIGHT * global_score
            + INGREDIENT_SIMILARITY_WEIGHT * ingredient_similarity
            if personalized
            else global_score
        )
        strongest_source_kind = best_match.source.kind if best_match is not None else None
        reason = (
            _PERSONAL_REASONS[strongest_source_kind]
            if strongest_source_kind is not None
            else _global_reason(
                candidate=candidate,
                quality=quality,
                save_popularity=save_popularity,
                fork_popularity=fork_popularity,
                view_popularity=view_popularity,
            )
        )
        items.append(
            (
                candidate,
                BaselineScoredItem(
                    recipe_version_id=candidate.recipe_version_id,
                    score=_quantize(score),
                    quality=_quantize(quality),
                    save_popularity=_quantize(save_popularity),
                    fork_popularity=_quantize(fork_popularity),
                    view_popularity=_quantize(view_popularity),
                    global_score=_quantize(global_score),
                    ingredient_similarity=_quantize(ingredient_similarity),
                    rating_count=candidate.rating_count,
                    save_count=candidate.save_count,
                    fork_count=candidate.fork_count,
                    view_count=candidate.view_count,
                    strongest_source_kind=strongest_source_kind,
                    ingredient_overlap_count=(
                        best_match.overlap_count if best_match is not None else 0
                    ),
                    reason=reason,
                ),
            )
        )

    items.sort(
        key=lambda pair: (
            -pair[1].score,
            -pair[1].ingredient_similarity,
            -pair[1].global_score,
            pair[0].title.strip().casefold(),
            pair[0].title.strip(),
            pair[0].version_number,
            pair[0].recipe_version_id.int,
        )
    )
    return BaselineScoringResult(
        strategy=BASELINE_STRATEGY,
        items=tuple(item for _, item in items[:limit]),
        personalized=personalized,
    )
