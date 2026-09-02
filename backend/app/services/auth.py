from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import (
    generate_opaque_token,
    generate_pkce_verifier,
    pkce_s256_challenge,
    token_digest,
    validate_return_path,
)
from app.models import ACCOUNT_KIND_MEMBER, USER_STATUS_ACTIVE, User, UserSession
from app.models.auth import (
    OIDC_LOGIN_PURPOSE_REAUTHENTICATE,
)
from app.repositories.auth import (
    create_oidc_identity,
    create_oidc_login_transaction,
    create_user_session,
    get_oidc_identity,
    get_user_by_handle,
    get_user_session_by_id,
    get_user_session_by_token_digest,
    lock_oidc_identity_key,
    prune_oidc_login_transactions,
    revoke_user_session,
    set_user_handle,
    touch_oidc_identity,
    touch_user_session,
)
from app.services.oidc import OIDCClient, VerifiedOIDCIdentity


class AccountCannotAuthenticateError(ValueError):
    pass


class HandleUnavailableError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class LoginStart:
    authorization_url: str
    state: str


@dataclass(frozen=True, slots=True)
class IssuedSession:
    session_token: str
    csrf_token: str
    expires_at: datetime
    return_path: str
    user: User


@dataclass(frozen=True, slots=True)
class AuthenticatedSession:
    session_id: UUID
    user_id: UUID
    csrf_token_digest: str
    expires_at: datetime
    handle: str | None
    display_name: str
    profile_description: str | None
    authenticated_at: datetime | None = None


def utc_now() -> datetime:
    return datetime.now(UTC)


def begin_oidc_login(
    session: Session,
    *,
    settings: Settings,
    oidc_client: OIDCClient,
    return_path: str,
    now: datetime,
    force_reauthentication: bool = False,
) -> LoginStart:
    safe_return_path = validate_return_path(return_path)
    state = generate_opaque_token()
    nonce = generate_opaque_token()
    verifier = generate_pkce_verifier()
    authorization_url = oidc_client.build_authorization_url(
        state=state,
        nonce=nonce,
        code_challenge=pkce_s256_challenge(verifier),
        force_reauthentication=force_reauthentication,
    )
    prune_oidc_login_transactions(session, now=now)
    create_oidc_login_transaction(
        session,
        state_digest=token_digest(state),
        nonce=nonce,
        pkce_verifier=verifier,
        return_path=safe_return_path,
        expires_at=now + timedelta(seconds=settings.oidc_login_ttl_seconds),
    )
    return LoginStart(authorization_url=authorization_url, state=state)


def begin_oidc_reauthentication(
    session: Session,
    *,
    settings: Settings,
    oidc_client: OIDCClient,
    authenticated: AuthenticatedSession,
    return_path: str,
    now: datetime,
) -> LoginStart:
    """Start an identity-provider prompt bound to the current local session."""

    bound_session = get_user_session_by_id(
        session,
        authenticated.session_id,
        for_update=True,
    )
    if (
        bound_session is None
        or bound_session.user_id != authenticated.user_id
        or bound_session.revoked_at is not None
        or bound_session.expires_at <= now
        or bound_session.user.account_kind != ACCOUNT_KIND_MEMBER
        or bound_session.user.status != USER_STATUS_ACTIVE
    ):
        raise AccountCannotAuthenticateError("Account cannot authenticate.")

    safe_return_path = validate_return_path(return_path)
    state = generate_opaque_token()
    nonce = generate_opaque_token()
    verifier = generate_pkce_verifier()
    authorization_url = oidc_client.build_authorization_url(
        state=state,
        nonce=nonce,
        code_challenge=pkce_s256_challenge(verifier),
        force_reauthentication=True,
    )
    prune_oidc_login_transactions(session, now=now)
    create_oidc_login_transaction(
        session,
        state_digest=token_digest(state),
        nonce=nonce,
        pkce_verifier=verifier,
        return_path=safe_return_path,
        expires_at=now + timedelta(seconds=settings.oidc_login_ttl_seconds),
        purpose=OIDC_LOGIN_PURPOSE_REAUTHENTICATE,
        bound_session_id=bound_session.id,
    )
    return LoginStart(authorization_url=authorization_url, state=state)


def issue_member_session(
    session: Session,
    *,
    settings: Settings,
    identity: VerifiedOIDCIdentity,
    return_path: str,
    now: datetime,
) -> IssuedSession:
    """Resolve one exact issuer/subject and issue a local opaque session.

    A transaction-scoped advisory lock makes the verified first-login upsert
    deterministic under concurrent callbacks. Email is metadata only and is
    deliberately never used to link accounts.
    """

    lock_oidc_identity_key(
        session,
        issuer=identity.issuer,
        subject=identity.subject,
    )
    oidc_identity = get_oidc_identity(
        session,
        issuer=identity.issuer,
        subject=identity.subject,
        for_update=True,
    )
    if oidc_identity is None:
        user = User(
            email=identity.email,
            display_name=identity.suggested_display_name,
            handle=None,
            account_kind=ACCOUNT_KIND_MEMBER,
            status=USER_STATUS_ACTIVE,
        )
        session.add(user)
        session.flush()
        create_oidc_identity(
            session,
            user=user,
            issuer=identity.issuer,
            subject=identity.subject,
            email=identity.email,
            email_verified=identity.email_verified,
            last_seen_at=now,
        )
    else:
        user = oidc_identity.user
        if user.account_kind != ACCOUNT_KIND_MEMBER or user.status != USER_STATUS_ACTIVE:
            raise AccountCannotAuthenticateError("Account cannot authenticate.")
        touch_oidc_identity(
            session,
            oidc_identity,
            email=identity.email,
            email_verified=identity.email_verified,
            last_seen_at=now,
        )

    if user.account_kind != ACCOUNT_KIND_MEMBER or user.status != USER_STATUS_ACTIVE:
        raise AccountCannotAuthenticateError("Account cannot authenticate.")

    raw_session_token = generate_opaque_token()
    raw_csrf_token = generate_opaque_token()
    expires_at = now + timedelta(seconds=settings.auth_session_ttl_seconds)
    create_user_session(
        session,
        user=user,
        token_digest=token_digest(raw_session_token),
        csrf_token_digest=token_digest(raw_csrf_token),
        expires_at=expires_at,
        last_seen_at=now,
        authenticated_at=identity.authenticated_at,
    )
    return IssuedSession(
        session_token=raw_session_token,
        csrf_token=raw_csrf_token,
        expires_at=expires_at,
        return_path=return_path,
        user=user,
    )


