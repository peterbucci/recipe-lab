from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Query, Response, status
from pydantic import StringConstraints
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import (
    CsrfProtectedSessionDependency,
    RequiredAuthenticatedSessionDependency,
    SessionDependency,
)
from app.api.errors import ApiError
from app.api.member_context import lock_active_member_actor, lock_catalog_curator_actor
from app.repositories.catalog_requests import (
    browse_catalog_requests,
    get_catalog_request,
    is_catalog_curator,
)
from app.repositories.ingredients import browse_ingredients
from app.schemas.errors import ErrorResponse
from app.schemas.ingredient_catalog import (
    CatalogRequestStatus,
    IngredientCatalogItem,
    IngredientCatalogPage,
    IngredientCatalogRequestCreate,
    IngredientCatalogRequestPage,
    IngredientCatalogRequestResponse,
    IngredientCatalogRequestReviewResponse,
    IngredientCatalogReviewPage,
    IngredientCatalogReviewRequest,
)
from app.services.catalog_requests import (
    CatalogRequestAlreadyReviewedError,
    CatalogRequestConflictError,
    review_catalog_request,
    submit_catalog_request,
)

router = APIRouter()

SearchTerm = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=100,
        pattern=r"^[^\x00]*$",
    ),
]

CATALOG_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    401: {"model": ErrorResponse, "description": "A valid member session is required."},
    403: {
        "model": ErrorResponse,
        "description": "CSRF, onboarding, or catalog-curator authorization failed.",
    },
    404: {"model": ErrorResponse, "description": "The catalog request does not exist."},
    409: {
        "model": ErrorResponse,
        "description": "A normalized request or catalog identity conflicts with this action.",
    },
    422: {"model": ErrorResponse, "description": "The request parameters are invalid."},
}


def _private_no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Vary"] = "Cookie"


