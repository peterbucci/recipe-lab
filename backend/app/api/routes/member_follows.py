from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Path, Query, Response

from app.api.cache import apply_private_no_store
from app.api.dependencies import (
    CsrfProtectedSessionDependency,
    RequiredAuthenticatedSessionDependency,
    SessionDependency,
)
from app.api.errors import ApiError
from app.api.member_context import lock_active_member_actor
from app.models import USER_STATUS_ACTIVE, User
from app.pagination import PageParams
from app.repositories.account_lifecycle import lock_account_lifecycle_user
from app.repositories.auth import get_user_by_handle
from app.repositories.member_follows import (
    browse_community_activity,
    browse_followers,
    count_followers,
    follow_counts,
    follow_user,
    is_following,
    unfollow_user,
)
from app.schemas.errors import ErrorResponse
from app.schemas.member_follows import (
    CookFollowStateResponse,
    MyCommunityActivityResponse,
    MyFollowerItem,
    MyFollowersResponse,
    MyFollowStatsResponse,
)
from app.services.recipe_responses import public_user_reference, recipe_summary_response

router = APIRouter()

CookHandle = Annotated[
    str,
    Path(
        min_length=3,
        max_length=30,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{1,28}[A-Za-z0-9]$",
    ),
]

FOLLOW_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    401: {"model": ErrorResponse, "description": "A valid member session is required."},
    403: {
        "model": ErrorResponse,
        "description": "CSRF or Origin evidence is invalid, or account setup is incomplete.",
    },
    404: {"model": ErrorResponse, "description": "The public cook handle was not found."},
    409: {"model": ErrorResponse, "description": "A member cannot follow their own account."},
    422: {"model": ErrorResponse, "description": "The cook handle is invalid."},
}
PRIVATE_FOLLOW_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    401: {"model": ErrorResponse, "description": "A valid member session is required."},
    403: {"model": ErrorResponse, "description": "Account setup is incomplete."},
    422: {"model": ErrorResponse, "description": "A page parameter is invalid."},
}


def _followable_cook(
    session: SessionDependency,
    handle: str,
    *,
    for_update: bool = False,
) -> User:
    cook = get_user_by_handle(session, handle, for_update=for_update)
    if cook is None or cook.status != USER_STATUS_ACTIVE:
        raise ApiError(
            status_code=404,
            code="cook_not_found",
            message=f"Cook @{handle} was not found.",
        )
    return cook


def _state(
    session: SessionDependency,
    *,
    actor_id: UUID,
    cook: User,
) -> CookFollowStateResponse:
    return CookFollowStateResponse(
        cook_id=cook.id,
        following=is_following(
            session,
            follower_user_id=actor_id,
            followed_user_id=cook.id,
        ),
        follower_count=count_followers(session, user_id=cook.id),
    )


def _reject_self_follow(actor_id: UUID, cook: User) -> None:
    if actor_id == cook.id:
        raise ApiError(
            status_code=409,
            code="cannot_follow_self",
            message="You cannot follow your own account.",
        )


def _lock_follow_participants(
    session: SessionDependency,
    *,
    authenticated: RequiredAuthenticatedSessionDependency,
    handle: str,
) -> tuple[UUID, User]:
    candidate = _followable_cook(session, handle)
    for user_id in sorted((authenticated.user_id, candidate.id), key=str):
        lock_account_lifecycle_user(session, user_id)
    actor_id = lock_active_member_actor(session, authenticated)
    cook = _followable_cook(session, handle, for_update=True)
    _reject_self_follow(actor_id, cook)
    return actor_id, cook


@router.get(
    "/cooks/{handle}/follow",
    response_model=CookFollowStateResponse,
    responses=FOLLOW_ERROR_RESPONSES,
    summary="Read my follow state for a cook",
)
def cook_follow_state(
    handle: CookHandle,
    response: Response,
    session: SessionDependency,
    authenticated: RequiredAuthenticatedSessionDependency,
) -> CookFollowStateResponse:
    apply_private_no_store(response)
    actor_id = lock_active_member_actor(session, authenticated)
    cook = _followable_cook(session, handle)
    result = _state(session, actor_id=actor_id, cook=cook)
    session.commit()
    return result


