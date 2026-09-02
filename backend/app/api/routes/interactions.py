from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Header, Response, status
from sqlalchemy.orm import Session

from app.api.cache import private_no_store_headers
from app.api.dependencies import CsrfProtectedSessionDependency, SessionDependency
from app.api.member_context import (
    ensure_recipe_exists,
    lock_active_member_actor,
    recipe_viewer_state_response,
)
from app.repositories.interactions import (
    rate_recipe,
    save_recipe,
    unrate_recipe,
    unsave_recipe,
)
from app.schemas.errors import ErrorResponse
from app.schemas.interactions import (
    EmptyInteractionRequest,
    RatingUpdateRequest,
    RecipeViewerStateResponse,
)
from app.services.preference_events import (
    PreferenceEventIntent,
    find_preference_event_replay,
    record_preference_event,
)

router = APIRouter(prefix="/recipes")
ActionIdHeader = Annotated[
    UUID,
    Header(
        alias="Idempotency-Key",
        description=(
            "Opaque UUID scoped to this member and operation. Reusing it with the same action "
            "safely replays the request; conflicting reuse within that scope returns 409."
        ),
    ),
]

INTERACTION_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    401: {
        "model": ErrorResponse,
        "description": "A valid member session is required.",
    },
    403: {
        "model": ErrorResponse,
        "description": "CSRF or Origin evidence is invalid, or account setup is incomplete.",
    },
    404: {
        "model": ErrorResponse,
        "description": "The requested recipe version does not exist.",
    },
    409: {
        "model": ErrorResponse,
        "description": "The Idempotency-Key conflicts within this member and operation.",
    },
    422: {
        "model": ErrorResponse,
        "description": "The request contains an invalid identifier, action key, or rating.",
    },
}


def _is_replay_or_error(
    session: Session,
    intent: PreferenceEventIntent,
) -> bool:
    return find_preference_event_replay(session, intent) is not None


@router.post(
    "/{recipe_version_id}/view",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    responses=INTERACTION_ERROR_RESPONSES,
    summary="Record a recipe detail view for the signed-in member",
)
def record_recipe_view_for_current_user(
    recipe_version_id: UUID,
    action_id: ActionIdHeader,
    session: SessionDependency,
    authenticated: CsrfProtectedSessionDependency,
    _payload: Annotated[EmptyInteractionRequest | None, Body()] = None,
) -> Response:
    actor_id = lock_active_member_actor(session, authenticated)
    intent = PreferenceEventIntent(
        action_id=action_id,
        user_id=actor_id,
        recipe_version_id=recipe_version_id,
        event_type="view",
    )
    replay = _is_replay_or_error(session, intent)
    ensure_recipe_exists(session, recipe_version_id)
    if not replay:
        record_preference_event(session, intent)
    session.commit()
    return Response(
        status_code=status.HTTP_204_NO_CONTENT,
        headers=private_no_store_headers(),
    )


@router.put(
    "/{recipe_version_id}/save",
    response_model=RecipeViewerStateResponse,
    responses=INTERACTION_ERROR_RESPONSES,
    summary="Save a recipe for the signed-in member",
)
def save_recipe_for_current_user(
    recipe_version_id: UUID,
    action_id: ActionIdHeader,
    response: Response,
    session: SessionDependency,
    authenticated: CsrfProtectedSessionDependency,
    _payload: Annotated[EmptyInteractionRequest | None, Body()] = None,
) -> RecipeViewerStateResponse:
    response.headers.update(private_no_store_headers())
    actor_id = lock_active_member_actor(session, authenticated)
    intent = PreferenceEventIntent(
        action_id=action_id,
        user_id=actor_id,
        recipe_version_id=recipe_version_id,
        event_type="save",
        saved_value=True,
    )
    replay = _is_replay_or_error(session, intent)
    ensure_recipe_exists(session, recipe_version_id)
    if not replay:
        save_recipe(
            session,
            user_id=actor_id,
            recipe_version_id=recipe_version_id,
        )
        record_preference_event(session, intent)
    viewer_state = recipe_viewer_state_response(
        session,
        user_id=actor_id,
        recipe_version_id=recipe_version_id,
    )
    session.commit()
    return viewer_state


