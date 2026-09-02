"""Application workflows for account authentication and lifecycle operations.

This module owns transaction and persistence orchestration.  HTTP concerns such
as cookies, redirects, status codes, and response schemas remain in the API
route module.
"""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import secrets_match, token_digest
from app.models.auth import OIDC_LOGIN_PURPOSE_REAUTHENTICATE
from app.repositories.auth import (
    consume_oidc_login_transaction,
    delete_oidc_login_transaction,
)
from app.repositories.catalog_requests import is_catalog_curator
from app.repositories.moderation import is_community_moderator
from app.services.abuse_limits import enforce_oidc_identity_rate_limit
from app.services.account_lifecycle import (
    AccountDeletionConfirmationError,
    AccountDeletionNotAllowedError,
    RecentAuthenticationRequiredError,
    delete_member_account,
)
from app.services.auth import (
    AccountCannotAuthenticateError,
    AuthenticatedSession,
    HandleUnavailableError,
    IssuedSession,
    LoginStart,
    begin_oidc_login,
    begin_oidc_reauthentication,
    issue_member_session,
    issue_reauthenticated_session,
    revoke_authenticated_session,
    update_member_profile,
    utc_now,
)
from app.services.oidc import (
    InvalidOIDCLoginError,
    OIDCClient,
    OIDCConfigurationError,
    OIDCProviderUnavailableError,
)


class AuthenticationUnavailableError(RuntimeError):
    """The configured identity provider cannot currently complete a workflow."""


class InvalidLoginWorkflowError(ValueError):
    """The callback does not identify one valid, unconsumed login transaction."""


class InvalidReturnPathError(ValueError):
    """A login workflow was asked to return to an unsafe location."""


class AuthenticationRequiredWorkflowError(ValueError):
    """The current account session cannot perform the requested auth workflow."""


class ReauthenticationFailedError(ValueError):
    """A provider-backed reauthentication failed without invalidating the session."""

    def __init__(self, return_path: str) -> None:
        super().__init__("Provider reauthentication failed.")
        self.return_path = return_path


class HandleUnavailableWorkflowError(ValueError):
    """The requested profile handle cannot be assigned."""


class RecentAuthenticationRequiredWorkflowError(ValueError):
    """The account action requires newer provider authentication evidence."""


class AccountConfirmationInvalidWorkflowError(ValueError):
    """The destructive account confirmation does not match the current account."""


@dataclass(frozen=True, slots=True)
class CompletedLogin:
    issued_session: IssuedSession
    is_reauthentication: bool


@dataclass(frozen=True, slots=True)
class ConsumedLoginTransaction:
    nonce: str
    verifier: str
    return_path: str
    purpose: str
    bound_session_id: UUID | None
    reauthentication_started_at: datetime


@dataclass(frozen=True, slots=True)
class MemberSessionSnapshot:
    authenticated: AuthenticatedSession
    can_review_ingredient_requests: bool
    can_moderate_recipe_reports: bool


def login_state_matches(flow_cookie: str | None, state_value: str) -> bool:
    """Compare bounded browser state without exposing either secret."""

    return (
        flow_cookie is not None
        and len(flow_cookie) <= 512
        and secrets_match(flow_cookie, state_value)
    )


def start_login_workflow(
    session: Session,
    *,
    settings: Settings,
    oidc_client: OIDCClient,
    return_path: str,
    force_reauthentication: bool,
) -> LoginStart:
    try:
        with session.begin():
            return begin_oidc_login(
                session,
                settings=settings,
                oidc_client=oidc_client,
                return_path=return_path,
                now=utc_now(),
                force_reauthentication=force_reauthentication,
            )
    except ValueError as error:
        raise InvalidReturnPathError("The return path is invalid.") from error
    except (OIDCConfigurationError, OIDCProviderUnavailableError) as error:
        raise AuthenticationUnavailableError("Authentication is unavailable.") from error


def start_reauthentication_workflow(
    session: Session,
    *,
    settings: Settings,
    oidc_client: OIDCClient,
    authenticated: AuthenticatedSession,
    return_path: str,
) -> LoginStart:
    try:
        login = begin_oidc_reauthentication(
            session,
            settings=settings,
            oidc_client=oidc_client,
            authenticated=authenticated,
            return_path=return_path,
            now=utc_now(),
        )
        session.commit()
        return login
    except AccountCannotAuthenticateError as error:
        session.rollback()
        raise AuthenticationRequiredWorkflowError("Authentication is required.") from error
    except ValueError as error:
        session.rollback()
        raise InvalidReturnPathError("The return path is invalid.") from error
    except (OIDCConfigurationError, OIDCProviderUnavailableError) as error:
        session.rollback()
        raise AuthenticationUnavailableError("Authentication is unavailable.") from error


def _consume_login_transaction(
    session: Session,
    *,
    state_value: str,
) -> ConsumedLoginTransaction:
    """Consume callback state and copy all secrets before deleting its row.

    Copy secrets before deleting the row so no provider call happens while the
    database transaction or row lock remains open.
    """

    now = utc_now()
    with session.begin():
        transaction = consume_oidc_login_transaction(
            session,
            state_digest=token_digest(state_value),
            now=now,
        )
        if transaction is None:
            raise InvalidLoginWorkflowError("The login transaction is invalid.")
        nonce = transaction.nonce
        verifier = transaction.pkce_verifier
        return_path = transaction.return_path
        purpose = transaction.purpose
        bound_session_id = transaction.bound_session_id
        reauthentication_started_at = transaction.created_at
        delete_oidc_login_transaction(session, transaction)
    return ConsumedLoginTransaction(
        nonce=nonce,
        verifier=verifier,
        return_path=return_path,
        purpose=purpose,
        bound_session_id=bound_session_id,
        reauthentication_started_at=reauthentication_started_at,
    )


