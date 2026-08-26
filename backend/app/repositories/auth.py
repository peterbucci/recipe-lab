from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, or_, select, text
from sqlalchemy.orm import Session, joinedload

from app.models import OIDCIdentity, OIDCLoginTransaction, User, UserSession


def lock_oidc_identity_key(
    session: Session,
    *,
    issuer: str,
    subject: str,
) -> None:
    """Serialize first-login work for one exact OIDC issuer/subject pair."""

    session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:identity_key, CAST(0 AS bigint)))"),
        {"identity_key": f"{issuer}\x1f{subject}"},
    )


def get_oidc_identity(
    session: Session,
    *,
    issuer: str,
    subject: str,
    for_update: bool = False,
) -> OIDCIdentity | None:
    statement = select(OIDCIdentity).where(
        OIDCIdentity.issuer == issuer,
        OIDCIdentity.subject == subject,
    )
    if for_update:
        statement = statement.with_for_update()
    return session.scalar(statement)


def create_oidc_identity(
    session: Session,
    *,
    user: User,
    issuer: str,
    subject: str,
    email: str,
    email_verified: bool,
    last_seen_at: datetime,
) -> OIDCIdentity:
    identity = OIDCIdentity(
        user=user,
        issuer=issuer,
        subject=subject,
        email=email,
        email_verified=email_verified,
        last_seen_at=last_seen_at,
    )
    session.add(identity)
    session.flush()
    return identity


def touch_oidc_identity(
    session: Session,
    identity: OIDCIdentity,
    *,
    email: str,
    email_verified: bool,
    last_seen_at: datetime,
) -> None:
    identity.email = email
    identity.email_verified = email_verified
    identity.last_seen_at = last_seen_at
    session.flush()


def get_user_by_handle(
    session: Session,
    handle: str,
    *,
    for_update: bool = False,
) -> User | None:
    normalized_handle = handle.strip().lower()
    statement = select(User).where(User.handle == normalized_handle)
    if for_update:
        statement = statement.with_for_update()
    return session.scalar(statement)


def set_user_handle(session: Session, user: User, *, handle: str) -> None:
    user.handle = handle.strip().lower()
    session.flush()


def create_user_session(
    session: Session,
    *,
    user: User,
    token_digest: str,
    csrf_token_digest: str,
    expires_at: datetime,
    last_seen_at: datetime,
    authenticated_at: datetime | None = None,
) -> UserSession:
    user_session = UserSession(
        user=user,
        token_digest=token_digest,
        csrf_token_digest=csrf_token_digest,
        expires_at=expires_at,
        authenticated_at=authenticated_at,
        last_seen_at=last_seen_at,
        created_at=last_seen_at,
    )
    session.add(user_session)
    session.flush()
    return user_session


def get_user_session_by_token_digest(
    session: Session,
    token_digest: str,
    *,
    for_update: bool = False,
) -> UserSession | None:
    statement = (
        select(UserSession)
        .options(joinedload(UserSession.user))
        .where(UserSession.token_digest == token_digest)
    )
    if for_update:
        statement = statement.with_for_update(of=UserSession)
    return session.scalar(statement)


def get_user_session_by_id(
    session: Session,
    session_id: UUID,
    *,
    for_update: bool = False,
) -> UserSession | None:
    statement = (
        select(UserSession)
        .options(joinedload(UserSession.user))
        .where(UserSession.id == session_id)
    )
    if for_update:
        statement = statement.with_for_update(of=UserSession)
    return session.scalar(statement)


def touch_user_session(
    session: Session,
    user_session: UserSession,
    *,
    last_seen_at: datetime,
) -> None:
    user_session.last_seen_at = last_seen_at
    session.flush()


def revoke_user_session(
    session: Session,
    user_session: UserSession,
    *,
    revoked_at: datetime,
) -> None:
    if user_session.revoked_at is None:
        user_session.revoked_at = revoked_at
        session.flush()


def create_oidc_login_transaction(
    session: Session,
    *,
    state_digest: str,
    nonce: str,
    pkce_verifier: str,
    return_path: str,
    expires_at: datetime,
    purpose: str = "login",
    bound_session_id: UUID | None = None,
) -> OIDCLoginTransaction:
    login_transaction = OIDCLoginTransaction(
        state_digest=state_digest,
        nonce=nonce,
        pkce_verifier=pkce_verifier,
        return_path=return_path,
        purpose=purpose,
        bound_session_id=bound_session_id,
        expires_at=expires_at,
    )
    session.add(login_transaction)
    session.flush()
    return login_transaction


def prune_oidc_login_transactions(session: Session, *, now: datetime) -> None:
    """Delete expired or legacy-consumed rows that still contain flow secrets."""

    session.execute(
        delete(OIDCLoginTransaction).where(
            or_(
                OIDCLoginTransaction.expires_at <= now,
                OIDCLoginTransaction.consumed_at.is_not(None),
            )
        )
    )


def delete_oidc_login_transaction(
    session: Session,
    login_transaction: OIDCLoginTransaction,
) -> None:
    session.delete(login_transaction)
    session.flush()


def get_oidc_login_transaction_by_state_digest(
    session: Session,
    state_digest: str,
    *,
    for_update: bool = False,
) -> OIDCLoginTransaction | None:
    statement = select(OIDCLoginTransaction).where(
        OIDCLoginTransaction.state_digest == state_digest
    )
    if for_update:
        statement = statement.with_for_update()
    return session.scalar(statement)


def consume_oidc_login_transaction(
    session: Session,
    *,
    state_digest: str,
    now: datetime,
) -> OIDCLoginTransaction | None:
    login_transaction = get_oidc_login_transaction_by_state_digest(
        session,
        state_digest,
        for_update=True,
    )
    if (
        login_transaction is None
        or login_transaction.consumed_at is not None
        or login_transaction.expires_at <= now
    ):
        return None

    login_transaction.consumed_at = now
    session.flush()
    return login_transaction
