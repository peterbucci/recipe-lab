from typing import Annotated

from fastapi import APIRouter, Path, Query, Response

from app.api.cache import apply_private_no_store
from app.api.dependencies import RequiredAuthenticatedSessionDependency, SessionDependency
from app.api.errors import ApiError
from app.api.member_context import lock_active_member_actor
from app.models import RecipeVersion
from app.repositories.auth import get_user_by_handle
from app.repositories.member_follows import count_followers
from app.repositories.recipe_drafts import RecipeDraftBrowseItem
from app.repositories.recipe_libraries import (
    MyRecipeLibraryView,
    browse_my_recipes,
    browse_my_saved_recipes,
)
from app.repositories.recipes import (
    RecipeCardEngagementAggregate,
    browse_public_recipe_versions_by_author,
    get_recipe_card_engagement_aggregates,
)
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
from app.schemas.recipes import RecipeCardSummary
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
MY_RECIPE_LIBRARY_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    **PRIVATE_LIBRARY_ERROR_RESPONSES,
    422: {"model": ErrorResponse, "description": "A view or page parameter is invalid."},
}


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


def _card_summary(
    recipe: RecipeVersion,
    engagement: RecipeCardEngagementAggregate,
) -> RecipeCardSummary:
    summary = recipe_summary_response(recipe)
    average_rating = engagement.average_rating
    return RecipeCardSummary(
        **summary.model_dump(),
        average_rating=float(average_rating) if average_rating is not None else None,
        rating_count=engagement.rating_count,
        save_count=engagement.save_count,
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
    engagement = get_recipe_card_engagement_aggregates(
        session,
        [recipe.id for recipe in stored.items],
    )
    return PublicCookProfileResponse(
        cook=public_user_reference(cook),
        follower_count=count_followers(session, user_id=cook.id),
        description=cook.profile_description,
        items=[_card_summary(recipe, engagement[recipe.id]) for recipe in stored.items],
        page=page,
        page_size=page_size,
        total=stored.total,
        total_pages=(stored.total + page_size - 1) // page_size,
    )


@router.get(
    "/my/recipes",
    response_model=MyRecipeLibraryResponse,
    responses=MY_RECIPE_LIBRARY_ERROR_RESPONSES,
    summary="List one view of my recipes",
    description=(
        "Returns independently paginated active drafts, current publications, or "
        "author-withdrawn publications. Moderation-hidden authored recipes remain in the "
        "published view with their accurate visibility state."
    ),
)
def my_recipe_library(
    response: Response,
    session: SessionDependency,
    authenticated: RequiredAuthenticatedSessionDependency,
    view: Annotated[MyRecipeLibraryView, Query()],
    page: Annotated[int, Query(ge=1, le=1_000_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> MyRecipeLibraryResponse:
    actor_id = lock_active_member_actor(session, authenticated)
    stored = browse_my_recipes(
        session,
        actor_user_id=actor_id,
        view=view,
        offset=(page - 1) * page_size,
        limit=page_size,
    )
    items: list[MyRecipeDraftItem | MyPublishedRecipeItem] = []
    for item in stored.items:
        if item.kind == "draft":
            if item.draft is None:
                raise RuntimeError("Draft library entry is missing its draft.")
            items.append(
                MyRecipeDraftItem(
                    draft=_draft_summary(item.draft),
                    source_recipe_title=item.draft.source_recipe_title,
                    description=item.draft.draft.description,
                )
            )
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
    apply_private_no_store(response)
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
    apply_private_no_store(response)
    return result