@router.get(
    "/ingredients",
    response_model=IngredientCatalogPage,
    summary="Search curated ingredient identities",
    description=(
        "Searches canonical names and reviewed aliases literally. Each result appears once "
        "with its stable catalog ID; missing-item requests are never included."
    ),
)
def ingredient_catalog(
    session: SessionDependency,
    page: Annotated[int, Query(ge=1, le=1_000_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    q: Annotated[SearchTerm | None, Query()] = None,
) -> IngredientCatalogPage:
    result = browse_ingredients(
        session,
        search=q,
        offset=(page - 1) * page_size,
        limit=page_size,
    )
    return IngredientCatalogPage(
        items=[
            IngredientCatalogItem(
                id=item.id,
                canonical_name=item.canonical_name,
                aliases=sorted(
                    (alias.alias for alias in item.aliases),
                    key=lambda value: (value.casefold(), value),
                ),
            )
            for item in result.items
        ],
        page=page,
        page_size=page_size,
        total=result.total,
        total_pages=(result.total + page_size - 1) // page_size,
    )


@router.post(
    "/ingredient-requests",
    response_model=IngredientCatalogRequestResponse,
    status_code=status.HTTP_201_CREATED,
    responses=CATALOG_ERROR_RESPONSES,
    summary="Request a missing curated ingredient",
    description=(
        "Stores bounded member input in a review queue. A pending request is not a catalog "
        "identity and cannot be selected or published."
    ),
)
def create_ingredient_request(
    payload: Annotated[IngredientCatalogRequestCreate, Body()],
    response: Response,
    session: SessionDependency,
    authenticated: CsrfProtectedSessionDependency,
) -> IngredientCatalogRequestResponse:
    actor_id = lock_active_member_actor(session, authenticated)
    try:
        request = submit_catalog_request(
            session,
            requester_user_id=actor_id,
            payload=payload,
        )
        result = IngredientCatalogRequestResponse.model_validate(request)
        session.commit()
    except CatalogRequestConflictError as error:
        session.rollback()
        raise ApiError(
            status_code=409,
            code="ingredient_request_conflict",
            message=str(error),
        ) from error
    except IntegrityError as error:
        session.rollback()
        raise ApiError(
            status_code=409,
            code="ingredient_request_conflict",
            message="A matching request or catalog item was created concurrently.",
        ) from error

    response.headers["Location"] = f"/api/ingredient-requests/{result.id}"
    _private_no_store(response)
    return result


@router.get(
    "/ingredient-requests/mine",
    response_model=IngredientCatalogRequestPage,
    responses=CATALOG_ERROR_RESPONSES,
    summary="List the current member's ingredient requests",
)
def my_ingredient_requests(
    response: Response,
    session: SessionDependency,
    authenticated: RequiredAuthenticatedSessionDependency,
    page: Annotated[int, Query(ge=1, le=1_000_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> IngredientCatalogRequestPage:
    actor_id = lock_active_member_actor(session, authenticated)
    result = browse_catalog_requests(
        session,
        requester_user_id=actor_id,
        status=None,
        offset=(page - 1) * page_size,
        limit=page_size,
    )
    page_response = IngredientCatalogRequestPage(
        items=[IngredientCatalogRequestResponse.model_validate(item) for item in result.items],
        page=page,
        page_size=page_size,
        total=result.total,
        total_pages=(result.total + page_size - 1) // page_size,
    )
    session.commit()
    _private_no_store(response)
    return page_response


@router.get(
    "/ingredient-requests/{request_id}",
    response_model=IngredientCatalogRequestResponse,
    responses=CATALOG_ERROR_RESPONSES,
    summary="Read an ingredient request status",
)
def ingredient_request_detail(
    request_id: UUID,
    response: Response,
    session: SessionDependency,
    authenticated: RequiredAuthenticatedSessionDependency,
) -> IngredientCatalogRequestResponse:
    actor_id = lock_active_member_actor(session, authenticated)
    request = get_catalog_request(session, request_id)
    if request is None or (
        request.requester_user_id != actor_id and not is_catalog_curator(session, actor_id)
    ):
        session.rollback()
        raise ApiError(
            status_code=404,
            code="ingredient_request_not_found",
            message=f"Ingredient request {request_id} was not found.",
        )
    result = IngredientCatalogRequestResponse.model_validate(request)
    session.commit()
    _private_no_store(response)
    return result


@router.get(
    "/ingredient-requests",
    response_model=IngredientCatalogReviewPage,
    responses=CATALOG_ERROR_RESPONSES,
    summary="List ingredient requests for catalog review",
)
def review_queue(
    response: Response,
    session: SessionDependency,
    authenticated: RequiredAuthenticatedSessionDependency,
    page: Annotated[int, Query(ge=1, le=1_000_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    request_status: Annotated[CatalogRequestStatus | None, Query(alias="status")] = None,
) -> IngredientCatalogReviewPage:
    lock_catalog_curator_actor(session, authenticated)
    result = browse_catalog_requests(
        session,
        requester_user_id=None,
        status=request_status,
        offset=(page - 1) * page_size,
        limit=page_size,
    )
    page_response = IngredientCatalogReviewPage(
        items=[
            IngredientCatalogRequestReviewResponse.model_validate(item) for item in result.items
        ],
        page=page,
        page_size=page_size,
        total=result.total,
        total_pages=(result.total + page_size - 1) // page_size,
    )
    session.commit()
    _private_no_store(response)
    return page_response


@router.post(
    "/ingredient-requests/{request_id}/review",
    response_model=IngredientCatalogRequestReviewResponse,
    responses=CATALOG_ERROR_RESPONSES,
    summary="Review an ingredient catalog request",
    description=(
        "Only a separately granted catalog curator may apply one terminal decision. "
        "Approval creates the ingredient, reviewed aliases, provenance snapshot, and "
        "append-only audit event in one transaction."
    ),
)
def review_ingredient_request(
    request_id: UUID,
    payload: Annotated[IngredientCatalogReviewRequest, Body()],
    response: Response,
    session: SessionDependency,
    authenticated: CsrfProtectedSessionDependency,
) -> IngredientCatalogRequestReviewResponse:
    reviewer_id = lock_catalog_curator_actor(session, authenticated)
    try:
        request = review_catalog_request(
            session,
            request_id=request_id,
            reviewer_user_id=reviewer_id,
            payload=payload,
        )
        if request is None:
            raise ApiError(
                status_code=404,
                code="ingredient_request_not_found",
                message=f"Ingredient request {request_id} was not found.",
            )
        result = IngredientCatalogRequestReviewResponse.model_validate(request)
        session.commit()
    except ApiError:
        session.rollback()
        raise
    except CatalogRequestAlreadyReviewedError as error:
        session.rollback()
        raise ApiError(
            status_code=409,
            code="ingredient_request_already_reviewed",
            message=str(error),
        ) from error
    except CatalogRequestConflictError as error:
        session.rollback()
        raise ApiError(
            status_code=409,
            code="ingredient_catalog_conflict",
            message=str(error),
        ) from error
    except IntegrityError as error:
        session.rollback()
        raise ApiError(
            status_code=409,
            code="ingredient_catalog_conflict",
            message="The reviewed catalog names conflict with a concurrent catalog change.",
        ) from error

    _private_no_store(response)
    return result
