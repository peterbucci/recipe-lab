from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Query, Response, status
from pydantic import StringConstraints
from sqlalchemy.orm import Session

from app.api.demo_context import get_demo_user_or_error, recipe_viewer_state_response
from app.api.dependencies import get_session
from app.api.errors import ApiError
from app.models import RecipeIngredient, RecipeInstruction, RecipeVersion, User
from app.repositories.recipes import (
    browse_recipe_versions,
    get_recipe_rating_aggregate,
    get_recipe_version,
)
from app.schemas.errors import ErrorResponse
from app.schemas.recipe_forks import RecipeForkRequest
from app.schemas.recipes import (
    RecipeDetailResponse,
    RecipeIngredientResponse,
    RecipeInstructionResponse,
    RecipePageResponse,
    RecipeSummary,
    RecipeVersionReference,
)
from app.services.recipe_forks import InvalidRecipeEditsError, fork_recipe_version

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
SessionDependency = Annotated[Session, Depends(get_session)]

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
        "description": "The requested recipe version does not exist.",
    },
    503: {
        "model": ErrorResponse,
        "description": "The seeded demo identity is unavailable.",
    },
}
FORK_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {
        "model": ErrorResponse,
        "description": "The source recipe version does not exist.",
    },
    422: {
        "model": ErrorResponse,
        "description": "The request shape, identifier, or recipe edits are invalid.",
    },
    503: {
        "model": ErrorResponse,
        "description": "The seeded demo identity is unavailable.",
    },
}


def _summary(version: RecipeVersion) -> RecipeSummary:
    return RecipeSummary.model_validate(version)


def _reference(version: RecipeVersion) -> RecipeVersionReference:
    return RecipeVersionReference.model_validate(version)


def _ingredient(item: RecipeIngredient) -> RecipeIngredientResponse:
    return RecipeIngredientResponse(
        id=item.id,
        ingredient_id=item.ingredient_id,
        canonical_name=item.ingredient.canonical_name,
        display_name=item.name,
        quantity=item.quantity,
        unit=item.unit,
        preparation_notes=item.preparation_notes,
        display_order=item.display_order,
    )


def _instruction(item: RecipeInstruction) -> RecipeInstructionResponse:
    return RecipeInstructionResponse(
        id=item.id,
        text=item.instruction,
        display_order=item.display_order,
    )


def _detail_response(
    session: Session,
    *,
    version: RecipeVersion,
    user: User,
) -> RecipeDetailResponse:
    rating = get_recipe_rating_aggregate(session, version.id)
    return RecipeDetailResponse(
        **_summary(version).model_dump(),
        average_rating=float(rating.average) if rating.average is not None else None,
        rating_count=rating.count,
        viewer_state=recipe_viewer_state_response(
            session,
            user=user,
            recipe_version_id=version.id,
        ),
        parent=_reference(version.parent) if version.parent is not None else None,
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
) -> RecipePageResponse:
    result = browse_recipe_versions(
        session,
        search=q,
        lineage_id=lineage_id,
        ingredient_name=ingredient,
        is_variant=is_variant,
        offset=(page - 1) * page_size,
        limit=page_size,
    )
    return RecipePageResponse(
        items=[_summary(item) for item in result.items],
        page=page,
        page_size=page_size,
        total=result.total,
        total_pages=(result.total + page_size - 1) // page_size,
    )


@router.get(
    "/{recipe_version_id}",
    response_model=RecipeDetailResponse,
    responses=DETAIL_ERROR_RESPONSES,
    summary="Read a structured recipe version",
)
def recipe_detail(
    recipe_version_id: UUID,
    session: SessionDependency,
) -> RecipeDetailResponse:
    version = get_recipe_version(session, recipe_version_id)
    if version is None:
        raise ApiError(
            status_code=404,
            code="recipe_not_found",
            message=f"Recipe version {recipe_version_id} was not found.",
        )

    user = get_demo_user_or_error(session)
    return _detail_response(session, version=version, user=user)


@router.post(
    "/{recipe_version_id}/variants",
    response_model=RecipeDetailResponse,
    status_code=status.HTTP_201_CREATED,
    responses=FORK_ERROR_RESPONSES,
    summary="Create a child recipe variant",
    description=(
        "Copies the source version's structured ingredients and instructions, applies the "
        "requested edits, and stores a new immutable child in the same lineage."
    ),
)
def create_recipe_variant(
    recipe_version_id: UUID,
    payload: Annotated[RecipeForkRequest, Body()],
    response: Response,
    session: SessionDependency,
) -> RecipeDetailResponse:
    with session.begin():
        user = get_demo_user_or_error(session)
        try:
            child_id = fork_recipe_version(
                session,
                source_version_id=recipe_version_id,
                author_user_id=user.id,
                payload=payload,
            )
        except InvalidRecipeEditsError as error:
            raise ApiError(
                status_code=422,
                code="invalid_recipe_edits",
                message=str(error),
            ) from error

        if child_id is None:
            raise ApiError(
                status_code=404,
                code="recipe_not_found",
                message=f"Recipe version {recipe_version_id} was not found.",
            )

        session.expire_all()
        child = get_recipe_version(session, child_id)
        if child is None:
            raise RuntimeError("The newly created recipe version could not be reloaded.")

        response.headers["Location"] = f"/api/recipes/{child_id}"
        return _detail_response(session, version=child, user=user)
