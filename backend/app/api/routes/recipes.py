from typing import Annotated, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Query, Response
from pydantic import StringConstraints
from sqlalchemy.orm import Session

from app.api.cache import apply_private_no_store
from app.api.dependencies import (
    OptionalAuthenticatedSessionDependency,
    RequiredAuthenticatedSessionDependency,
    SessionDependency,
)
from app.api.errors import ApiError
from app.api.member_context import lock_active_member_actor, recipe_viewer_state_response
from app.homepage_content import FEATURED_RECIPE_VERSION_IDS
from app.models import RecipeIngredient, RecipeInstruction, RecipeVersion
from app.repositories.interactions import get_recipe_viewer_states
from app.repositories.recipe_diffs import (
    get_direct_substitution_pairs,
    get_recipe_version_diff_identity,
    get_recipe_versions_for_diff,
)
from app.repositories.recipes import (
    RecipeCardEngagementAggregate,
    browse_recipe_versions,
    get_recipe_card_engagement_aggregates,
    get_recipe_version,
    list_public_recipe_versions_in_order,
)
from app.schemas.errors import ErrorResponse
from app.schemas.interactions import (
    RecipeViewerStateListResponse,
    RecipeViewerStateResponse,
)
from app.schemas.recipe_diffs import RecipeDiffResponse
from app.schemas.recipes import (
    FeaturedRecipeListResponse,
    FeaturedRecipeSummary,
    RecipeCardSummary,
    RecipeDetailResponse,
    RecipeIngredientResponse,
    RecipeInstructionResponse,
    RecipePageResponse,
    RecipeSummary,
    RecipeVersionReference,
)
from app.services.actions import serialize_instruction_action
from app.services.measurements import serialize_measure
from app.services.recipe_diffs import build_recipe_diff
from app.services.recipe_responses import recipe_summary_response, recipe_version_reference

router = APIRouter(prefix="/recipes")

SearchTerm = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=100,
        pattern=r"^[^\x00]*$",
    ),
]
IngredientName = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=200,
        pattern=r"^[^\x00]*$",
    ),
]
RecipeCategorySlug = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=64,
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
    ),
]
VALIDATION_ERROR_RESPONSE: dict[int | str, dict[str, object]] = {
    422: {
        "model": ErrorResponse,
        "description": "The request contains an invalid identifier or query parameter.",
    }
}
DETAIL_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    **VALIDATION_ERROR_RESPONSE,
    404: {
        "model": ErrorResponse,
        "description": "The requested recipe does not exist or is not publicly available.",
    },
}
DIFF_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {
        "model": ErrorResponse,
        "description": (
            "The target or selected base recipe does not exist or is not publicly available."
        ),
    },
    422: {
        "model": ErrorResponse,
        "description": (
            "An identifier is invalid, an implicit parent is unavailable, or the versions "
            "belong to different lineages."
        ),
    },
}


def _summary(version: RecipeVersion) -> RecipeSummary:
    return recipe_summary_response(version)


def _reference(version: RecipeVersion) -> RecipeVersionReference:
    return recipe_version_reference(version)


def _featured_summary(
    version: RecipeVersion,
    engagement: RecipeCardEngagementAggregate,
) -> FeaturedRecipeSummary:
    average_rating = engagement.average_rating
    return FeaturedRecipeSummary(
        **_summary(version).model_dump(),
        average_rating=float(average_rating) if average_rating is not None else None,
        rating_count=engagement.rating_count,
        save_count=engagement.save_count,
    )


def _card_summary(
    version: RecipeVersion,
    engagement: RecipeCardEngagementAggregate,
) -> RecipeCardSummary:
    average_rating = engagement.average_rating
    return RecipeCardSummary(
        **_summary(version).model_dump(),
        average_rating=float(average_rating) if average_rating is not None else None,
        rating_count=engagement.rating_count,
        save_count=engagement.save_count,
    )


def _ingredient(item: RecipeIngredient) -> RecipeIngredientResponse:
    return RecipeIngredientResponse(
        id=item.id,
        ingredient_id=item.ingredient_id,
        canonical_name=item.ingredient.canonical_name,
        display_name=item.name,
        measure=serialize_measure(
            kind=item.measure_mode,
            quantity_min=item.quantity_min,
            quantity_max=item.quantity_max,
            unit=item.measurement_unit,
            package_size_id=item.package_size_id,
        ),
        preparation_notes=item.preparation_notes,
        display_order=item.display_order,
    )


