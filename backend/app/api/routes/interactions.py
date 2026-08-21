from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Header, Response, status
from sqlalchemy.orm import Session

from app.api.demo_context import (
    ensure_recipe_exists,
    get_demo_user_or_error,
    recipe_viewer_state_response,
)
from app.api.dependencies import get_session
from app.api.errors import ApiError
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
from app.services.preference_events import (
    IdempotencyKeyConflictError,
    PreferenceEventIntent,
    find_preference_event_replay,
    record_preference_event,
)

router = APIRouter(prefix="/recipes")
SessionDependency = Annotated[Session, Depends(get_session)]
ActionIdHeader = Annotated[
    UUID,
    Header(
        alias="Idempotency-Key",
        description=(
            "Opaque UUID for this user action. Reusing it with the same action safely replays "
            "the request; reusing it for different semantics returns 409."
        ),
    ),
]

INTERACTION_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {
        "model": ErrorResponse,
        "description": "The requested recipe version does not exist.",
    },
    409: {
        "model": ErrorResponse,
        "description": "The Idempotency-Key has already been used for a different action.",
    },
    422: {
        "model": ErrorResponse,
        "description": "The request contains an invalid identifier, action key, or rating.",
    },
    503: {
        "model": ErrorResponse,
        "description": "The seeded demo identity is unavailable.",
    },
}


def _is_replay_or_error(
    session: Session,
    intent: PreferenceEventIntent,
) -> bool:
    try:
        return find_preference_event_replay(session, intent) is not None
    except IdempotencyKeyConflictError as error:
        raise ApiError(
            status_code=409,
            code="idempotency_key_conflict",
            message="The Idempotency-Key has already been used for a different recipe action.",
        ) from error


@router.post(
    "/{recipe_version_id}/view",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    responses=INTERACTION_ERROR_RESPONSES,
    summary="Record a recipe detail view for the demo user",
)
def record_recipe_view_for_current_user(
    recipe_version_id: UUID,
    action_id: ActionIdHeader,
    session: SessionDependency,
) -> Response:
    with session.begin():
        user = get_demo_user_or_error(session, for_update=True)
        intent = PreferenceEventIntent(
            action_id=action_id,
            user_id=user.id,
            recipe_version_id=recipe_version_id,
            event_type="view",
        )
        if not _is_replay_or_error(session, intent):
            ensure_recipe_exists(session, recipe_version_id)
            record_preference_event(session, intent)

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/{recipe_version_id}/save",
    response_model=RecipeViewerStateResponse,
    responses=INTERACTION_ERROR_RESPONSES,
    summary="Save a recipe for the demo user",
)
def save_recipe_for_current_user(
    recipe_version_id: UUID,
    action_id: ActionIdHeader,
    session: SessionDependency,
) -> RecipeViewerStateResponse:
    with session.begin():
        user = get_demo_user_or_error(session, for_update=True)
        intent = PreferenceEventIntent(
            action_id=action_id,
            user_id=user.id,
            recipe_version_id=recipe_version_id,
            event_type="save",
            saved_value=True,
        )
        if not _is_replay_or_error(session, intent):
            ensure_recipe_exists(session, recipe_version_id)
            save_recipe(
                session,
                user_id=user.id,
                recipe_version_id=recipe_version_id,
            )
            record_preference_event(session, intent)
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
    action_id: ActionIdHeader,
    session: SessionDependency,
) -> RecipeViewerStateResponse:
    with session.begin():
        user = get_demo_user_or_error(session, for_update=True)
        intent = PreferenceEventIntent(
            action_id=action_id,
            user_id=user.id,
            recipe_version_id=recipe_version_id,
            event_type="save",
            saved_value=False,
        )
        if not _is_replay_or_error(session, intent):
            ensure_recipe_exists(session, recipe_version_id)
            unsave_recipe(
                session,
                user_id=user.id,
                recipe_version_id=recipe_version_id,
            )
            record_preference_event(session, intent)
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
    action_id: ActionIdHeader,
    session: SessionDependency,
) -> RecipeViewerStateResponse:
    with session.begin():
        user = get_demo_user_or_error(session, for_update=True)
        intent = PreferenceEventIntent(
            action_id=action_id,
            user_id=user.id,
            recipe_version_id=recipe_version_id,
            event_type="rating",
            rating_value=payload.rating,
        )
        if not _is_replay_or_error(session, intent):
            ensure_recipe_exists(session, recipe_version_id)
            rate_recipe(
                session,
                user_id=user.id,
                recipe_version_id=recipe_version_id,
                rating=payload.rating,
            )
            record_preference_event(session, intent)
        return recipe_viewer_state_response(
            session,
            user=user,
            recipe_version_id=recipe_version_id,
        )
