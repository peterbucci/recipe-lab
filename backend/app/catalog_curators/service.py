from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import (
    ACCOUNT_KIND_MEMBER,
    USER_STATUS_ACTIVE,
    CatalogCurator,
    User,
)

DEFAULT_ELIGIBLE_MEMBER_LIMIT = 20
DEFAULT_CURATOR_LIST_LIMIT = 100
MAX_OPERATOR_RESULT_LIMIT = 100
MAX_OPERATOR_QUERY_LENGTH = 120


@dataclass(frozen=True, slots=True)
class EligibleCatalogCuratorMember:
    """Privacy-safe projection of a member who may receive a curator grant."""

    user_id: UUID
    handle: str
    display_name: str
    is_catalog_curator: bool


@dataclass(frozen=True, slots=True)
class CurrentCatalogCuratorGrant:
    """Privacy-safe projection of a current curator grant and its attribution."""

    user_id: UUID
    handle: str | None
    display_name: str
    is_eligible: bool
    granted_at: datetime
    granted_by_user_id: UUID | None


class CatalogCuratorOperatorError(ValueError):
    """Raised when an operator request cannot safely change a curator grant."""


def _bounded_limit(limit: int) -> int:
    if not 1 <= limit <= MAX_OPERATOR_RESULT_LIMIT:
        raise CatalogCuratorOperatorError(
            f"The result limit must be between 1 and {MAX_OPERATOR_RESULT_LIMIT}."
        )
    return limit


def _normalized_query(query: str | None) -> str | None:
    if query is None:
        return None
    normalized = query.strip()
    if not normalized:
        raise CatalogCuratorOperatorError("The member query must not be blank.")
    if len(normalized) > MAX_OPERATOR_QUERY_LENGTH:
        raise CatalogCuratorOperatorError(
            f"The member query must be at most {MAX_OPERATOR_QUERY_LENGTH} characters."
        )
    return normalized


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def find_eligible_catalog_curator_members(
    session: Session,
    *,
    query: str | None = None,
    limit: int = DEFAULT_ELIGIBLE_MEMBER_LIMIT,
) -> list[EligibleCatalogCuratorMember]:
    """Find a bounded, deterministic set of safe curator-grant candidates.

    Only active, onboarded member accounts are eligible. Search deliberately
    covers the stable user ID, handle, and display name; email and all identity
    and session data remain outside both the query and returned projection.
    """

    bounded_limit = _bounded_limit(limit)
    normalized_query = _normalized_query(query)
    filters = [
        User.account_kind == ACCOUNT_KIND_MEMBER,
        User.status == USER_STATUS_ACTIVE,
        User.handle.is_not(None),
    ]
    if normalized_query is not None:
        try:
            query_user_id = UUID(normalized_query)
        except ValueError:
            pattern = f"%{_escape_like(normalized_query)}%"
            filters.append(
                or_(
                    User.handle.ilike(pattern, escape="\\"),
                    User.display_name.ilike(pattern, escape="\\"),
                )
            )
        else:
            filters.append(User.id == query_user_id)

    statement = (
        select(
            User.id.label("user_id"),
            User.handle,
            User.display_name,
            CatalogCurator.user_id.is_not(None).label("is_catalog_curator"),
        )
        .outerjoin(CatalogCurator, CatalogCurator.user_id == User.id)
        .where(*filters)
        .order_by(
            func.lower(User.handle),
            User.handle,
            User.id,
        )
        .limit(bounded_limit)
    )
    return [
        EligibleCatalogCuratorMember(
            user_id=row.user_id,
            handle=row.handle,
            display_name=row.display_name,
            is_catalog_curator=row.is_catalog_curator,
        )
        for row in session.execute(statement)
    ]


def list_current_catalog_curators(
    session: Session,
    *,
    limit: int = DEFAULT_CURATOR_LIST_LIMIT,
) -> list[CurrentCatalogCuratorGrant]:
    """List current grants without hiding holders who are no longer eligible.

    Keeping suspended or incomplete grant holders in this bounded operator view
    is important because their grants still need to be discoverable for explicit
    revocation. Only public profile fields and grant audit attribution are read.
    """

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
            CatalogCurator.created_at.label("granted_at"),
            CatalogCurator.granted_by_user_id,
        )
        .select_from(CatalogCurator)
        .join(User, User.id == CatalogCurator.user_id)
        .order_by(
            User.handle.asc().nulls_last(),
            User.id,
        )
        .limit(bounded_limit)
    )
    return [
        CurrentCatalogCuratorGrant(
            user_id=row.user_id,
            handle=row.handle,
            display_name=row.display_name,
            is_eligible=row.is_eligible,
            granted_at=row.granted_at,
            granted_by_user_id=row.granted_by_user_id,
        )
        for row in session.execute(statement)
    ]


def _active_onboarded_member(session: Session, user_id: UUID, *, role: str) -> User:
    user = session.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None:
        raise CatalogCuratorOperatorError(f"The {role} user {user_id} does not exist.")
    if (
        user.account_kind != ACCOUNT_KIND_MEMBER
        or user.status != USER_STATUS_ACTIVE
        or user.handle is None
    ):
        raise CatalogCuratorOperatorError(
            f"The {role} user {user_id} must be an active, onboarded member."
        )
    return user


def grant_catalog_curator(
    session: Session,
    *,
    user_id: UUID,
    granted_by_user_id: UUID | None = None,
) -> bool:
    """Grant narrow catalog-review access, returning whether a row was created.

    The caller owns the transaction. PostgreSQL's conflict handling makes both
    retries and concurrent operator invocations safe and idempotent. The
    optional granting user is audit attribution only; authorization to invoke
    this operation belongs to the operator boundary outside this service.
    """

    _active_onboarded_member(session, user_id, role="target")
    if granted_by_user_id is not None:
        if granted_by_user_id == user_id:
            raise CatalogCuratorOperatorError(
                "The granting user must differ from the curator target."
            )
        _active_onboarded_member(session, granted_by_user_id, role="granting")

    created_user_id = session.scalar(
        insert(CatalogCurator)
        .values(
            user_id=user_id,
            granted_by_user_id=granted_by_user_id,
        )
        .on_conflict_do_nothing(index_elements=[CatalogCurator.user_id])
        .returning(CatalogCurator.user_id)
    )
    return created_user_id is not None


def revoke_catalog_curator(session: Session, *, user_id: UUID) -> bool:
    """Revoke narrow catalog-review access, returning whether a row was removed.

    Revocation deliberately remains available for suspended, incomplete, or
    already-deleted members. A missing grant is a successful no-op.
    """

    removed_user_id = session.scalar(
        delete(CatalogCurator)
        .where(CatalogCurator.user_id == user_id)
        .returning(CatalogCurator.user_id)
    )
    return removed_user_id is not None