def resolve_authenticated_session(
    session: Session,
    *,
    raw_session_token: str,
    now: datetime,
    touch: bool = True,
) -> AuthenticatedSession | None:
    if not raw_session_token or len(raw_session_token) > 512:
        return None
    user_session = get_user_session_by_token_digest(session, token_digest(raw_session_token))
    if user_session is None:
        return None
    user = user_session.user
    if (
        user_session.revoked_at is not None
        or user_session.expires_at <= now
        or user.account_kind != ACCOUNT_KIND_MEMBER
        or user.status != USER_STATUS_ACTIVE
    ):
        return None
    if touch:
        touch_user_session(session, user_session, last_seen_at=now)
    return AuthenticatedSession(
        session_id=user_session.id,
        user_id=user.id,
        csrf_token_digest=user_session.csrf_token_digest,
        expires_at=user_session.expires_at,
        handle=user.handle,
        display_name=user.display_name,
        profile_description=user.profile_description,
        authenticated_at=user_session.authenticated_at,
    )


def issue_reauthenticated_session(
    session: Session,
    *,
    settings: Settings,
    identity: VerifiedOIDCIdentity,
    bound_session_id: UUID,
    return_path: str,
    now: datetime,
) -> IssuedSession:
    """Rotate one session only after an exact, recent provider authentication."""

    if identity.authenticated_at is None:
        raise AccountCannotAuthenticateError("Recent authentication is required.")
    lock_oidc_identity_key(session, issuer=identity.issuer, subject=identity.subject)
    oidc_identity = get_oidc_identity(
        session,
        issuer=identity.issuer,
        subject=identity.subject,
        for_update=True,
    )
    bound_session = get_user_session_by_id(session, bound_session_id, for_update=True)
    if (
        bound_session is None
        or bound_session.revoked_at is not None
        or bound_session.expires_at <= now
    ):
        raise AccountCannotAuthenticateError("Account cannot authenticate.")
    user = bound_session.user
    if (
        oidc_identity is None
        or oidc_identity.user_id != user.id
        or user.account_kind != ACCOUNT_KIND_MEMBER
        or user.status != USER_STATUS_ACTIVE
    ):
        raise AccountCannotAuthenticateError("Account cannot authenticate.")

    touch_oidc_identity(
        session,
        oidc_identity,
        email=identity.email,
        email_verified=identity.email_verified,
        last_seen_at=now,
    )
    revoke_user_session(session, bound_session, revoked_at=now)

    raw_session_token = generate_opaque_token()
    raw_csrf_token = generate_opaque_token()
    expires_at = now + timedelta(seconds=settings.auth_session_ttl_seconds)
    create_user_session(
        session,
        user=user,
        token_digest=token_digest(raw_session_token),
        csrf_token_digest=token_digest(raw_csrf_token),
        expires_at=expires_at,
        last_seen_at=now,
        authenticated_at=identity.authenticated_at,
    )
    return IssuedSession(
        session_token=raw_session_token,
        csrf_token=raw_csrf_token,
        expires_at=expires_at,
        return_path=return_path,
        user=user,
    )


def revoke_authenticated_session(
    session: Session,
    *,
    authenticated: AuthenticatedSession,
    now: datetime,
) -> None:
    user_session = session.get(UserSession, authenticated.session_id)
    if user_session is not None:
        revoke_user_session(session, user_session, revoked_at=now)


def update_member_profile(
    session: Session,
    *,
    authenticated: AuthenticatedSession,
    handle: str,
    display_name: str,
    profile_description: str | None = None,
    update_profile_description: bool = False,
) -> AuthenticatedSession:
    user = session.get(User, authenticated.user_id)
    if (
        user is None
        or user.account_kind != ACCOUNT_KIND_MEMBER
        or user.status != USER_STATUS_ACTIVE
    ):
        raise AccountCannotAuthenticateError("Account cannot authenticate.")

    existing = get_user_by_handle(session, handle, for_update=True)
    if existing is not None and existing.id != user.id:
        raise HandleUnavailableError("Handle is unavailable.")
    set_user_handle(session, user, handle=handle)
    user.display_name = display_name
    if update_profile_description:
        user.profile_description = profile_description
    session.flush()
    return AuthenticatedSession(
        session_id=authenticated.session_id,
        user_id=user.id,
        csrf_token_digest=authenticated.csrf_token_digest,
        expires_at=authenticated.expires_at,
        handle=user.handle,
        display_name=user.display_name,
        profile_description=user.profile_description,
        authenticated_at=authenticated.authenticated_at,
    )
