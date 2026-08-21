from fastapi import APIRouter

from app.api.routes import health, identity, interactions, recipes

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(identity.router, tags=["identity"])
api_router.include_router(recipes.router, tags=["recipes"])
api_router.include_router(interactions.router, tags=["interactions"])
