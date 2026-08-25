from typing import Annotated

from fastapi import APIRouter, Query

from app.api.dependencies import SessionDependency
from app.repositories.actions import list_active_cooking_action_types
from app.schemas.actions import CookingActionTypeCatalogPage
from app.services.actions import cooking_action_type_catalog_item

router = APIRouter()


@router.get(
    "/cooking-action-types",
    response_model=CookingActionTypeCatalogPage,
    summary="List active curated cooking action types",
    description=(
        "Returns reviewed active verbs for new structured actions. Historical inactive "
        "types remain visible only through the immutable recipes that already use them."
    ),
)
def cooking_action_type_catalog(
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
) -> CookingActionTypeCatalogPage:
    action_types = list_active_cooking_action_types(session, limit=limit)
    return CookingActionTypeCatalogPage(
        items=[cooking_action_type_catalog_item(item) for item in action_types]
    )