@router.delete(
    "/{recipe_version_id}/save",
    response_model=RecipeViewerStateResponse,
    responses=INTERACTION_ERROR_RESPONSES,
    summary="Unsave a recipe for the signed-in member",
)
def unsave_recipe_for_current_user(
    recipe_version_id: UUID,
    action_id: ActionIdHeader,
    response: Response,
    session: SessionDependency,
    authenticated: CsrfProtectedSessionDependency,
    _payload: Annotated[EmptyInteractionRequest | None, Body()] = None,
) -> RecipeViewerStateResponse:
    response.headers.update(private_no_store_headers())
    actor_id = lock_active_member_actor(session, authenticated)
    intent = PreferenceEventIntent(
        action_id=action_id,
        user_id=actor_id,
        recipe_version_id=recipe_version_id,
        event_type="save",
        saved_value=False,
    )
    replay = _is_replay_or_error(session, intent)
    ensure_recipe_exists(session, recipe_version_id)
    if not replay:
        unsave_recipe(
            session,
            user_id=actor_id,
            recipe_version_id=recipe_version_id,
        )
        record_preference_event(session, intent)
    viewer_state = recipe_viewer_state_response(
        session,
        user_id=actor_id,
        recipe_version_id=recipe_version_id,
    )
    session.commit()
    return viewer_state


@router.put(
    "/{recipe_version_id}/rating",
    response_model=RecipeViewerStateResponse,
    responses=INTERACTION_ERROR_RESPONSES,
    summary="Set a recipe rating for the signed-in member",
)
def rate_recipe_for_current_user(
    recipe_version_id: UUID,
    payload: Annotated[RatingUpdateRequest, Body()],
    action_id: ActionIdHeader,
    response: Response,
    session: SessionDependency,
    authenticated: CsrfProtectedSessionDependency,
) -> RecipeViewerStateResponse:
    response.headers.update(private_no_store_headers())
    actor_id = lock_active_member_actor(session, authenticated)
    intent = PreferenceEventIntent(
        action_id=action_id,
        user_id=actor_id,
        recipe_version_id=recipe_version_id,
        event_type="rating",
        rating_value=payload.rating,
    )
    replay = _is_replay_or_error(session, intent)
    ensure_recipe_exists(session, recipe_version_id)
    if not replay:
        rate_recipe(
            session,
            user_id=actor_id,
            recipe_version_id=recipe_version_id,
            rating=payload.rating,
        )
        record_preference_event(session, intent)
    viewer_state = recipe_viewer_state_response(
        session,
        user_id=actor_id,
        recipe_version_id=recipe_version_id,
    )
    session.commit()
    return viewer_state


@router.delete(
    "/{recipe_version_id}/rating",
    response_model=RecipeViewerStateResponse,
    responses=INTERACTION_ERROR_RESPONSES,
    summary="Remove the signed-in member's recipe rating",
)
def unrate_recipe_for_current_user(
    recipe_version_id: UUID,
    action_id: ActionIdHeader,
    response: Response,
    session: SessionDependency,
    authenticated: CsrfProtectedSessionDependency,
    _payload: Annotated[EmptyInteractionRequest | None, Body()] = None,
) -> RecipeViewerStateResponse:
    response.headers.update(private_no_store_headers())
    actor_id = lock_active_member_actor(session, authenticated)
    intent = PreferenceEventIntent(
        action_id=action_id,
        user_id=actor_id,
        recipe_version_id=recipe_version_id,
        event_type="rating",
        rating_value=None,
    )
    replay = _is_replay_or_error(session, intent)
    ensure_recipe_exists(session, recipe_version_id)
    if not replay:
        unrate_recipe(
            session,
            user_id=actor_id,
            recipe_version_id=recipe_version_id,
        )
        record_preference_event(session, intent)
    viewer_state = recipe_viewer_state_response(
        session,
        user_id=actor_id,
        recipe_version_id=recipe_version_id,
    )
    session.commit()
    return viewer_state
