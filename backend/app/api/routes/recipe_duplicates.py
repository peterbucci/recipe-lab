from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Header, Response, status

from app.api.dependencies import CsrfProtectedSessionDependency, SessionDependency
from app.api.errors import ApiError
from app.api.member_context import lock_active_member_actor
from app.repositories.recipe_duplicates import (
    RecipeDuplicatePreflightNotFoundError,
    RecipeDuplicateStorageConflictError,
)
from app.schemas.errors import ErrorResponse
from app.schemas.recipe_duplicates import (
    RecipeDuplicateDecisionRequest,
    RecipeDuplicateDecisionResponse,
    RecipeDuplicatePreflightResponse,
)
from app.schemas.recipe_forks import RecipeForkRequest
from app.services.recipe_duplicate_preflights import (
    RecipeDuplicateDecisionNotRequiredError,
    RecipeDuplicatePreflightCapacityError,
    RecipeDuplicatePreflightStaleError,
    RecipeDuplicatePreflightUnavailableError,
    record_recipe_duplicate_decision,
    run_recipe_duplicate_preflight,
)
from app.services.recipe_forks import InvalidRecipeEditsError

router = APIRouter()

ActionIdHeader = Annotated[
    UUID,
    Header(
        alias="Idempotency-Key",
        description=(
            "Opaque UUID scoped to this member and duplicate-preflight operation. "
            "Identical retries return the original immutable evidence."
        ),
    ),
]

PREFLIGHT_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    401: {"model": ErrorResponse, "description": "A valid member session is required."},
    403: {
        "model": ErrorResponse,
        "description": "CSRF or Origin evidence is invalid, or account setup is incomplete.",
    },
    404: {
        "model": ErrorResponse,
        "description": "The public source recipe version does not exist.",
    },
    409: {
        "model": ErrorResponse,
        "description": "The action key conflicts or stored evidence is no longer current.",
    },
    422: {
        "model": ErrorResponse,
        "description": "The request shape, identifier, or recipe edits are invalid.",
    },
    503: {
        "model": ErrorResponse,
        "description": "The bounded duplicate preflight is temporarily unavailable.",
    },
}
DECISION_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    401: {"model": ErrorResponse, "description": "A valid member session is required."},
    403: {
        "model": ErrorResponse,
        "description": "CSRF or Origin evidence is invalid, or account setup is incomplete.",
    },
    404: {
        "model": ErrorResponse,
        "description": "The member-scoped preflight does not exist.",
    },
    409: {
        "model": ErrorResponse,
        "description": "The action conflicts or acknowledgement is no longer current.",
    },
    422: {
        "model": ErrorResponse,
        "description": "The request shape or identifier is invalid.",
    },
}


def _private_no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Vary"] = "Cookie"


@router.post(
    "/recipes/{recipe_version_id}/duplicate-preflights",
    response_model=RecipeDuplicatePreflightResponse,
    status_code=status.HTTP_201_CREATED,
    responses=PREFLIGHT_ERROR_RESPONSES,
    summary="Check a proposed recipe variant for structural duplicates",
    description=(
        "Prepares the requested variant without inserting it, then compares only curated "
        "ingredient identities, normalized quantities, and structured cooking actions with "
        "public recipes. Results are advisory and never merge, delete, or publish content."
    ),
)
def create_recipe_duplicate_preflight(
    recipe_version_id: UUID,
    payload: Annotated[RecipeForkRequest, Body()],
    action_id: ActionIdHeader,
    response: Response,
    session: SessionDependency,
    authenticated: CsrfProtectedSessionDependency,
) -> RecipeDuplicatePreflightResponse:
    actor_id = lock_active_member_actor(session, authenticated)
    try:
        result = run_recipe_duplicate_preflight(
            session,
            source_version_id=recipe_version_id,
            actor_user_id=actor_id,
            action_id=action_id,
            payload=payload,
        )
    except RecipeDuplicateStorageConflictError as error:
        raise ApiError(
            status_code=409,
            code="idempotency_key_conflict",
            message="The Idempotency-Key conflicts with an earlier duplicate preflight.",
        ) from error
    except RecipeDuplicatePreflightStaleError as error:
        raise ApiError(
            status_code=409,
            code="duplicate_preflight_stale",
            message="The duplicate preflight is no longer current. Run it again.",
        ) from error
    except RecipeDuplicatePreflightUnavailableError as error:
        raise ApiError(
            status_code=404,
            code="recipe_not_found",
            message="The public source recipe version was not found.",
        ) from error
    except RecipeDuplicatePreflightCapacityError as error:
        raise ApiError(
            status_code=503,
            code="duplicate_preflight_unavailable",
            message="Duplicate preflight is temporarily unavailable. Please try again later.",
        ) from error
    except InvalidRecipeEditsError as error:
        raise ApiError(
            status_code=422,
            code="invalid_recipe_edits",
            message=str(error),
        ) from error

    _private_no_store(response)
    session.commit()
    return result.response


@router.post(
    "/recipe-duplicate-preflights/{preflight_id}/decision",
    response_model=RecipeDuplicateDecisionResponse,
    status_code=status.HTTP_201_CREATED,
    responses=DECISION_ERROR_RESPONSES,
    summary="Record an advisory duplicate-preflight decision",
    description=(
        "Records the member's continue-or-revise choice against the exact immutable result "
        "they acknowledged. It does not create, publish, merge, or delete a recipe."
    ),
)
def create_recipe_duplicate_decision(
    preflight_id: UUID,
    payload: Annotated[RecipeDuplicateDecisionRequest, Body()],
    action_id: ActionIdHeader,
    response: Response,
    session: SessionDependency,
    authenticated: CsrfProtectedSessionDependency,
) -> RecipeDuplicateDecisionResponse:
    actor_id = lock_active_member_actor(session, authenticated)
    try:
        result = record_recipe_duplicate_decision(
            session,
            preflight_id=preflight_id,
            actor_user_id=actor_id,
            action_id=action_id,
            payload=payload,
        )
    except RecipeDuplicatePreflightNotFoundError as error:
        raise ApiError(
            status_code=404,
            code="duplicate_preflight_not_found",
            message="The duplicate preflight was not found.",
        ) from error
    except RecipeDuplicatePreflightStaleError as error:
        raise ApiError(
            status_code=409,
            code="duplicate_preflight_stale",
            message="The duplicate preflight is no longer current. Run it again.",
        ) from error
    except RecipeDuplicateDecisionNotRequiredError as error:
        raise ApiError(
            status_code=409,
            code="duplicate_decision_not_required",
            message="A distinct result does not require an author decision.",
        ) from error
    except RecipeDuplicateStorageConflictError as error:
        raise ApiError(
            status_code=409,
            code="idempotency_key_conflict",
            message="The Idempotency-Key conflicts with an earlier duplicate decision.",
        ) from error

    _private_no_store(response)
    session.commit()
    return result.response