def _instruction(item: RecipeInstruction) -> RecipeInstructionResponse:
    return RecipeInstructionResponse(
        id=item.id,
        title=item.title,
        text=item.instruction,
        display_order=item.display_order,
        actions=[serialize_instruction_action(action) for action in item.actions],
    )


def _detail_response(
    session: Session,
    *,
    version: RecipeVersion,
    viewer_user_id: UUID | None,
) -> RecipeDetailResponse:
    engagement = get_recipe_card_engagement_aggregates(session, [version.id])[version.id]
    return RecipeDetailResponse(
        **_summary(version).model_dump(),
        total_time_minutes=version.total_time_minutes,
        active_time_minutes=version.active_time_minutes,
        difficulty=cast(Literal["easy", "medium", "hard"] | None, version.difficulty),
        notes=version.notes,
        average_rating=(
            float(engagement.average_rating) if engagement.average_rating is not None else None
        ),
        rating_count=engagement.rating_count,
        save_count=engagement.save_count,
        viewer_state=(
            recipe_viewer_state_response(
                session,
                user_id=viewer_user_id,
                recipe_version_id=version.id,
            )
            if viewer_user_id is not None
            else None
        ),
        children=[_reference(child) for child in version.descendants],
        ingredients=[_ingredient(item) for item in version.ingredients],
        instructions=[_instruction(item) for item in version.instructions],
    )


@router.get(
    "",
    response_model=RecipePageResponse,
    responses=VALIDATION_ERROR_RESPONSE,
    summary="Browse recipe versions",
)
def browse_recipes(
    session: SessionDependency,
    page: Annotated[
        int,
        Query(ge=1, le=1_000_000, description="One-based result page, up to 1,000,000."),
    ] = 1,
    page_size: Annotated[
        int,
        Query(ge=1, le=100, description="Results per page, up to 100."),
    ] = 20,
    q: Annotated[
        SearchTerm | None,
        Query(description="Trimmed, literal case-insensitive title and description substring."),
    ] = None,
    lineage_id: Annotated[
        UUID | None,
        Query(description="Return only versions in this lineage."),
    ] = None,
    ingredient: Annotated[
        IngredientName | None,
        Query(description="Filter by an exact canonical ingredient name or alias."),
    ] = None,
    is_variant: Annotated[
        bool | None,
        Query(description="Use true for variants or false for original root versions."),
    ] = None,
    category: Annotated[
        RecipeCategorySlug | None,
        Query(description="Return only recipes with this exact curated category slug."),
    ] = None,
    sort: Annotated[
        Literal["title", "newest"],
        Query(
            description=(
                "Use title for the stable catalog order or newest for reverse publication "
                "time with a stable recipe-ID tie-break."
            )
        ),
    ] = "title",
) -> RecipePageResponse:
    result = browse_recipe_versions(
        session,
        search=q,
        lineage_id=lineage_id,
        ingredient_name=ingredient,
        is_variant=is_variant,
        category_slug=category,
        sort=sort,
        offset=(page - 1) * page_size,
        limit=page_size,
    )
    engagement = get_recipe_card_engagement_aggregates(
        session,
        [item.id for item in result.items],
    )
    return RecipePageResponse(
        items=[_card_summary(item, engagement[item.id]) for item in result.items],
        page=page,
        page_size=page_size,
        total=result.total,
        total_pages=(result.total + page_size - 1) // page_size,
    )


@router.get(
    "/featured",
    response_model=FeaturedRecipeListResponse,
    summary="List globally featured recipes",
    description=(
        "Returns one deploy-reviewed editorial selection in display order. The result is "
        "the same for every viewer, is not a recommendation, and silently omits any selected "
        "version that is no longer publicly readable."
    ),
)
def featured_recipes(session: SessionDependency) -> FeaturedRecipeListResponse:
    recipes = list_public_recipe_versions_in_order(
        session,
        FEATURED_RECIPE_VERSION_IDS,
    )
    engagement = get_recipe_card_engagement_aggregates(
        session,
        [recipe.id for recipe in recipes],
    )
    return FeaturedRecipeListResponse(
        items=[_featured_summary(item, engagement[item.id]) for item in recipes]
    )


