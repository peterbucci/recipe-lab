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
from app.schemas.recipe_duplicates import RecipeDuplicatePreflightResponse
from app.schemas.recipe_publications import (
    RecipeDraftDuplicatePreflightRequest,
    RecipeDraftPublicationRequest,
    RecipeDraftPublicationResponse,
)
from app.services.recipe_duplicate_preflights import (
    RecipeDuplicateDecisionNotRequiredError,
    RecipeDuplicateDecisionRequiredError,
    RecipeDuplicatePreflightCapacityError,
    RecipeDuplicatePreflightStaleError,
)
from app.services.recipe_publications import (
    InvalidOriginalRecipePublicationError,
    InvalidRecipeDraftPublicationError,
    RecipeForkSourceUnavailableError,
    RecipePublicationIdempotencyConflictError,
    RecipePublicationNotFoundError,
    RecipePublicationRevisionConflictError,
    publish_recipe_draft,
    run_recipe_draft_duplicate_preflight,
)

router = APIRouter()

PublicationActionIdHeader = Annotated[
    UUID,
    Header(
        alias="Idempotency-Key",
        description=(
            "Opaque UUID scoped to this member and operation. Identical retries reuse "
            "the original immutable evidence or published recipe."
        ),
    ),
]

PUBLICATION_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    401: {"model": ErrorResponse, "description": "A valid member session is required."},
    403: {
        "model": ErrorResponse,
        "description": "CSRF or Origin evidence is invalid, or account setup is incomplete.",
    },
    404: {
        "model": ErrorResponse,
        "description": "The member-owned draft or duplicate preflight was not found.",
    },
    409: {
        "model": ErrorResponse,
        "description": "The revision, evidence, decision, or idempotency key conflicts.",
    },
    422: {
        "model": ErrorResponse,
        "description": "The recipe draft is incomplete or invalid.",
    },
    503: {
        "model": ErrorResponse,
        "description": "Duplicate comparison is temporarily unavailable.",
    },
}


def _private_no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Vary"] = "Cookie"


def _draft_not_found(draft_id: UUID) -> ApiError:
    return ApiError(
        status_code=404,
        code="recipe_draft_not_found",
        message=f"Recipe draft {draft_id} was not found.",
    )


def _revision_conflict() -> ApiError:
    return ApiError(
        status_code=409,
        code="recipe_draft_revision_conflict",
        message="This draft has a newer saved revision. Reload it before trying again.",
    )


@router.post(
    "/recipe-drafts/{draft_id}/duplicate-preflights",
    response_model=RecipeDuplicatePreflightResponse,
    status_code=status.HTTP_201_CREATED,
    responses=PUBLICATION_ERROR_RESPONSES,
    summary="Check a private draft for structural duplicates",
    description=(
        "Fully validates one current draft and stores a bounded advisory comparison with "
        "public immutable recipes. Source-backed drafts also compare against their direct "
        "parent for the no-change warning. This does not publish or expose the draft."
    ),
)
def create_original_draft_duplicate_preflight(
    draft_id: UUID,
    payload: Annotated[RecipeDraftDuplicatePreflightRequest, Body()],
    action_id: PublicationActionIdHeader,
    response: Response,
    session: SessionDependency,
    authenticated: CsrfProtectedSessionDependency,
) -> RecipeDuplicatePreflightResponse:
    actor_id = lock_active_member_actor(session, authenticated)
    try:
        result = run_recipe_draft_duplicate_preflight(
            session,
            author_user_id=actor_id,
            draft_id=draft_id,
            expected_revision=payload.revision,
            action_id=action_id,
        )
    except RecipePublicationNotFoundError as error:
        session.rollback()
        raise _draft_not_found(draft_id) from error
    except RecipePublicationRevisionConflictError as error:
        session.rollback()
        raise _revision_conflict() from error
    except InvalidOriginalRecipePublicationError as error:
        session.rollback()
        raise ApiError(
            status_code=422,
            code="invalid_original_recipe_draft",
            message=str(error),
        ) from error
    except InvalidRecipeDraftPublicationError as error:
        session.rollback()
        raise ApiError(
            status_code=422,
            code="invalid_recipe_draft",
            message=str(error),
        ) from error
    except RecipeForkSourceUnavailableError as error:
        session.rollback()
        raise ApiError(
            status_code=409,
            code="recipe_fork_source_unavailable",
            message=(
                "The public source recipe is no longer available. Your private draft is unchanged."
            ),
        ) from error
    except RecipeDuplicatePreflightStaleError as error:
        session.rollback()
        raise ApiError(
            status_code=409,
            code="duplicate_preflight_stale",
            message="The duplicate preflight is no longer current. Run it again.",
        ) from error
    except RecipePublicationIdempotencyConflictError as error:
        session.rollback()
        raise ApiError(
            status_code=409,
            code="recipe_draft_already_published",
            message=str(error),
        ) from error
    except RecipeDuplicateStorageConflictError as error:
        session.rollback()
        raise ApiError(
            status_code=409,
            code="idempotency_key_conflict",
            message="The Idempotency-Key conflicts with an earlier duplicate preflight.",
        ) from error
    except RecipeDuplicatePreflightCapacityError as error:
        session.rollback()
        raise ApiError(
            status_code=503,
            code="duplicate_preflight_unavailable",
            message="Duplicate preflight is temporarily unavailable. Please try again later.",
        ) from error

    response.headers["Location"] = (
        f"/api/recipe-duplicate-preflights/{result.response.acknowledgement.preflight_id}"
    )
    _private_no_store(response)
    session.commit()
    return result.response


