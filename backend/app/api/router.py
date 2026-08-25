from fastapi import APIRouter

from app.api.routes import (
    actions,
    auth,
    health,
    ingredient_catalog,
    interactions,
    measurements,
    recipe_drafts,
    recipe_duplicates,
    recipes,
    recommendations,
)

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router, tags=["authentication"])
api_router.include_router(ingredient_catalog.router, tags=["ingredient catalog"])
api_router.include_router(measurements.router, tags=["measurements"])
api_router.include_router(actions.router, tags=["cooking actions"])
api_router.include_router(recipe_drafts.router, tags=["recipe drafts"])
api_router.include_router(recipe_duplicates.router, tags=["recipe duplicate preflight"])
api_router.include_router(recipes.router, tags=["recipes"])
api_router.include_router(interactions.router, tags=["interactions"])
api_router.include_router(recommendations.router, tags=["recommendations"])
