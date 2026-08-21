from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.demo_context import get_demo_user_or_error
from app.api.dependencies import get_session
from app.schemas.errors import ErrorResponse
from app.schemas.recipes import RecipeSummary
from app.schemas.recommendations import (
    RecipeRecommendationResponse,
    RecipeRecommendationsResponse,
    RecommendationScoreBreakdown,
    RecommendationWeightsResponse,
)
from app.services.recommendations import (
    BASELINE_STRATEGY,
    FORK_POPULARITY_WEIGHT,
    INGREDIENT_SIMILARITY_WEIGHT,
    MAX_RECOMMENDATIONS,
    PERSONALIZED_GLOBAL_WEIGHT,
    QUALITY_WEIGHT,
    RATING_PRIOR_MEAN,
    RATING_PRIOR_STRENGTH,
    SAVE_POPULARITY_WEIGHT,
    VIEW_POPULARITY_WEIGHT,
    recommend_recipe_versions,
)

router = APIRouter(prefix="/recommendations")
SessionDependency = Annotated[Session, Depends(get_session)]

RECOMMENDATION_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    422: {
        "model": ErrorResponse,
        "description": "The requested recommendation limit is invalid.",
    },
    503: {
        "model": ErrorResponse,
        "description": "The seeded demo identity is unavailable.",
    },
}


@router.get(
    "",
    response_model=RecipeRecommendationsResponse,
    responses=RECOMMENDATION_ERROR_RESPONSES,
    summary="Get explainable baseline recommendations",
    description=(
        "Ranks recipe versions with the deterministic baseline-v1 quality, popularity, "
        "and canonical-ingredient similarity formula for the server-selected shared demo "
        "profile. The endpoint performs no model inference or writes."
    ),
)
def get_recommendations(
    session: SessionDependency,
    limit: Annotated[
        int,
        Query(
            ge=1,
            le=MAX_RECOMMENDATIONS,
            description=f"Maximum results to return, up to {MAX_RECOMMENDATIONS}.",
        ),
    ] = 10,
) -> RecipeRecommendationsResponse:
    user = get_demo_user_or_error(session)
    result = recommend_recipe_versions(session, user.id, limit)
    return RecipeRecommendationsResponse(
        strategy=BASELINE_STRATEGY,
        personalized=result.personalized,
        weights=RecommendationWeightsResponse(
            quality=QUALITY_WEIGHT,
            saves=SAVE_POPULARITY_WEIGHT,
            forks=FORK_POPULARITY_WEIGHT,
            views=VIEW_POPULARITY_WEIGHT,
            personalized_global=PERSONALIZED_GLOBAL_WEIGHT,
            personalized_similarity=INGREDIENT_SIMILARITY_WEIGHT,
            quality_prior_mean=RATING_PRIOR_MEAN,
            quality_prior_strength=int(RATING_PRIOR_STRENGTH),
        ),
        items=[
            RecipeRecommendationResponse(
                recipe=RecipeSummary.model_validate(item.recipe),
                score=item.score,
                components=RecommendationScoreBreakdown(
                    quality=item.quality,
                    save_popularity=item.save_popularity,
                    fork_popularity=item.fork_popularity,
                    view_popularity=item.view_popularity,
                    global_score=item.global_score,
                    ingredient_similarity=item.ingredient_similarity,
                ),
                reason=item.reason,
            )
            for item in result.items
        ],
    )
