from fastapi import APIRouter

from app.api.dependencies import SessionDependency
from app.repositories.recipe_categories import list_active_recipe_categories
from app.schemas.recipe_categories import (
    RecipeCategoryListResponse,
    RecipeCategorySummary,
)

router = APIRouter(prefix="/recipe-categories")


@router.get(
    "",
    response_model=RecipeCategoryListResponse,
    summary="List curated recipe categories",
    description=(
        "Returns the active governed discovery vocabulary in stable display order. "
        "Categories are editorial labels and are never inferred from recipe prose."
    ),
)
def recipe_categories(session: SessionDependency) -> RecipeCategoryListResponse:
    return RecipeCategoryListResponse(
        items=[
            RecipeCategorySummary(id=item.id, name=item.name, slug=item.slug)
            for item in list_active_recipe_categories(session)
        ]
    )