def complete_login_workflow(
    session: Session,
    *,
    settings: Settings,
    oidc_client: OIDCClient,
    flow_cookie: str | None,
    state_value: str,
    code: str | None,
    provider_error: str | None,
) -> CompletedLogin:
    if not login_state_matches(flow_cookie, state_value):
        raise InvalidLoginWorkflowError("Browser login state does not match.")

    login = _consume_login_transaction(session, state_value=state_value)
    is_reauthentication = login.purpose == OIDC_LOGIN_PURPOSE_REAUTHENTICATE

    if provider_error is not None or code is None:
        if is_reauthentication:
            raise ReauthenticationFailedError(login.return_path)
        raise InvalidLoginWorkflowError("The provider rejected the login.")

    try:
        identity = oidc_client.exchange_code(
            code=code,
            code_verifier=login.verifier,
            expected_nonce=login.nonce,
            require_auth_time_after=(
                login.reauthentication_started_at if is_reauthentication else None
            ),
        )
        enforce_oidc_identity_rate_limit(
            session,
            settings=settings,
            issuer=identity.issuer,
            subject=identity.subject,
            now=utc_now(),
        )
        with session.begin():
            if is_reauthentication:
                if login.bound_session_id is None:
                    raise AccountCannotAuthenticateError("Account cannot authenticate.")
                issued = issue_reauthenticated_session(
                    session,
                    settings=settings,
                    identity=identity,
                    bound_session_id=login.bound_session_id,
                    return_path=login.return_path,
                    now=utc_now(),
                )
            else:
                issued = issue_member_session(
                    session,
                    settings=settings,
                    identity=identity,
                    return_path=login.return_path,
                    now=utc_now(),
                )
    except (InvalidOIDCLoginError, AccountCannotAuthenticateError) as error:
        if is_reauthentication:
            raise ReauthenticationFailedError(login.return_path) from error
        raise InvalidLoginWorkflowError("The verified login is invalid.") from error
    except (OIDCConfigurationError, OIDCProviderUnavailableError) as error:
        if is_reauthentication:
            raise ReauthenticationFailedError(login.return_path) from error
        raise AuthenticationUnavailableError("Authentication is unavailable.") from error

    return CompletedLogin(
        issued_session=issued,
        is_reauthentication=is_reauthentication,
    )


def member_session_snapshot(
    session: Session,
    authenticated: AuthenticatedSession,
) -> MemberSessionSnapshot:
    return MemberSessionSnapshot(
        authenticated=authenticated,
        can_review_ingredient_requests=(
            authenticated.handle is not None and is_catalog_curator(session, authenticated.user_id)
        ),
        can_moderate_recipe_reports=(
            authenticated.handle is not None
            and is_community_moderator(session, authenticated.user_id)
        ),
    )


def read_account_session_workflow(
    session: Session,
    authenticated: AuthenticatedSession | None,
) -> MemberSessionSnapshot | None:
    if authenticated is None:
        session.rollback()
        return None
    session.commit()
    return member_session_snapshot(session, authenticated)


def update_account_profile_workflow(
    session: Session,
    *,
    authenticated: AuthenticatedSession,
    handle: str,
    display_name: str,
    profile_description: str | None,
    update_profile_description: bool,
) -> MemberSessionSnapshot:
    try:
        updated = update_member_profile(
            session,
            authenticated=authenticated,
            handle=handle,
            display_name=display_name,
            profile_description=profile_description,
            update_profile_description=update_profile_description,
        )
        session.commit()
    except (HandleUnavailableError, IntegrityError) as error:
        session.rollback()
        raise HandleUnavailableWorkflowError("The handle is unavailable.") from error
    except AccountCannotAuthenticateError as error:
        session.rollback()
        raise AuthenticationRequiredWorkflowError("Authentication is required.") from error
    return member_session_snapshot(session, updated)


def logout_workflow(
    session: Session,
    *,
    authenticated: AuthenticatedSession,
) -> None:
    revoke_authenticated_session(
        session,
        authenticated=authenticated,
        now=utc_now(),
    )
    session.commit()


def delete_account_workflow(
    session: Session,
    *,
    settings: Settings,
    authenticated: AuthenticatedSession,
    confirmation: str,
) -> None:
    try:
        delete_member_account(
            session,
            authenticated=authenticated,
            confirmation=confirmation,
            recent_auth_ttl_seconds=settings.session.recent_ttl_seconds,
            now=utc_now(),
        )
        session.commit()
    except RecentAuthenticationRequiredError as error:
        session.rollback()
        raise RecentAuthenticationRequiredWorkflowError(
            "Recent authentication is required."
        ) from error
    except AccountDeletionConfirmationError as error:
        session.rollback()
        raise AccountConfirmationInvalidWorkflowError("Account confirmation is invalid.") from error
    except AccountDeletionNotAllowedError as error:
        session.rollback()
        raise AuthenticationRequiredWorkflowError("Authentication is required.") from error
