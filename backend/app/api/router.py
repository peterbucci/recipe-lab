from fastapi import APIRouter, Depends

from app.api.abuse import enforce_abuse_rate_limits
from app.api.routes import (
    actions,
    auth,
    ingredient_catalog,
    interactions,
    measurements,
    moderation,
    recipe_drafts,
    recipe_libraries,
    recipe_publications,
    recipes,
    recommendations,
)
from app.schemas.errors import ErrorResponse

api_router = APIRouter(
    dependencies=[Depends(enforce_abuse_rate_limits)],
    responses={
        413: {
            "model": ErrorResponse,
            "description": "The raw request body exceeds the configured maximum size.",
        },
        429: {
            "model": ErrorResponse,
            "description": "A durable account, identity, or network rate limit was exceeded.",
        },
    },
)
api_router.include_router(auth.router, tags=["authentication"])
api_router.include_router(ingredient_catalog.router, tags=["ingredient catalog"])
api_router.include_router(measurements.router, tags=["measurements"])
api_router.include_router(actions.router, tags=["cooking actions"])
api_router.include_router(recipe_drafts.router, tags=["recipe drafts"])
api_router.include_router(recipe_libraries.router, tags=["cook profiles and recipe libraries"])
api_router.include_router(recipe_publications.router, tags=["recipe publication"])
api_router.include_router(moderation.router, tags=["recipe moderation"])
api_router.include_router(recipes.router, tags=["recipes"])
api_router.include_router(interactions.router, tags=["interactions"])
api_router.include_router(recommendations.router, tags=["recommendations"])
