import hashlib
import hmac
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.domain_errors import (
    DomainConflictError,
    DomainForbiddenError,
    DomainNotFoundError,
    DomainRateLimitedError,
)
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
    count_sandbox_entries,
    create_oidc_identity,
    create_oidc_login_transaction,
    create_sandbox_entry,
    create_user_session,
    get_oidc_identity,
    get_sandbox_entry,
    get_user_by_handle,
    get_user_session_by_id,
    get_user_session_by_token_digest,
    lock_oidc_identity_key,
    lock_sandbox_entry_allocation,
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


class DemoUnavailableError(DomainNotFoundError):
    code = "demo_unavailable"
    public_message = "The interactive demo is unavailable."


class DemoGenerationChangedError(DomainConflictError):
    code = "demo_generation_changed"
    public_message = "This demo has expired or reset. Refresh before starting a new visit."


class DemoEntryExpiredError(DomainConflictError):
    code = "demo_entry_expired"
    public_message = "This demo visit has ended. Start a new visit to continue."


class DemoCapacityReachedError(DomainRateLimitedError):
    code = "demo_capacity_reached"
    public_message = "The demo is at capacity. Please return after its next reset."


class DemoSensitiveOperationUnavailableError(DomainForbiddenError):
    code = "demo_sensitive_operation_unavailable"
    public_message = (
        "Temporary demo accounts cannot perform provider-verified account operations. "
        "Sign out to end your visit; demo data expires with the environment."
    )


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
    temporary: bool = False


def utc_now() -> datetime:
    return datetime.now(UTC)


def require_current_sandbox_generation(
    settings: Settings, *, generation_id: UUID, now: datetime
) -> None:
    sandbox = settings.sandbox
    if not sandbox.enabled:
        raise DemoUnavailableError()
    if (
        generation_id != sandbox.generation_id
        or sandbox.started_at is None
        or sandbox.expires_at is None
        or not sandbox.started_at <= now < sandbox.expires_at
    ):
        raise DemoGenerationChangedError()


def issue_sandbox_session(
    session: Session,
    *,
    settings: Settings,
    entry_key: str,
    generation_id: UUID,
    now: datetime,
) -> IssuedSession:
    """Allocate one temporary member or replay its still-active issuance.

    The browser's transient random entry key is never persisted. Domain-separated
    derivation recovers retry cookies without storing bearer tokens or inventing
    provider authentication. A generation-wide lock also bounds total allocation.
    """

    sandbox = settings.sandbox
    require_current_sandbox_generation(settings, generation_id=generation_id, now=now)
    assert sandbox.expires_at is not None
    lock_sandbox_entry_allocation(session, generation_id)
    entry_digest = token_digest(entry_key)
    raw_session_token = hmac.new(
        entry_key.encode(), f"recipe-lab-demo-session-v1:{generation_id}".encode(), hashlib.sha256
    ).hexdigest()
    raw_csrf_token = hmac.new(
        entry_key.encode(), f"recipe-lab-demo-csrf-v1:{generation_id}".encode(), hashlib.sha256
    ).hexdigest()
    entry = get_sandbox_entry(session, entry_digest)
    if entry is not None:
        stored = entry.user_session
        if (
            entry.generation_id != generation_id
            or stored.revoked_at is not None
            or stored.expires_at <= now
            or stored.user.account_kind != ACCOUNT_KIND_MEMBER
            or stored.user.status != USER_STATUS_ACTIVE
            or stored.token_digest != token_digest(raw_session_token)
        ):
            raise DemoEntryExpiredError()
        return IssuedSession(
            session_token=raw_session_token,
            csrf_token=raw_csrf_token,
            expires_at=stored.expires_at,
            return_path="/",
            user=stored.user,
        )
    if count_sandbox_entries(session, generation_id) >= sandbox.entry_global_limit:
        raise DemoCapacityReachedError(
            headers={"Retry-After": str(max(1, int((sandbox.expires_at - now).total_seconds())))}
        )
    user_id = uuid4()
    user = User(
        id=user_id,
        email=f"visitor-{user_id.hex}@sandbox.recipe-lab.invalid",
        handle=f"demo_{user_id.hex[:24]}",
        display_name=f"Demo cook {user_id.hex[:6]}",
        account_kind=ACCOUNT_KIND_MEMBER,
        status=USER_STATUS_ACTIVE,
    )
    session.add(user)
    session.flush()
    expires_at = min(now + timedelta(seconds=settings.session.ttl_seconds), sandbox.expires_at)
    stored = create_user_session(
        session,
        user=user,
        token_digest=token_digest(raw_session_token),
        csrf_token_digest=token_digest(raw_csrf_token),
        expires_at=expires_at,
        last_seen_at=now,
        authenticated_at=None,
    )
    create_sandbox_entry(
        session,
        entry_digest=entry_digest,
        generation_id=generation_id,
        user_session=stored,
        now=now,
    )
    return IssuedSession(
        session_token=raw_session_token,
        csrf_token=raw_csrf_token,
        expires_at=expires_at,
        return_path="/",
        user=user,
    )


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
        expires_at=now + timedelta(seconds=settings.oidc.login_ttl_seconds),
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

    if authenticated.temporary:
        raise DemoSensitiveOperationUnavailableError()

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
        expires_at=now + timedelta(seconds=settings.oidc.login_ttl_seconds),
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
    expires_at = now + timedelta(seconds=settings.session.ttl_seconds)
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
    touch_interval_seconds: int = 0,
    settings: Settings | None = None,
) -> AuthenticatedSession | None:
    if not raw_session_token or len(raw_session_token) > 512:
        return None
    user_session = get_user_session_by_token_digest(session, token_digest(raw_session_token))
    if user_session is None:
        return None
    user = user_session.user
    entry = user_session.sandbox_entry
    if entry is not None:
        sandbox = (settings or get_settings()).sandbox
        if (
            not sandbox.enabled
            or entry.generation_id != sandbox.generation_id
            or sandbox.started_at is None
            or sandbox.expires_at is None
            or not sandbox.started_at <= now < sandbox.expires_at
        ):
            return None
    if (
        user_session.revoked_at is not None
        or user_session.expires_at <= now
        or user.account_kind != ACCOUNT_KIND_MEMBER
        or user.status != USER_STATUS_ACTIVE
    ):
        return None
    should_touch = touch and user_session.last_seen_at <= now - timedelta(
        seconds=max(0, touch_interval_seconds)
    )
    if should_touch:
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
        temporary=entry is not None,
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
    expires_at = now + timedelta(seconds=settings.session.ttl_seconds)
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
        temporary=authenticated.temporary,
    )
