from typing import Annotated

from fastapi import APIRouter, Query, Response
from pydantic import StringConstraints

from app.api.cache import apply_private_no_store
from app.api.dependencies import RequiredAuthenticatedSessionDependency, SessionDependency
from app.api.member_context import lock_active_member_actor
from app.repositories.member_activity import (
    MemberActivityPage,
    StoredMemberActivity,
    browse_member_activity,
    load_member_dashboard,
)
from app.schemas.errors import ErrorResponse
from app.schemas.member_activity import (
    MemberActivityCounts,
    MemberActivityItem,
    MemberDashboardStats,
    MyMemberActivityResponse,
    MyMemberDashboardResponse,
)
from app.services.member_activity import (
    MemberActivityFilter,
    decode_member_activity_cursor,
    encode_member_activity_cursor,
)
from app.services.recipe_responses import recipe_draft_summary_response

router = APIRouter(prefix="/my")

SearchTerm = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=100,
        pattern=r"^[^\x00]*$",
    ),
]

PRIVATE_ACTIVITY_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    401: {"model": ErrorResponse, "description": "A valid member session is required."},
    403: {"model": ErrorResponse, "description": "Account setup is incomplete."},
    422: {"model": ErrorResponse, "description": "An activity query parameter is invalid."},
}


def _activity_item(item: StoredMemberActivity) -> MemberActivityItem:
    return MemberActivityItem(
        id=item.entity_id,
        kind=item.kind,
        title=item.title,
        occurred_at=item.occurred_at,
        state=item.state,
    )


def _activity_response(
    stored: MemberActivityPage,
    *,
    selected_filter: MemberActivityFilter,
) -> MyMemberActivityResponse:
    return MyMemberActivityResponse(
        items=[_activity_item(item) for item in stored.items],
        counts=MemberActivityCounts(
            all=stored.counts.all,
            recipes=stored.counts.recipes,
            saved=stored.counts.saved,
            requests=stored.counts.requests,
        ),
        selected_filter=selected_filter,
        next_cursor=(
            encode_member_activity_cursor(stored.next_cursor)
            if stored.next_cursor is not None
            else None
        ),
    )


@router.get(
    "/activity",
    response_model=MyMemberActivityResponse,
    responses=PRIVATE_ACTIVITY_ERROR_RESPONSES,
    summary="List my recent account activity",
    description=(
        "Returns one bounded, cursor-paginated page across active drafts, current recipe "
        "publications, saved recipes, and reviewed ingredient requests."
    ),
)
def my_member_activity(
    response: Response,
    session: SessionDependency,
    authenticated: RequiredAuthenticatedSessionDependency,
    selected_filter: Annotated[MemberActivityFilter, Query(alias="filter")] = "all",
    q: Annotated[SearchTerm | None, Query()] = None,
    cursor: Annotated[str | None, Query(min_length=1, max_length=512)] = None,
    page_size: Annotated[int, Query(ge=1, le=100)] = 24,
) -> MyMemberActivityResponse:
    apply_private_no_store(response)
    actor_id = lock_active_member_actor(session, authenticated)
    decoded_cursor = decode_member_activity_cursor(cursor) if cursor is not None else None
    stored = browse_member_activity(
        session,
        actor_user_id=actor_id,
        selected_filter=selected_filter,
        search=q,
        cursor=decoded_cursor,
        limit=page_size,
    )
    result = _activity_response(stored, selected_filter=selected_filter)
    session.commit()
    return result


@router.get(
    "/dashboard",
    response_model=MyMemberDashboardResponse,
    responses=PRIVATE_ACTIVITY_ERROR_RESPONSES,
    summary="Read my dashboard summary",
    description=(
        "Returns the latest active draft, three recent activity items, and account totals in "
        "one bounded private read model."
    ),
)
def my_member_dashboard(
    response: Response,
    session: SessionDependency,
    authenticated: RequiredAuthenticatedSessionDependency,
) -> MyMemberDashboardResponse:
    apply_private_no_store(response)
    actor_id = lock_active_member_actor(session, authenticated)
    stored = load_member_dashboard(session, actor_user_id=actor_id)
    result = MyMemberDashboardResponse(
        latest_draft=(
            recipe_draft_summary_response(stored.latest_draft)
            if stored.latest_draft is not None
            else None
        ),
        recent_activity=[_activity_item(item) for item in stored.recent_activity],
        stats=MemberDashboardStats(
            versions_published=stored.stats.versions_published,
            active_drafts=stored.stats.active_drafts,
            saved_recipes=stored.stats.saved_recipes,
            followers=stored.stats.followers,
        ),
    )
    session.commit()
    return result
