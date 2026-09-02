from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Header, Query, Response, status

from app.api.cache import apply_private_no_store
from app.api.dependencies import (
    CsrfProtectedSessionDependency,
    RequiredAuthenticatedSessionDependency,
    SessionDependency,
)
from app.api.errors import ApiError
from app.api.member_context import lock_active_member_actor
from app.pagination import PageParams
from app.repositories.recipe_drafts import browse_owned_recipe_drafts, get_owned_recipe_draft
from app.schemas.errors import ErrorResponse
from app.schemas.recipe_drafts import (
    RecipeDraftCreateRequest,
    RecipeDraftDetailResponse,
    RecipeDraftPageResponse,
    RecipeDraftSummaryResponse,
    RecipeDraftUpdateRequest,
)
from app.services.recipe_drafts import (
    InvalidRecipeDraftError,
    RecipeDraftCreationIdempotencyConflictError,
    RecipeDraftRevisionConflictError,
    create_recipe_draft,
    discard_recipe_draft,
    recipe_draft_detail_response,
    replace_recipe_draft,
)

router = APIRouter()

DraftCreationActionHeader = Annotated[
    UUID,
    Header(
        alias="Idempotency-Key",
        description=(
            "Opaque UUID that binds one member to one blank-or-source draft creation intent."
        ),
    ),
]

