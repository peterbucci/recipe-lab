from dataclasses import dataclass
from decimal import Decimal
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import RecipeVersion
from app.repositories.recommendations import (
    RecommendationDataCapacityError,
    load_recommendation_data,
)
from app.services.recommendation_scoring import (
    BASELINE_STRATEGY,
    FORK_POPULARITY_WEIGHT,
    INGREDIENT_SIMILARITY_WEIGHT,
    MAX_RECOMMENDATIONS,
    PERSONALIZED_GLOBAL_WEIGHT,
    QUALITY_WEIGHT,
    RATING_PRIOR_MEAN,
    RATING_PRIOR_STRENGTH,
    SAVE_POPULARITY_WEIGHT,
    SCORE_QUANTUM,
    VIEW_POPULARITY_WEIGHT,
    BaselineCandidate,
    BaselineProfileEvent,
    BaselineProfileRating,
    BaselineScoringInput,
    RecommendationSourceKind,
    score_baseline_recommendations,
)

__all__ = [
    "BASELINE_STRATEGY",
    "FORK_POPULARITY_WEIGHT",
    "INGREDIENT_SIMILARITY_WEIGHT",
    "MAX_RECOMMENDATIONS",
    "PERSONALIZED_GLOBAL_WEIGHT",
    "QUALITY_WEIGHT",
    "RATING_PRIOR_MEAN",
    "RATING_PRIOR_STRENGTH",
    "RecommendationItem",
    "RecommendationCapacityError",
    "RecommendationResult",
    "RecommendationSourceKind",
    "SAVE_POPULARITY_WEIGHT",
    "SCORE_QUANTUM",
    "VIEW_POPULARITY_WEIGHT",
    "recommend_recipe_versions",
]


class RecommendationCapacityError(RuntimeError):
    """Raised when the preview cannot rank the complete input within its safe bounds."""


@dataclass(frozen=True, slots=True)
class RecommendationItem:
    recipe: RecipeVersion
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
class RecommendationResult:
    strategy: str
    items: tuple[RecommendationItem, ...]
    personalized: bool


def recommend_recipe_versions(
    session: Session,
    user_id: UUID | None,
    limit: int,
) -> RecommendationResult:
    """Rank globally for signed-out callers or personalize for one session-selected member."""

    if not 1 <= limit <= MAX_RECOMMENDATIONS:
        raise ValueError(f"limit must be between 1 and {MAX_RECOMMENDATIONS}.")

    try:
        data = load_recommendation_data(session, user_id)
    except RecommendationDataCapacityError as error:
        raise RecommendationCapacityError from error
    recipes_by_id = {candidate.recipe.id: candidate.recipe for candidate in data.candidates}
    scoring_result = score_baseline_recommendations(
        BaselineScoringInput(
            candidates=tuple(
                BaselineCandidate(
                    recipe_version_id=candidate.recipe.id,
                    title=candidate.recipe.title,
                    version_number=candidate.recipe.version_number,
                    ingredient_measures=candidate.ingredient_measures,
                    rating_sum=candidate.rating_sum,
                    rating_count=candidate.rating_count,
                    save_count=candidate.save_count,
                    fork_count=candidate.fork_count,
                    view_count=candidate.view_count,
                )
                for candidate in data.candidates
            ),
            saved_recipe_version_ids=data.saved_recipe_version_ids,
            ratings=tuple(
                BaselineProfileRating(
                    recipe_version_id=rating.recipe_version_id,
                    rating=rating.rating,
                )
                for rating in data.ratings
            ),
            events=tuple(
                BaselineProfileEvent(
                    recipe_version_id=event.recipe_version_id,
                    event_type=event.event_type,
                    related_recipe_version_id=event.related_recipe_version_id,
                )
                for event in data.events
            ),
        ),
        limit,
    )
    return RecommendationResult(
        strategy=scoring_result.strategy,
        items=tuple(
            RecommendationItem(
                recipe=recipes_by_id[item.recipe_version_id],
                score=item.score,
                quality=item.quality,
                save_popularity=item.save_popularity,
                fork_popularity=item.fork_popularity,
                view_popularity=item.view_popularity,
                global_score=item.global_score,
                ingredient_similarity=item.ingredient_similarity,
                rating_count=item.rating_count,
                save_count=item.save_count,
                fork_count=item.fork_count,
                view_count=item.view_count,
                strongest_source_kind=item.strongest_source_kind,
                ingredient_overlap_count=item.ingredient_overlap_count,
                reason=item.reason,
            )
            for item in scoring_result.items
        ),
        personalized=scoring_result.personalized,
    )
