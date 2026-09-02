from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, joinedload, raiseload, selectinload
from sqlalchemy.sql.elements import ColumnElement

from app.models import (
    RECIPE_PUBLICATION_STATE_PUBLISHED,
    USER_STATUS_ACTIVE,
    RecipeVersion,
    RecipeVersionPublication,
    User,
    UserFollow,
)
from app.policies.recipe_visibility import publicly_readable_recipe_version_filter


@dataclass(frozen=True, slots=True)
class FollowCounts:
    follower_count: int
    following_count: int


@dataclass(frozen=True, slots=True)
class FollowerListEntry:
    follower: User
    followed_at: datetime


@dataclass(frozen=True, slots=True)
class FollowerListResult:
    items: list[FollowerListEntry]
    total: int


@dataclass(frozen=True, slots=True)
class CommunityActivityResult:
    items: list[RecipeVersion]
    total: int


def _active_follower_filters(*, followed_user_id: UUID) -> tuple[ColumnElement[bool], ...]:
    return (
        UserFollow.followed_user_id == followed_user_id,
        User.status == USER_STATUS_ACTIVE,
        User.handle.is_not(None),
    )


def count_followers(session: Session, *, user_id: UUID) -> int:
    return int(
        session.scalar(
            select(func.count())
            .select_from(UserFollow)
            .join(User, User.id == UserFollow.follower_user_id)
            .where(*_active_follower_filters(followed_user_id=user_id))
        )
        or 0
    )


def follow_counts(session: Session, *, user_id: UUID) -> FollowCounts:
    follower_count = (
        select(func.count())
        .select_from(UserFollow)
        .join(User, User.id == UserFollow.follower_user_id)
        .where(*_active_follower_filters(followed_user_id=user_id))
        .scalar_subquery()
    )
    following_count = (
        select(func.count())
        .select_from(UserFollow)
        .where(UserFollow.follower_user_id == user_id)
        .scalar_subquery()
    )
    followers, following = session.execute(select(follower_count, following_count)).one()
    return FollowCounts(
        follower_count=int(followers or 0),
        following_count=int(following or 0),
    )


def browse_followers(
    session: Session,
    *,
    followed_user_id: UUID,
    offset: int,
    limit: int,
) -> FollowerListResult:
    """Database-page the active public identities following one member."""

    filters = _active_follower_filters(followed_user_id=followed_user_id)
    total = (
        session.scalar(
            select(func.count())
            .select_from(UserFollow)
            .join(User, User.id == UserFollow.follower_user_id)
            .where(*filters)
        )
        or 0
    )
    rows = session.execute(
        select(User, UserFollow.created_at)
        .join(User, User.id == UserFollow.follower_user_id)
        .where(*filters)
        .order_by(
            UserFollow.created_at.desc(),
            UserFollow.follower_user_id,
        )
        .offset(offset)
        .limit(limit)
    )
    return FollowerListResult(
        items=[
            FollowerListEntry(follower=follower, followed_at=followed_at)
            for follower, followed_at in rows
        ],
        total=int(total),
    )


def browse_community_activity(
    session: Session,
    *,
    follower_user_id: UUID,
    offset: int,
    limit: int,
) -> CommunityActivityResult:
    """List public recipe publications from cooks one active member follows."""

    filters = (
        UserFollow.follower_user_id == follower_user_id,
        RecipeVersionPublication.state == RECIPE_PUBLICATION_STATE_PUBLISHED,
        User.status == USER_STATUS_ACTIVE,
        User.handle.is_not(None),
    )
    total = (
        session.scalar(
            select(func.count())
            .select_from(UserFollow)
            .join(
                RecipeVersion,
                RecipeVersion.created_by_user_id == UserFollow.followed_user_id,
            )
            .join(
                RecipeVersionPublication,
                RecipeVersionPublication.recipe_version_id == RecipeVersion.id,
            )
            .join(User, User.id == UserFollow.followed_user_id)
            .where(*filters)
        )
        or 0
    )
    statement = (
        select(RecipeVersion)
        .join(
            UserFollow,
            UserFollow.followed_user_id == RecipeVersion.created_by_user_id,
        )
        .join(
            RecipeVersionPublication,
            RecipeVersionPublication.recipe_version_id == RecipeVersion.id,
        )
        .join(User, User.id == UserFollow.followed_user_id)
        .options(
            joinedload(RecipeVersion.author),
            joinedload(RecipeVersion.publication),
            selectinload(
                RecipeVersion.parent.and_(publicly_readable_recipe_version_filter())
            ).joinedload(RecipeVersion.author),
            selectinload(RecipeVersion.categories),
            raiseload("*"),
        )
        .where(*filters)
        .order_by(
            RecipeVersionPublication.published_at.desc(),
            RecipeVersion.id,
        )
        .offset(offset)
        .limit(limit)
    )
    return CommunityActivityResult(
        items=list(session.scalars(statement)),
        total=int(total),
    )


def is_following(
    session: Session,
    *,
    follower_user_id: UUID,
    followed_user_id: UUID,
) -> bool:
    return (
        session.scalar(
            select(UserFollow.follower_user_id).where(
                UserFollow.follower_user_id == follower_user_id,
                UserFollow.followed_user_id == followed_user_id,
            )
        )
        is not None
    )


def follow_user(
    session: Session,
    *,
    follower_user_id: UUID,
    followed_user_id: UUID,
) -> None:
    session.execute(
        insert(UserFollow)
        .values(
            follower_user_id=follower_user_id,
            followed_user_id=followed_user_id,
        )
        .on_conflict_do_nothing(
            index_elements=[
                UserFollow.follower_user_id,
                UserFollow.followed_user_id,
            ]
        )
    )
    session.flush()


def unfollow_user(
    session: Session,
    *,
    follower_user_id: UUID,
    followed_user_id: UUID,
) -> None:
    session.execute(
        delete(UserFollow).where(
            UserFollow.follower_user_id == follower_user_id,
            UserFollow.followed_user_id == followed_user_id,
        )
    )
    session.flush()