@router.get(
    "/viewer-states",
    response_model=RecipeViewerStateListResponse,
    responses={
        401: {
            "model": ErrorResponse,
            "description": "A valid member session is required.",
        },
        403: {
            "model": ErrorResponse,
            "description": "Account setup is incomplete.",
        },
        **VALIDATION_ERROR_RESPONSE,
    },
    summary="Load my saved and rating state for visible recipe cards",
)
def recipe_viewer_states_for_current_user(
    response: Response,
    session: SessionDependency,
    authenticated: RequiredAuthenticatedSessionDependency,
    recipe_version_ids: Annotated[
        list[UUID],
        Query(alias="recipe_version_id", min_length=1, max_length=100),
    ],
) -> RecipeViewerStateListResponse:
    actor_id = lock_active_member_actor(session, authenticated)
    states = get_recipe_viewer_states(
        session,
        user_id=actor_id,
        recipe_version_ids=recipe_version_ids,
    )
    result = RecipeViewerStateListResponse(
        items=[
            RecipeViewerStateResponse(
                recipe_version_id=recipe_version_id,
                saved=state.saved,
                rating=state.rating,
            )
            for recipe_version_id, state in states.items()
        ]
    )
    session.commit()
    apply_private_no_store(response)
    return result


@router.get(
    "/{recipe_version_id}",
    response_model=RecipeDetailResponse,
    responses=DETAIL_ERROR_RESPONSES,
    summary="Read a structured recipe version",
)
def recipe_detail(
    recipe_version_id: UUID,
    response: Response,
    session: SessionDependency,
    authenticated: OptionalAuthenticatedSessionDependency,
) -> RecipeDetailResponse:
    apply_private_no_store(response)
    version = get_recipe_version(session, recipe_version_id)
    if version is None:
        raise ApiError(
            status_code=404,
            code="recipe_not_found",
            message="The recipe was not found or is not publicly available.",
        )

    detail = _detail_response(
        session,
        version=version,
        viewer_user_id=authenticated.user_id if authenticated is not None else None,
    )
    session.commit()
    return detail


@router.get(
    "/{recipe_version_id}/diff",
    response_model=RecipeDiffResponse,
    responses=DIFF_ERROR_RESPONSES,
    summary="Compare structured recipe versions",
    description=(
        "Compares a base snapshot with the target recipe version. When base_version_id is "
        "omitted, the target's direct parent is used. Explicit comparisons may select any "
        "version in the same lineage."
    ),
)
def recipe_diff(
    recipe_version_id: UUID,
    session: SessionDependency,
    base_version_id: Annotated[
        UUID | None,
        Query(
            description=(
                "Version to compare from. Omit this value to use the target's direct parent."
            )
        ),
    ] = None,
) -> RecipeDiffResponse:
    target_identity = get_recipe_version_diff_identity(session, recipe_version_id)
    if target_identity is None:
        raise ApiError(
            status_code=404,
            code="recipe_not_found",
            message="The recipe was not found or is not publicly available.",
        )

    resolved_base_id = base_version_id or target_identity.parent_version_id
    if resolved_base_id is None:
        raise ApiError(
            status_code=422,
            code="recipe_has_no_parent",
            message=f"Recipe version {recipe_version_id} has no parent to compare.",
        )

    versions = get_recipe_versions_for_diff(
        session,
        {resolved_base_id, recipe_version_id},
    )
    target = versions.get(recipe_version_id)
    if target is None:
        raise ApiError(
            status_code=404,
            code="recipe_not_found",
            message="The recipe was not found or is not publicly available.",
        )

    base = versions.get(resolved_base_id)
    if base is None:
        raise ApiError(
            status_code=404,
            code="recipe_not_found",
            message="The recipe was not found or is not publicly available.",
        )

    if base.lineage_id != target.lineage_id:
        raise ApiError(
            status_code=422,
            code="recipe_lineage_mismatch",
            message=(
                f"Recipe versions {resolved_base_id} and {recipe_version_id} do not belong "
                "to the same lineage."
            ),
        )

    ingredient_ids = {
        item.ingredient_id for version in (base, target) for item in version.ingredients
    }
    substitution_pairs = get_direct_substitution_pairs(session, ingredient_ids)
    return build_recipe_diff(
        base=base,
        target=target,
        substitution_pairs=substitution_pairs,
    )
