from fastapi import APIRouter

from app.api.routes import health, recipes

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(recipes.router, tags=["recipes"])
