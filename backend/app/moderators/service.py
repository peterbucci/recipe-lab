from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import String, and_, delete, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.db.query import LIKE_ESCAPE, literal_contains_pattern
from app.models import (
    ACCOUNT_KIND_MEMBER,
    USER_STATUS_ACTIVE,
    CatalogCurator,
    CommunityModerator,
    User,
)

DEFAULT_ELIGIBLE_MEMBER_LIMIT = 25
DEFAULT_MODERATOR_LIST_LIMIT = 100
MAX_OPERATOR_RESULT_LIMIT = 100
MAX_OPERATOR_QUERY_LENGTH = 120


@dataclass(frozen=True, slots=True)
class EligibleCommunityModerator:
    user_id: UUID
    handle: str
    display_name: str
    is_community_moderator: bool
    is_catalog_curator: bool


@dataclass(frozen=True, slots=True)
class CurrentCommunityModeratorGrant:
    user_id: UUID
    handle: str | None
    display_name: str
    is_eligible: bool
    is_catalog_curator: bool
    granted_at: datetime
    granted_by_user_id: UUID | None


class CommunityModeratorOperatorError(ValueError):
    pass


def _bounded_limit(limit: int) -> int:
    if not 1 <= limit <= MAX_OPERATOR_RESULT_LIMIT:
        raise CommunityModeratorOperatorError(
            f"Limit must be between 1 and {MAX_OPERATOR_RESULT_LIMIT}."
        )
    return limit


def find_eligible_community_moderators(
    session: Session,
    *,
    query: str | None = None,
    limit: int = DEFAULT_ELIGIBLE_MEMBER_LIMIT,
) -> list[EligibleCommunityModerator]:
    """Return only bounded public profile fields; email and identity data stay private."""

    bounded_limit = _bounded_limit(limit)
    filters = [
        User.account_kind == ACCOUNT_KIND_MEMBER,
        User.status == USER_STATUS_ACTIVE,
        User.handle.is_not(None),
    ]
    if query is not None:
        normalized_query = query.strip()
        if not normalized_query or len(normalized_query) > MAX_OPERATOR_QUERY_LENGTH:
            raise CommunityModeratorOperatorError(
                f"Query must contain 1 to {MAX_OPERATOR_QUERY_LENGTH} characters."
            )
        try:
            user_id = UUID(normalized_query)
        except ValueError:
            user_id = None
        literal_pattern = literal_contains_pattern(normalized_query)
        matches: list[ColumnElement[bool]] = [
            User.handle.ilike(literal_pattern, escape=LIKE_ESCAPE),
            User.display_name.ilike(literal_pattern, escape=LIKE_ESCAPE),
        ]
        if user_id is not None:
            matches.append(User.id == user_id)
        filters.append(or_(*matches))

    statement = (
        select(
            User.id.label("user_id"),
            User.handle.cast(String).label("handle"),
            User.display_name,
            CommunityModerator.user_id.is_not(None).label("is_community_moderator"),
            CatalogCurator.user_id.is_not(None).label("is_catalog_curator"),
        )
        .outerjoin(CommunityModerator, CommunityModerator.user_id == User.id)
        .outerjoin(CatalogCurator, CatalogCurator.user_id == User.id)
        .where(*filters)
        .order_by(User.handle, User.id)
        .limit(bounded_limit)
    )
    return [
        EligibleCommunityModerator(
            user_id=row.user_id,
            handle=row.handle,
            display_name=row.display_name,
            is_community_moderator=row.is_community_moderator,
            is_catalog_curator=row.is_catalog_curator,
        )
        for row in session.execute(statement)
    ]


def list_current_community_moderators(
    session: Session,
    *,
    limit: int = DEFAULT_MODERATOR_LIST_LIMIT,
) -> list[CurrentCommunityModeratorGrant]:
    """List active grants even when a holder became ineligible and needs revocation."""

    bounded_limit = _bounded_limit(limit)
    is_eligible = and_(
        User.account_kind == ACCOUNT_KIND_MEMBER,
        User.status == USER_STATUS_ACTIVE,
        User.handle.is_not(None),
    )
    statement = (
        select(
            User.id.label("user_id"),
            User.handle,
            User.display_name,
            is_eligible.label("is_eligible"),
            CatalogCurator.user_id.is_not(None).label("is_catalog_curator"),
            CommunityModerator.created_at.label("granted_at"),
            CommunityModerator.granted_by_user_id,
        )
        .select_from(CommunityModerator)
        .join(User, User.id == CommunityModerator.user_id)
        .outerjoin(CatalogCurator, CatalogCurator.user_id == User.id)
        .order_by(User.handle.asc().nulls_last(), User.id)
        .limit(bounded_limit)
    )
    return [
        CurrentCommunityModeratorGrant(
            user_id=row.user_id,
            handle=row.handle,
            display_name=row.display_name,
            is_eligible=row.is_eligible,
            is_catalog_curator=row.is_catalog_curator,
            granted_at=row.granted_at,
            granted_by_user_id=row.granted_by_user_id,
        )
        for row in session.execute(statement)
    ]


def _active_onboarded_member(session: Session, user_id: UUID, *, role: str) -> User:
    user = session.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None:
        raise CommunityModeratorOperatorError(f"The {role} user {user_id} does not exist.")
    if (
        user.account_kind != ACCOUNT_KIND_MEMBER
        or user.status != USER_STATUS_ACTIVE
        or user.handle is None
    ):
        raise CommunityModeratorOperatorError(
            f"The {role} user {user_id} must be an active, onboarded member."
        )
    return user


def grant_community_moderator(
    session: Session,
    *,
    user_id: UUID,
    granted_by_user_id: UUID | None = None,
) -> bool:
    """Grant moderation access; audit attribution never authorizes the command itself."""

    _active_onboarded_member(session, user_id, role="target")
    if granted_by_user_id is not None:
        if granted_by_user_id == user_id:
            raise CommunityModeratorOperatorError(
                "The granting user must differ from the moderator target."
            )
        _active_onboarded_member(session, granted_by_user_id, role="granting")
    created_user_id = session.scalar(
        insert(CommunityModerator)
        .values(user_id=user_id, granted_by_user_id=granted_by_user_id)
        .on_conflict_do_nothing(index_elements=[CommunityModerator.user_id])
        .returning(CommunityModerator.user_id)
    )
    return created_user_id is not None


def revoke_community_moderator(session: Session, *, user_id: UUID) -> bool:
    """Revoke immediately; a missing grant is an idempotent successful no-op."""

    removed_user_id = session.scalar(
        delete(CommunityModerator)
        .where(CommunityModerator.user_id == user_id)
        .returning(CommunityModerator.user_id)
    )
    return removed_user_id is not None
