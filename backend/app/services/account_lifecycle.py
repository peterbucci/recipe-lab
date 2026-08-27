from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models import ACCOUNT_KIND_MEMBER, USER_STATUS_ACTIVE, USER_STATUS_DELETED
from app.repositories.account_lifecycle import (
    get_account_user_for_update,
    list_oidc_identity_keys_for_user,
    list_user_sessions_for_update,
    lock_account_lifecycle_user,
    purge_member_private_data,
)
from app.repositories.auth import get_oidc_identity, lock_oidc_identity_key
from app.services.auth import AuthenticatedSession

DELETED_COOK_DISPLAY_NAME = "Deleted cook"


class AccountDeletionNotAllowedError(ValueError):
    pass


class AccountDeletionConfirmationError(ValueError):
    pass


class RecentAuthenticationRequiredError(ValueError):
    pass


def delete_member_account(
    session: Session,
    *,
    authenticated: AuthenticatedSession,
    confirmation: str,
    recent_auth_ttl_seconds: int,
    now: datetime,
) -> None:
    """Irreversibly anonymize one member and remove all private account state."""

    lock_account_lifecycle_user(session, authenticated.user_id)
    identity_keys = list_oidc_identity_keys_for_user(session, authenticated.user_id)
    for issuer, subject in identity_keys:
        lock_oidc_identity_key(session, issuer=issuer, subject=subject)
        get_oidc_identity(
            session,
            issuer=issuer,
            subject=subject,
            for_update=True,
        )

    user_sessions = list_user_sessions_for_update(session, authenticated.user_id)
    current_session = next(
        (item for item in user_sessions if item.id == authenticated.session_id),
        None,
    )
    if (
        current_session is None
        or current_session.revoked_at is not None
        or current_session.expires_at <= now
    ):
        raise AccountDeletionNotAllowedError("Account cannot be deleted.")
    if (
        current_session.authenticated_at is None
        or current_session.authenticated_at < now - timedelta(seconds=recent_auth_ttl_seconds)
    ):
        raise RecentAuthenticationRequiredError("Recent authentication is required.")

    user = get_account_user_for_update(session, authenticated.user_id)
    if (
        user is None
        or user.account_kind != ACCOUNT_KIND_MEMBER
        or user.status != USER_STATUS_ACTIVE
    ):
        raise AccountDeletionNotAllowedError("Account cannot be deleted.")
    if confirmation != (user.handle or "DELETE"):
        raise AccountDeletionConfirmationError("Account deletion confirmation is invalid.")

    user.status = USER_STATUS_DELETED
    user.deleted_at = now
    user.email = None
    user.handle = None
    user.display_name = DELETED_COOK_DISPLAY_NAME
    session.flush()

    purge_member_private_data(
        session,
        user_id=user.id,
        deleted_at=now,
    )
    session.flush()
