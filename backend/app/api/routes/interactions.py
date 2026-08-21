from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Depends
from sqlalchemy.orm import Session

from app.api.demo_context import (
    ensure_recipe_exists,
    get_demo_user_or_error,
    recipe_viewer_state_response,
)
from app.api.dependencies import get_session
from app.repositories.interactions import (
    rate_recipe,
    save_recipe,
    unsave_recipe,
)
from app.schemas.errors import ErrorResponse
from app.schemas.interactions import (
    RatingUpdateRequest,
    RecipeViewerStateResponse,
)

router = APIRouter(prefix="/recipes")
SessionDependency = Annotated[Session, Depends(get_session)]

INTERACTION_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {
        "model": ErrorResponse,
        "description": "The requested recipe version does not exist.",
    },
    422: {
        "model": ErrorResponse,
        "description": "The request contains an invalid identifier or rating.",
    },
    503: {
        "model": ErrorResponse,
        "description": "The seeded demo identity is unavailable.",
    },
}


@router.put(
    "/{recipe_version_id}/save",
    response_model=RecipeViewerStateResponse,
    responses=INTERACTION_ERROR_RESPONSES,
    summary="Save a recipe for the demo user",
)
def save_recipe_for_current_user(
    recipe_version_id: UUID,
    session: SessionDependency,
) -> RecipeViewerStateResponse:
    with session.begin():
        user = get_demo_user_or_error(session)
        ensure_recipe_exists(session, recipe_version_id)
        save_recipe(
            session,
            user_id=user.id,
            recipe_version_id=recipe_version_id,
        )
        return recipe_viewer_state_response(
            session,
            user=user,
            recipe_version_id=recipe_version_id,
        )


@router.delete(
    "/{recipe_version_id}/save",
    response_model=RecipeViewerStateResponse,
    responses=INTERACTION_ERROR_RESPONSES,
    summary="Unsave a recipe for the demo user",
)
def unsave_recipe_for_current_user(
    recipe_version_id: UUID,
    session: SessionDependency,
) -> RecipeViewerStateResponse:
    with session.begin():
        user = get_demo_user_or_error(session)
        ensure_recipe_exists(session, recipe_version_id)
        unsave_recipe(
            session,
            user_id=user.id,
            recipe_version_id=recipe_version_id,
        )
        return recipe_viewer_state_response(
            session,
            user=user,
            recipe_version_id=recipe_version_id,
        )


@router.put(
    "/{recipe_version_id}/rating",
    response_model=RecipeViewerStateResponse,
    responses=INTERACTION_ERROR_RESPONSES,
    summary="Set a recipe rating for the demo user",
)
def rate_recipe_for_current_user(
    recipe_version_id: UUID,
    payload: Annotated[RatingUpdateRequest, Body()],
    session: SessionDependency,
) -> RecipeViewerStateResponse:
    with session.begin():
        user = get_demo_user_or_error(session)
        ensure_recipe_exists(session, recipe_version_id)
        rate_recipe(
            session,
            user_id=user.id,
            recipe_version_id=recipe_version_id,
            rating=payload.rating,
        )
        return recipe_viewer_state_response(
            session,
            user=user,
            recipe_version_id=recipe_version_id,
        )
