from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import (
    ACCOUNT_KIND_MEMBER,
    USER_STATUS_ACTIVE,
    CatalogCurator,
    User,
)


class CatalogCuratorOperatorError(ValueError):
    """Raised when an operator request cannot safely change a curator grant."""


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
    retries and concurrent operator invocations safe and idempotent.
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
