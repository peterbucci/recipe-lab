from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, cast
from uuid import UUID

from sqlalchemy import String, and_, case, func, literal, or_, select, union_all
from sqlalchemy.orm import Session

from app.db.query import LIKE_ESCAPE, literal_contains_pattern
from app.models import (
    RECIPE_PUBLICATION_STATE_AUTHOR_WITHDRAWN,
    RECIPE_PUBLICATION_STATE_MODERATION_HIDDEN,
    RECIPE_PUBLICATION_STATE_PUBLISHED,
    USER_STATUS_ACTIVE,
    IngredientCatalogRequest,
    RecipeDraft,
    RecipeDraftIngredient,
    RecipeDraftInstruction,
    RecipeSave,
    RecipeVersion,
    RecipeVersionPublication,
    User,
    UserFollow,
)
from app.repositories.recipe_drafts import RecipeDraftBrowseItem
from app.repositories.recipes import publicly_readable_recipe_version_filter
from app.services.member_activity import (
    MemberActivityCursor,
    MemberActivityFilter,
    MemberActivityKind,
    MemberActivityState,
)


@dataclass(frozen=True, slots=True)
class StoredMemberActivity:
    entity_id: UUID
    kind: MemberActivityKind
    occurred_at: datetime
    state: MemberActivityState | None
    title: str


@dataclass(frozen=True, slots=True)
class MemberActivityCounts:
    all: int
    recipes: int
    saved: int
    requests: int


@dataclass(frozen=True, slots=True)
class MemberActivityPage:
    items: list[StoredMemberActivity]
    counts: MemberActivityCounts
    next_cursor: MemberActivityCursor | None


@dataclass(frozen=True, slots=True)
class MemberDashboardStats:
    versions_published: int
    active_drafts: int
    saved_recipes: int
    followers: int


@dataclass(frozen=True, slots=True)
class MemberDashboard:
    latest_draft: RecipeDraftBrowseItem | None
    recent_activity: list[StoredMemberActivity]
    stats: MemberDashboardStats


def _member_activity_source(actor_user_id: UUID) -> Any:
    draft_activity = select(
        literal("draft").label("kind"),
        RecipeDraft.id.label("entity_id"),
        RecipeDraft.updated_at.label("occurred_at"),
        RecipeDraft.title.label("title"),
        literal(None, String).label("state"),
        func.concat(
            RecipeDraft.title,
            " updated draft your draft was saved",
        ).label("search_text"),
    ).where(
        RecipeDraft.author_user_id == actor_user_id,
        RecipeDraft.status == "active",
    )
    publication_kind = case(
        (
            RecipeVersionPublication.state == RECIPE_PUBLICATION_STATE_AUTHOR_WITHDRAWN,
            "withdrawn",
        ),
        else_="published",
    )
    publication_search = case(
        (
            RecipeVersionPublication.state == RECIPE_PUBLICATION_STATE_AUTHOR_WITHDRAWN,
            " published recipe version withdrawn no longer publicly available",
        ),
        (
            RecipeVersionPublication.state == RECIPE_PUBLICATION_STATE_MODERATION_HIDDEN,
            " published recipe version hidden by moderation",
        ),
        else_=" published recipe version publicly available",
    )
    publication_activity = (
        select(
            publication_kind.label("kind"),
            RecipeVersion.id.label("entity_id"),
            RecipeVersionPublication.published_at.label("occurred_at"),
            RecipeVersion.title.label("title"),
            RecipeVersionPublication.state.label("state"),
            func.concat(RecipeVersion.title, publication_search).label("search_text"),
        )
        .join(
            RecipeVersionPublication,
            RecipeVersionPublication.recipe_version_id == RecipeVersion.id,
        )
        .where(RecipeVersion.created_by_user_id == actor_user_id)
    )
    saved_activity = (
        select(
            literal("saved").label("kind"),
            RecipeSave.recipe_version_id.label("entity_id"),
            RecipeSave.created_at.label("occurred_at"),
            RecipeVersion.title.label("title"),
            literal(None, String).label("state"),
            func.concat(
                RecipeVersion.title,
                " saved recipe added to your saved recipes",
            ).label("search_text"),
        )
        .join(RecipeVersion, RecipeVersion.id == RecipeSave.recipe_version_id)
        .where(
            RecipeSave.user_id == actor_user_id,
            publicly_readable_recipe_version_filter(),
        )
    )
    request_search = case(
        (
            IngredientCatalogRequest.status == "approved",
            " ingredient request approved available in the catalog",
        ),
        (
            IngredientCatalogRequest.status == "duplicate",
            " ingredient request matched matching ingredient already available",
        ),
        else_=" ingredient request rejected curator reviewed this request",
    )
    request_activity = select(
        literal("ingredient-request").label("kind"),
        IngredientCatalogRequest.id.label("entity_id"),
        IngredientCatalogRequest.reviewed_at.label("occurred_at"),
        IngredientCatalogRequest.proposed_name.label("title"),
        IngredientCatalogRequest.status.label("state"),
        func.concat(IngredientCatalogRequest.proposed_name, request_search).label("search_text"),
    ).where(
        IngredientCatalogRequest.requester_user_id == actor_user_id,
        IngredientCatalogRequest.reviewed_at.is_not(None),
    )
    return union_all(
        draft_activity,
        publication_activity,
        saved_activity,
        request_activity,
    ).subquery("member_activity")


