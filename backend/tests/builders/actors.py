from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.models import ACCOUNT_KIND_MEMBER, USER_STATUS_ACTIVE, User


def persist_member(
    session: Session,
    *,
    user_id: UUID | None = None,
    handle: str | None = "test-member",
    display_name: str = "Test member",
    email: str | None = None,
    account_kind: str = ACCOUNT_KIND_MEMBER,
    status: str = USER_STATUS_ACTIVE,
) -> User:
    """Persist one member row without hiding scenario-specific grants or actions."""

    resolved_id = user_id or uuid4()
    user = User(
        id=resolved_id,
        email=email or f"{resolved_id}@example.test",
        display_name=display_name,
        handle=handle,
        account_kind=account_kind,
        status=status,
    )
    session.add(user)
    session.flush()
    return user
