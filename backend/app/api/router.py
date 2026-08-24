from fastapi import APIRouter

from app.api.routes import auth, health, interactions, recipes, recommendations

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router, tags=["authentication"])
api_router.include_router(recipes.router, tags=["recipes"])
api_router.include_router(interactions.router, tags=["interactions"])
api_router.include_router(recommendations.router, tags=["recommendations"])