DRAFT_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    401: {"model": ErrorResponse, "description": "A valid member session is required."},
    403: {"model": ErrorResponse, "description": "CSRF or onboarding validation failed."},
    404: {"model": ErrorResponse, "description": "The private draft or source was not found."},
    409: {"model": ErrorResponse, "description": "The submitted revision is stale."},
    422: {"model": ErrorResponse, "description": "The private draft content is invalid."},
}
DRAFT_CREATE_RESPONSES: dict[int | str, dict[str, object]] = {
    **DRAFT_ERROR_RESPONSES,
    409: {
        "model": ErrorResponse,
        "description": "The Idempotency-Key conflicts with an earlier creation intent.",
    },
    status.HTTP_201_CREATED: {
        "description": "The private recipe draft was created or safely recovered.",
        "headers": {
            "Location": {
                "description": "Owner-readable private draft detail resource.",
                "schema": {"type": "string"},
                "x-recipe-lab-route-kind": "api-resource",
                "x-recipe-lab-readable-target": "/api/recipe-drafts/{draft_id}",
            }
        },
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


@router.post(
    "/recipe-drafts",
    response_model=RecipeDraftDetailResponse,
    status_code=status.HTTP_201_CREATED,
    responses=DRAFT_CREATE_RESPONSES,
    summary="Create a private recipe draft",
    description=(
        "Creates a blank original draft or copies one exact public immutable recipe snapshot. "
        "The required Idempotency-Key recovers the same active draft after an ambiguous "
        "response. Authorship always comes from the active member session."
    ),
)
def create_private_recipe_draft(
    payload: Annotated[RecipeDraftCreateRequest, Body()],
    response: Response,
    session: SessionDependency,
    authenticated: CsrfProtectedSessionDependency,
    creation_action_id: DraftCreationActionHeader,
) -> RecipeDraftDetailResponse:
    actor_id = lock_active_member_actor(session, authenticated)
    try:
        draft = create_recipe_draft(
            session,
            author_user_id=actor_id,
            creation_action_id=creation_action_id,
            source_version_id=payload.source_version_id,
        )
    except RecipeDraftCreationIdempotencyConflictError as error:
        session.rollback()
        raise ApiError(
            status_code=409,
            code="idempotency_key_conflict",
            message="The Idempotency-Key conflicts with an earlier draft creation intent.",
        ) from error
    if draft is None:
        session.rollback()
        raise ApiError(
            status_code=404,
            code="recipe_source_not_found",
            message="The source recipe is not publicly available.",
        )

    draft_id = draft.id
    session.flush()
    session.expire_all()
    stored = get_owned_recipe_draft(
        session,
        author_user_id=actor_id,
        draft_id=draft_id,
    )
    if stored is None:
        raise RuntimeError("The newly created private draft could not be reloaded.")
    result = recipe_draft_detail_response(stored)
    session.commit()
    response.headers["Location"] = f"/api/recipe-drafts/{draft_id}"
    apply_private_no_store(response)
    return result


@router.get(
    "/recipe-drafts",
    response_model=RecipeDraftPageResponse,
    responses=DRAFT_ERROR_RESPONSES,
    summary="List my private recipe drafts",
)
def my_private_recipe_drafts(
    response: Response,
    session: SessionDependency,
    authenticated: RequiredAuthenticatedSessionDependency,
    source_version_id: Annotated[
        UUID | None,
        Query(
            description=(
                "Return only active drafts copied from this exact immutable recipe version."
            )
        ),
    ] = None,
    page: Annotated[int, Query(ge=1, le=1_000_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> RecipeDraftPageResponse:
    actor_id = lock_active_member_actor(session, authenticated)
    pagination = PageParams(page=page, page_size=page_size)
    stored = browse_owned_recipe_drafts(
        session,
        author_user_id=actor_id,
        source_version_id=source_version_id,
        offset=pagination.offset,
        limit=page_size,
    )
    result = RecipeDraftPageResponse(
        items=[
            RecipeDraftSummaryResponse(
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
            for item in stored.items
        ],
        page=page,
        page_size=page_size,
        total=stored.total,
        total_pages=pagination.total_pages(stored.total),
    )
    session.commit()
    apply_private_no_store(response)
    return result


@router.get(
    "/recipe-drafts/{draft_id}",
    response_model=RecipeDraftDetailResponse,
    responses=DRAFT_ERROR_RESPONSES,
    summary="Read my private recipe draft",
)
def private_recipe_draft_detail(
    draft_id: UUID,
    response: Response,
    session: SessionDependency,
    authenticated: RequiredAuthenticatedSessionDependency,
) -> RecipeDraftDetailResponse:
    actor_id = lock_active_member_actor(session, authenticated)
    draft = get_owned_recipe_draft(
        session,
        author_user_id=actor_id,
        draft_id=draft_id,
    )
    if draft is None:
        session.rollback()
        raise _draft_not_found(draft_id)
    result = recipe_draft_detail_response(draft)
    session.commit()
    apply_private_no_store(response)
    return result


@router.put(
    "/recipe-drafts/{draft_id}",
    response_model=RecipeDraftDetailResponse,
    responses=DRAFT_ERROR_RESPONSES,
    summary="Save a complete private recipe draft revision",
    description=(
        "Atomically replaces the member-owned draft document when the submitted revision "
        "matches. The source, author, status, and server-controlled ordering remain outside "
        "the client contract."
    ),
)
def save_private_recipe_draft(
    draft_id: UUID,
    payload: Annotated[RecipeDraftUpdateRequest, Body()],
    response: Response,
    session: SessionDependency,
    authenticated: CsrfProtectedSessionDependency,
) -> RecipeDraftDetailResponse:
    actor_id = lock_active_member_actor(session, authenticated)
    try:
        draft = replace_recipe_draft(
            session,
            author_user_id=actor_id,
            draft_id=draft_id,
            payload=payload,
        )
    except RecipeDraftRevisionConflictError as error:
        session.rollback()
        raise _revision_conflict() from error
    except InvalidRecipeDraftError as error:
        session.rollback()
        raise ApiError(
            status_code=422,
            code="invalid_recipe_draft",
            message=str(error),
        ) from error

    if draft is None:
        session.rollback()
        raise _draft_not_found(draft_id)

    session.flush()
    session.expire_all()
    stored = get_owned_recipe_draft(
        session,
        author_user_id=actor_id,
        draft_id=draft_id,
    )
    if stored is None:
        raise RuntimeError("The saved private draft could not be reloaded.")
    result = recipe_draft_detail_response(stored)
    session.commit()
    apply_private_no_store(response)
    return result


@router.delete(
    "/recipe-drafts/{draft_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=DRAFT_ERROR_RESPONSES,
    summary="Permanently discard my private recipe draft",
    description=(
        "Immediately and irreversibly deletes all private draft content when the submitted "
        "revision is current. A content-free terminal shell retains only bounded retry and "
        "lineage metadata."
    ),
)
def delete_private_recipe_draft(
    draft_id: UUID,
    revision: Annotated[int, Query(ge=1)],
    session: SessionDependency,
    authenticated: CsrfProtectedSessionDependency,
) -> Response:
    actor_id = lock_active_member_actor(session, authenticated)
    try:
        discarded = discard_recipe_draft(
            session,
            author_user_id=actor_id,
            draft_id=draft_id,
            expected_revision=revision,
        )
    except RecipeDraftRevisionConflictError as error:
        session.rollback()
        raise _revision_conflict() from error
    if not discarded:
        session.rollback()
        raise _draft_not_found(draft_id)
    session.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    apply_private_no_store(response)
    return response