def _activity_counts(session: Session, activity: Any) -> MemberActivityCounts:
    recipes = ("draft", "published", "withdrawn")
    row = session.execute(
        select(
            func.count().label("all"),
            func.count().filter(activity.c.kind.in_(recipes)).label("recipes"),
            func.count().filter(activity.c.kind == "saved").label("saved"),
            func.count().filter(activity.c.kind == "ingredient-request").label("requests"),
        ).select_from(activity)
    ).one()
    return MemberActivityCounts(
        all=int(row[0]),
        recipes=int(row[1]),
        saved=int(row[2]),
        requests=int(row[3]),
    )


def _stored_activity_items(rows: list[Any]) -> list[StoredMemberActivity]:
    return [
        StoredMemberActivity(
            entity_id=row.entity_id,
            kind=cast(MemberActivityKind, row.kind),
            occurred_at=row.occurred_at,
            state=cast(MemberActivityState | None, row.state),
            title=row.title,
        )
        for row in rows
    ]


def _activity_rows(
    session: Session,
    activity: Any,
    *,
    filters: list[Any],
    limit: int,
) -> list[Any]:
    return list(
        session.execute(
            select(
                activity.c.kind,
                activity.c.entity_id,
                activity.c.occurred_at,
                activity.c.title,
                activity.c.state,
            )
            .where(*filters)
            .order_by(
                activity.c.occurred_at.desc(),
                activity.c.kind,
                activity.c.entity_id,
            )
            .limit(limit)
        ).all()
    )


def browse_member_activity(
    session: Session,
    *,
    actor_user_id: UUID,
    selected_filter: MemberActivityFilter,
    search: str | None,
    cursor: MemberActivityCursor | None,
    limit: int,
) -> MemberActivityPage:
    """Return one bounded, stable page across the member's current activity sources."""

    activity = _member_activity_source(actor_user_id)
    filters = []
    if selected_filter == "recipes":
        filters.append(activity.c.kind.in_(("draft", "published", "withdrawn")))
    elif selected_filter == "saved":
        filters.append(activity.c.kind == "saved")
    elif selected_filter == "requests":
        filters.append(activity.c.kind == "ingredient-request")
    if search is not None:
        filters.append(
            activity.c.search_text.ilike(
                literal_contains_pattern(search),
                escape=LIKE_ESCAPE,
            )
        )
    if cursor is not None:
        filters.append(
            or_(
                activity.c.occurred_at < cursor.occurred_at,
                and_(
                    activity.c.occurred_at == cursor.occurred_at,
                    or_(
                        activity.c.kind > cursor.kind,
                        and_(
                            activity.c.kind == cursor.kind,
                            activity.c.entity_id > cursor.entity_id,
                        ),
                    ),
                ),
            )
        )
    rows = _activity_rows(session, activity, filters=filters, limit=limit + 1)
    has_more = len(rows) > limit
    items = _stored_activity_items(rows[:limit])
    next_cursor = None
    if has_more and items:
        last = items[-1]
        next_cursor = MemberActivityCursor(
            occurred_at=last.occurred_at,
            kind=last.kind,
            entity_id=last.entity_id,
        )
    return MemberActivityPage(
        items=items,
        counts=_activity_counts(session, activity),
        next_cursor=next_cursor,
    )


