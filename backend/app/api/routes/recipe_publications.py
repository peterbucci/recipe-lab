from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Header, Response, status

from app.api.cache import apply_private_no_store
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
    RecipeVisibilityResponse,
    RecipeVisibilityUpdateRequest,
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
from app.services.recipe_visibility import (
    RecipeVisibilityModerationConflictError,
    RecipeVisibilityNotFoundError,
    set_authored_recipe_visibility,
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
DUPLICATE_PREFLIGHT_RESPONSES: dict[int | str, dict[str, object]] = {
    **PUBLICATION_ERROR_RESPONSES,
    status.HTTP_201_CREATED: {
        "description": (
            "The bounded duplicate comparison was recorded and returned in the response "
            "body. It is publication evidence, not a separately readable API resource."
        )
    },
}
DRAFT_PUBLICATION_RESPONSES: dict[int | str, dict[str, object]] = {
    **PUBLICATION_ERROR_RESPONSES,
    status.HTTP_201_CREATED: {
        "description": "The immutable recipe version was published.",
        "headers": {
            "Location": {
                "description": "Approved public Recipe Lab product route.",
                "schema": {"type": "string"},
                "x-recipe-lab-route-kind": "product-route",
                "x-recipe-lab-readable-target": "/recipes/{recipe_version_id}",
            }
        },
    },
}
VISIBILITY_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    401: {"model": ErrorResponse, "description": "A valid member session is required."},
    403: {
        "model": ErrorResponse,
        "description": "CSRF or Origin evidence is invalid, or account setup is incomplete.",
    },
    404: {
        "model": ErrorResponse,
        "description": "The authored publication was not found in this member's scope.",
    },
    409: {
        "model": ErrorResponse,
        "description": "Moderation-hidden content cannot be restored by its author.",
    },
    422: {
        "model": ErrorResponse,
        "description": "The recipe identifier or desired visibility state is invalid.",
    },
}


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


@router.put(
    "/recipes/{recipe_version_id}/visibility",
    response_model=RecipeVisibilityResponse,
    responses=VISIBILITY_ERROR_RESPONSES,
    summary="Withdraw or restore an authored recipe version",
    description=(
        "Sets only the authenticated version author's visibility choice. It never mutates "
        "the immutable recipe snapshot, its lineage, or independently authored descendants."
    ),
)
def update_authored_recipe_visibility(
    recipe_version_id: UUID,
    payload: Annotated[RecipeVisibilityUpdateRequest, Body()],
    response: Response,
    session: SessionDependency,
    authenticated: CsrfProtectedSessionDependency,
) -> RecipeVisibilityResponse:
    actor_id = lock_active_member_actor(session, authenticated)
    try:
        result = set_authored_recipe_visibility(
            session,
            actor_user_id=actor_id,
            recipe_version_id=recipe_version_id,
            desired_state=payload.state,
        )
    except RecipeVisibilityNotFoundError as error:
        session.rollback()
        raise ApiError(
            status_code=404,
            code="recipe_not_found",
            message="The recipe was not found or is not available in your authored recipes.",
        ) from error
    except RecipeVisibilityModerationConflictError as error:
        session.rollback()
        raise ApiError(
            status_code=409,
            code="recipe_visibility_managed_by_moderation",
            message="This recipe cannot be restored by its author.",
        ) from error

    apply_private_no_store(response)
    session.commit()
    return RecipeVisibilityResponse(
        recipe_version_id=result.recipe_version_id,
        state=result.state,
        updated_at=result.state_changed_at,
    )


@router.post(
    "/recipe-drafts/{draft_id}/duplicate-preflights",
    response_model=RecipeDuplicatePreflightResponse,
    status_code=status.HTTP_201_CREATED,
    responses=DUPLICATE_PREFLIGHT_RESPONSES,
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

    apply_private_no_store(response)
    session.commit()
    return result.response


@router.post(
    "/recipe-drafts/{draft_id}/publish",
    response_model=RecipeDraftPublicationResponse,
    status_code=status.HTTP_201_CREATED,
    responses=DRAFT_PUBLICATION_RESPONSES,
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
    apply_private_no_store(response)
    session.commit()
    return RecipeDraftPublicationResponse(
        recipe_version_id=result.recipe_version_id,
        location=result.location,
    )