@router.post(
    "/recipe-drafts/{draft_id}/publish",
    response_model=RecipeDraftPublicationResponse,
    status_code=status.HTTP_201_CREATED,
    responses=PUBLICATION_ERROR_RESPONSES,
    summary="Publish a private draft as an immutable recipe version",
    description=(
        "Revalidates the complete curated draft and duplicate evidence in one serialized "
        "transaction. Source-less drafts create roots; source-backed drafts create direct "
        "children in the source lineage and one fork preference event."
    ),
)
def publish_original_draft(
    draft_id: UUID,
    payload: Annotated[RecipeDraftPublicationRequest, Body()],
    action_id: PublicationActionIdHeader,
    response: Response,
    session: SessionDependency,
    authenticated: CsrfProtectedSessionDependency,
) -> RecipeDraftPublicationResponse:
    actor_id = lock_active_member_actor(session, authenticated)
    try:
        result = publish_recipe_draft(
            session,
            author_user_id=actor_id,
            draft_id=draft_id,
            payload=payload,
            action_id=action_id,
        )
    except RecipePublicationNotFoundError as error:
        session.rollback()
        raise _draft_not_found(draft_id) from error
    except RecipePublicationRevisionConflictError as error:
        session.rollback()
        raise _revision_conflict() from error
    except InvalidOriginalRecipePublicationError as error:
        session.rollback()
        raise ApiError(
            status_code=422,
            code="invalid_original_recipe_draft",
            message=str(error),
        ) from error
    except InvalidRecipeDraftPublicationError as error:
        session.rollback()
        raise ApiError(
            status_code=422,
            code="invalid_recipe_draft",
            message=str(error),
        ) from error
    except RecipeForkSourceUnavailableError as error:
        session.rollback()
        raise ApiError(
            status_code=409,
            code="recipe_fork_source_unavailable",
            message=(
                "The public source recipe is no longer available. Your private draft is unchanged."
            ),
        ) from error
    except RecipeDuplicatePreflightNotFoundError as error:
        session.rollback()
        raise ApiError(
            status_code=404,
            code="duplicate_preflight_not_found",
            message="The duplicate preflight was not found.",
        ) from error
    except RecipeDuplicatePreflightStaleError as error:
        session.rollback()
        raise ApiError(
            status_code=409,
            code="duplicate_preflight_stale",
            message="The duplicate preflight is no longer current. Run it again.",
        ) from error
    except RecipeDuplicateDecisionRequiredError as error:
        session.rollback()
        raise ApiError(
            status_code=409,
            code="duplicate_decision_required",
            message="Duplicate candidates require an explicit continue decision.",
        ) from error
    except RecipeDuplicateDecisionNotRequiredError as error:
        session.rollback()
        raise ApiError(
            status_code=409,
            code="duplicate_decision_not_required",
            message="A distinct result does not accept a duplicate decision.",
        ) from error
    except (
        RecipeDuplicateStorageConflictError,
        RecipePublicationIdempotencyConflictError,
    ) as error:
        session.rollback()
        raise ApiError(
            status_code=409,
            code="idempotency_key_conflict",
            message="The Idempotency-Key or completed draft conflicts with another request.",
        ) from error
    except RecipeDuplicatePreflightCapacityError as error:
        session.rollback()
        raise ApiError(
            status_code=503,
            code="duplicate_preflight_unavailable",
            message="Duplicate preflight is temporarily unavailable. Please try again later.",
        ) from error

    response.headers["Location"] = result.location
    _private_no_store(response)
    session.commit()
    return RecipeDraftPublicationResponse(
        recipe_version_id=result.recipe_version_id,
        location=result.location,
    )