def list_recent_member_activity(
    session: Session,
    *,
    actor_user_id: UUID,
    limit: int,
) -> list[StoredMemberActivity]:
    """Load only the bounded items needed by the dashboard, without tab counts."""

    activity = _member_activity_source(actor_user_id)
    return _stored_activity_items(_activity_rows(session, activity, filters=[], limit=limit))


def _dashboard_stats(session: Session, actor_user_id: UUID) -> MemberDashboardStats:
    active_drafts = (
        select(func.count())
        .select_from(RecipeDraft)
        .where(
            RecipeDraft.author_user_id == actor_user_id,
            RecipeDraft.status == "active",
        )
        .scalar_subquery()
    )
    versions_published = (
        select(func.count())
        .select_from(RecipeVersionPublication)
        .where(
            RecipeVersionPublication.actor_user_id == actor_user_id,
            RecipeVersionPublication.state.in_(
                (
                    RECIPE_PUBLICATION_STATE_PUBLISHED,
                    RECIPE_PUBLICATION_STATE_MODERATION_HIDDEN,
                )
            ),
        )
        .scalar_subquery()
    )
    saved_recipes = (
        select(func.count())
        .select_from(RecipeSave)
        .join(RecipeVersion, RecipeVersion.id == RecipeSave.recipe_version_id)
        .where(
            RecipeSave.user_id == actor_user_id,
            publicly_readable_recipe_version_filter(),
        )
        .scalar_subquery()
    )
    followers = (
        select(func.count())
        .select_from(UserFollow)
        .join(User, User.id == UserFollow.follower_user_id)
        .where(
            UserFollow.followed_user_id == actor_user_id,
            User.status == USER_STATUS_ACTIVE,
            User.handle.is_not(None),
        )
        .scalar_subquery()
    )
    row = session.execute(select(active_drafts, versions_published, saved_recipes, followers)).one()
    return MemberDashboardStats(
        active_drafts=int(row[0] or 0),
        versions_published=int(row[1] or 0),
        saved_recipes=int(row[2] or 0),
        followers=int(row[3] or 0),
    )


def _latest_active_draft(
    session: Session,
    actor_user_id: UUID,
) -> RecipeDraftBrowseItem | None:
    ingredient_count = (
        select(func.count())
        .select_from(RecipeDraftIngredient)
        .where(RecipeDraftIngredient.recipe_draft_id == RecipeDraft.id)
        .correlate(RecipeDraft)
        .scalar_subquery()
    )
    instruction_count = (
        select(func.count())
        .select_from(RecipeDraftInstruction)
        .where(RecipeDraftInstruction.recipe_draft_id == RecipeDraft.id)
        .correlate(RecipeDraft)
        .scalar_subquery()
    )
    row = session.execute(
        select(RecipeDraft, ingredient_count, instruction_count)
        .where(
            RecipeDraft.author_user_id == actor_user_id,
            RecipeDraft.status == "active",
        )
        .order_by(RecipeDraft.updated_at.desc(), RecipeDraft.id)
        .limit(1)
    ).one_or_none()
    if row is None:
        return None
    draft, stored_ingredient_count, stored_instruction_count = row
    return RecipeDraftBrowseItem(
        draft=draft,
        ingredient_count=stored_ingredient_count,
        instruction_count=stored_instruction_count,
        source_recipe_title=None,
    )


def load_member_dashboard(session: Session, *, actor_user_id: UUID) -> MemberDashboard:
    return MemberDashboard(
        latest_draft=_latest_active_draft(session, actor_user_id),
        recent_activity=list_recent_member_activity(
            session,
            actor_user_id=actor_user_id,
            limit=3,
        ),
        stats=_dashboard_stats(session, actor_user_id),
    )
