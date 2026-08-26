from typing import Annotated

from fastapi import APIRouter, Path, Query, Response

from app.api.dependencies import RequiredAuthenticatedSessionDependency, SessionDependency
from app.api.errors import ApiError
from app.api.member_context import lock_active_member_actor
from app.repositories.auth import get_user_by_handle
from app.repositories.recipe_drafts import RecipeDraftBrowseItem
from app.repositories.recipe_libraries import browse_my_recipes, browse_my_saved_recipes
from app.repositories.recipes import browse_public_recipe_versions_by_author
from app.schemas.errors import ErrorResponse
from app.schemas.recipe_drafts import RecipeDraftSummaryResponse
from app.schemas.recipe_libraries import (
    MyPublishedRecipeItem,
    MyRecipeDraftItem,
    MyRecipeLibraryResponse,
    PublicCookProfileResponse,
    SavedRecipeLibraryItem,
    SavedRecipeLibraryResponse,
)
from app.services.recipe_responses import public_user_reference, recipe_summary_response

router = APIRouter()

PUBLIC_PROFILE_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {"model": ErrorResponse, "description": "The public cook handle was not found."},
    422: {"model": ErrorResponse, "description": "A handle or page parameter is invalid."},
}
PRIVATE_LIBRARY_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    401: {"model": ErrorResponse, "description": "A valid member session is required."},
    403: {"model": ErrorResponse, "description": "Account setup is incomplete."},
    422: {"model": ErrorResponse, "description": "A page parameter is invalid."},
}


def _private_no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Vary"] = "Cookie"


def _draft_summary(item: RecipeDraftBrowseItem) -> RecipeDraftSummaryResponse:
    return RecipeDraftSummaryResponse(
        id=item.draft.id,
        source_version_id=item.draft.source_version_id,
        status="active",
        revision=item.draft.revision,
        title=item.draft.title,
        ingredient_count=item.ingredient_count,
        instruction_count=item.instruction_count,
        created_at=item.draft.created_at,
        updated_at=item.draft.updated_at,
    )


@router.get(
    "/cooks/{handle}",
    response_model=PublicCookProfileResponse,
    responses=PUBLIC_PROFILE_ERROR_RESPONSES,
    summary="Read a public cook profile",
    description="Returns only public identity fields and explicitly published recipe versions.",
)
def public_cook_profile(
    handle: Annotated[
        str,
        Path(
            min_length=3,
            max_length=30,
            pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{1,28}[A-Za-z0-9]$",
        ),
    ],
    session: SessionDependency,
    page: Annotated[int, Query(ge=1, le=1_000_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> PublicCookProfileResponse:
    cook = get_user_by_handle(session, handle)
    if cook is None:
        raise ApiError(
            status_code=404,
            code="cook_not_found",
            message=f"Cook @{handle} was not found.",
        )
    stored = browse_public_recipe_versions_by_author(
        session,
        author_user_id=cook.id,
        offset=(page - 1) * page_size,
        limit=page_size,
    )
    return PublicCookProfileResponse(
        cook=public_user_reference(cook),
        items=[recipe_summary_response(recipe) for recipe in stored.items],
        page=page,
        page_size=page_size,
        total=stored.total,
        total_pages=(stored.total + page_size - 1) // page_size,
    )


@router.get(
    "/my/recipes",
    response_model=MyRecipeLibraryResponse,
    responses=PRIVATE_LIBRARY_ERROR_RESPONSES,
    summary="List my current drafts and published recipes",
)
def my_recipe_library(
    response: Response,
    session: SessionDependency,
    authenticated: RequiredAuthenticatedSessionDependency,
    page: Annotated[int, Query(ge=1, le=1_000_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> MyRecipeLibraryResponse:
    actor_id = lock_active_member_actor(session, authenticated)
    stored = browse_my_recipes(
        session,
        actor_user_id=actor_id,
        offset=(page - 1) * page_size,
        limit=page_size,
    )
    items: list[MyRecipeDraftItem | MyPublishedRecipeItem] = []
    for item in stored.items:
        if item.kind == "draft":
            if item.draft is None:
                raise RuntimeError("Draft library entry is missing its draft.")
            items.append(MyRecipeDraftItem(draft=_draft_summary(item.draft)))
        else:
            if item.recipe is None or item.visibility_state is None:
                raise RuntimeError("Published library entry is missing visibility metadata.")
            items.append(
                MyPublishedRecipeItem(
                    recipe=recipe_summary_response(item.recipe),
                    visibility_state=item.visibility_state,
                )
            )
    result = MyRecipeLibraryResponse(
        items=items,
        page=page,
        page_size=page_size,
        total=stored.total,
        total_pages=(stored.total + page_size - 1) // page_size,
    )
    session.commit()
    _private_no_store(response)
    return result


@router.get(
    "/my/saved-recipes",
    response_model=SavedRecipeLibraryResponse,
    responses=PRIVATE_LIBRARY_ERROR_RESPONSES,
    summary="List my saved recipes",
)
def my_saved_recipe_library(
    response: Response,
    session: SessionDependency,
    authenticated: RequiredAuthenticatedSessionDependency,
    page: Annotated[int, Query(ge=1, le=1_000_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> SavedRecipeLibraryResponse:
    actor_id = lock_active_member_actor(session, authenticated)
    stored = browse_my_saved_recipes(
        session,
        actor_user_id=actor_id,
        offset=(page - 1) * page_size,
        limit=page_size,
    )
    result = SavedRecipeLibraryResponse(
        items=[
            SavedRecipeLibraryItem(
                recipe=recipe_summary_response(item.recipe),
                saved_at=item.saved_at,
            )
            for item in stored.items
        ],
        page=page,
        page_size=page_size,
        total=stored.total,
        total_pages=(stored.total + page_size - 1) // page_size,
    )
    session.commit()
    _private_no_store(response)
    return result