@router.put(
    "/cooks/{handle}/follow",
    response_model=CookFollowStateResponse,
    responses=FOLLOW_ERROR_RESPONSES,
    summary="Follow a cook",
)
def follow_cook(
    handle: CookHandle,
    response: Response,
    session: SessionDependency,
    authenticated: CsrfProtectedSessionDependency,
) -> CookFollowStateResponse:
    apply_private_no_store(response)
    actor_id, cook = _lock_follow_participants(
        session,
        authenticated=authenticated,
        handle=handle,
    )
    follow_user(
        session,
        follower_user_id=actor_id,
        followed_user_id=cook.id,
    )
    result = _state(session, actor_id=actor_id, cook=cook)
    session.commit()
    return result


@router.delete(
    "/cooks/{handle}/follow",
    response_model=CookFollowStateResponse,
    responses=FOLLOW_ERROR_RESPONSES,
    summary="Unfollow a cook",
)
def unfollow_cook(
    handle: CookHandle,
    response: Response,
    session: SessionDependency,
    authenticated: CsrfProtectedSessionDependency,
) -> CookFollowStateResponse:
    apply_private_no_store(response)
    actor_id, cook = _lock_follow_participants(
        session,
        authenticated=authenticated,
        handle=handle,
    )
    unfollow_user(
        session,
        follower_user_id=actor_id,
        followed_user_id=cook.id,
    )
    result = _state(session, actor_id=actor_id, cook=cook)
    session.commit()
    return result


@router.get(
    "/my/follow-stats",
    response_model=MyFollowStatsResponse,
    responses=FOLLOW_ERROR_RESPONSES,
    summary="Read my follower and following totals",
)
def my_follow_stats(
    response: Response,
    session: SessionDependency,
    authenticated: RequiredAuthenticatedSessionDependency,
) -> MyFollowStatsResponse:
    apply_private_no_store(response)
    actor_id = lock_active_member_actor(session, authenticated)
    counts = follow_counts(session, user_id=actor_id)
    session.commit()
    return MyFollowStatsResponse(
        follower_count=counts.follower_count,
        following_count=counts.following_count,
    )


@router.get(
    "/my/followers",
    response_model=MyFollowersResponse,
    responses=PRIVATE_FOLLOW_ERROR_RESPONSES,
    summary="List my followers",
    description=(
        "Returns only active public follower identities for the signed-in member. "
        "Private account, email, identity-provider, and session data are never exposed."
    ),
)
def my_followers(
    response: Response,
    session: SessionDependency,
    authenticated: RequiredAuthenticatedSessionDependency,
    page: Annotated[int, Query(ge=1, le=1_000_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> MyFollowersResponse:
    apply_private_no_store(response)
    actor_id = lock_active_member_actor(session, authenticated)
    pagination = PageParams(page=page, page_size=page_size)
    stored = browse_followers(
        session,
        followed_user_id=actor_id,
        offset=pagination.offset,
        limit=page_size,
    )
    result = MyFollowersResponse(
        items=[
            MyFollowerItem(
                follower=public_user_reference(item.follower),
                followed_at=item.followed_at,
            )
            for item in stored.items
        ],
        page=page,
        page_size=page_size,
        total=stored.total,
        total_pages=pagination.total_pages(stored.total),
    )
    session.commit()
    return result


@router.get(
    "/my/community-activity",
    response_model=MyCommunityActivityResponse,
    responses=PRIVATE_FOLLOW_ERROR_RESPONSES,
    summary="List publications from cooks I follow",
    description=(
        "Returns publicly readable original recipes and new versions authored by active cooks "
        "the signed-in member currently follows, ordered by publication time."
    ),
)
def my_community_activity(
    response: Response,
    session: SessionDependency,
    authenticated: RequiredAuthenticatedSessionDependency,
    page: Annotated[int, Query(ge=1, le=1_000_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> MyCommunityActivityResponse:
    apply_private_no_store(response)
    actor_id = lock_active_member_actor(session, authenticated)
    pagination = PageParams(page=page, page_size=page_size)
    stored = browse_community_activity(
        session,
        follower_user_id=actor_id,
        offset=pagination.offset,
        limit=page_size,
    )
    result = MyCommunityActivityResponse(
        items=[recipe_summary_response(item) for item in stored.items],
        page=page,
        page_size=page_size,
        total=stored.total,
        total_pages=pagination.total_pages(stored.total),
    )
    session.commit()
    return result
