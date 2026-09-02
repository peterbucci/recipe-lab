from typing import Annotated

from fastapi import APIRouter, Query, Response

from app.api.cache import apply_private_no_store
from app.api.dependencies import OptionalAuthenticatedSessionDependency, SessionDependency
from app.schemas.errors import ErrorResponse
from app.schemas.recommendations import (
    RecipeRecommendationResponse,
    RecipeRecommendationsResponse,
    RecommendationScoreBreakdown,
    RecommendationWeightsResponse,
)
from app.services.recipe_responses import recipe_summary_response
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

RECOMMENDATION_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    422: {
        "model": ErrorResponse,
        "description": "The requested recommendation limit is invalid.",
    },
    503: {
        "model": ErrorResponse,
        "description": "The complete research ranking exceeds its configured safe capacity.",
    },
}


@router.get(
    "",
    response_model=RecipeRecommendationsResponse,
    responses=RECOMMENDATION_ERROR_RESPONSES,
    summary="Research preview: get deterministic baseline rankings",
    description=(
        "Research-preview API only; Recipe Lab has no consumer recommendation surface. "
        "Ranks recipe versions with the deterministic baseline-v1 quality, popularity, "
        "and canonical-ingredient similarity formula. Every request uses aggregate activity for "
        "publicly readable recipes. Signed-in personalization additionally uses only the active "
        "member's private history; signed-out requests load no account-specific history."
    ),
)
def get_recommendations(
    response: Response,
    session: SessionDependency,
    authenticated: OptionalAuthenticatedSessionDependency,
    limit: Annotated[
        int,
        Query(
            ge=1,
            le=MAX_RECOMMENDATIONS,
            description=f"Maximum results to return, up to {MAX_RECOMMENDATIONS}.",
        ),
    ] = 10,
) -> RecipeRecommendationsResponse:
    apply_private_no_store(response)
    result = recommend_recipe_versions(
        session,
        authenticated.user_id if authenticated is not None else None,
        limit,
    )
    recommendations_response = RecipeRecommendationsResponse(
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
                recipe=recipe_summary_response(item.recipe),
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
    session.commit()
    return recommendations_response
