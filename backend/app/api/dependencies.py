from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy.orm import Session

from app.api.errors import ApiError
from app.core.config import Settings, get_settings
from app.core.security import (
    AUTH_CSRF_COOKIE_NAME,
    AUTH_SESSION_COOKIE_NAME,
    normalize_origin,
    secrets_match,
    token_digest,
)
from app.db.session import SessionLocal
from app.services.auth import AuthenticatedSession, resolve_authenticated_session, utc_now
from app.services.oidc import OIDCClient


def get_session() -> Iterator[Session]:
    """Provide one request-scoped database session."""

    with SessionLocal() as session:
        yield session


SessionDependency = Annotated[Session, Depends(get_session)]
SettingsDependency = Annotated[Settings, Depends(get_settings)]


def get_oidc_client(settings: SettingsDependency) -> Iterator[OIDCClient]:
    with OIDCClient(settings) as client:
        yield client


OIDCClientDependency = Annotated[OIDCClient, Depends(get_oidc_client)]


def get_optional_authenticated_session(
    request: Request,
    session: SessionDependency,
    settings: SettingsDependency,
) -> AuthenticatedSession | None:
    raw_session_token = request.cookies.get(AUTH_SESSION_COOKIE_NAME)
    if raw_session_token is None:
        return None
    return resolve_authenticated_session(
        session,
        raw_session_token=raw_session_token,
        now=utc_now(),
    )


OptionalAuthenticatedSessionDependency = Annotated[
    AuthenticatedSession | None,
    Depends(get_optional_authenticated_session),
]


def get_optional_untouched_authenticated_session(
    request: Request,
    session: SessionDependency,
) -> AuthenticatedSession | None:
    """Resolve sensitive lifecycle requests without locking the session row early."""

    raw_session_token = request.cookies.get(AUTH_SESSION_COOKIE_NAME)
    if raw_session_token is None:
        return None
    return resolve_authenticated_session(
        session,
        raw_session_token=raw_session_token,
        now=utc_now(),
        touch=False,
    )


OptionalUntouchedAuthenticatedSessionDependency = Annotated[
    AuthenticatedSession | None,
    Depends(get_optional_untouched_authenticated_session),
]


def get_required_authenticated_session(
    authenticated: OptionalAuthenticatedSessionDependency,
) -> AuthenticatedSession:
    if authenticated is None:
        raise ApiError(
            status_code=401,
            code="authentication_required",
            message="Sign in to continue.",
        )
    return authenticated


RequiredAuthenticatedSessionDependency = Annotated[
    AuthenticatedSession,
    Depends(get_required_authenticated_session),
]


def get_required_untouched_authenticated_session(
    authenticated: OptionalUntouchedAuthenticatedSessionDependency,
) -> AuthenticatedSession:
    if authenticated is None:
        raise ApiError(
            status_code=401,
            code="authentication_required",
            message="Sign in to continue.",
        )
    return authenticated


RequiredUntouchedAuthenticatedSessionDependency = Annotated[
    AuthenticatedSession,
    Depends(get_required_untouched_authenticated_session),
]


def _validate_csrf(
    request: Request,
    authenticated: AuthenticatedSession,
    settings: Settings,
    csrf_header: str | None,
) -> AuthenticatedSession:
    """Validate same-origin and session-bound double-submit evidence."""

    raw_csrf_cookie = request.cookies.get(AUTH_CSRF_COOKIE_NAME)
    origin = request.headers.get("origin")
    fetch_site = request.headers.get("sec-fetch-site")
    allowed_origins: set[str] = set()
    try:
        normalized_origin = normalize_origin(origin) if origin is not None else None
        allowed_origins = {normalize_origin(value) for value in settings.auth_allowed_origin_list}
    except ValueError:
        normalized_origin = None

    valid = (
        normalized_origin is not None
        and normalized_origin in allowed_origins
        and (fetch_site is None or fetch_site.casefold() != "cross-site")
        and csrf_header is not None
        and raw_csrf_cookie is not None
        and len(csrf_header) <= 512
        and len(raw_csrf_cookie) <= 512
        and secrets_match(csrf_header, raw_csrf_cookie)
        and secrets_match(token_digest(csrf_header), authenticated.csrf_token_digest)
    )
    if not valid:
        raise ApiError(
            status_code=403,
            code="invalid_csrf",
            message="The request could not be verified.",
        )
    return authenticated


def require_valid_csrf(
    request: Request,
    authenticated: RequiredAuthenticatedSessionDependency,
    settings: SettingsDependency,
    csrf_header: Annotated[str | None, Header(alias="X-CSRF-Token")] = None,
) -> AuthenticatedSession:
    """Require same-origin evidence and a session-bound double-submit token."""

    return _validate_csrf(request, authenticated, settings, csrf_header)


CsrfProtectedSessionDependency = Annotated[
    AuthenticatedSession,
    Depends(require_valid_csrf),
]


def require_valid_csrf_without_touch(
    request: Request,
    authenticated: RequiredUntouchedAuthenticatedSessionDependency,
    settings: SettingsDependency,
    csrf_header: Annotated[str | None, Header(alias="X-CSRF-Token")] = None,
) -> AuthenticatedSession:
    """Validate CSRF without taking a session lock before lifecycle ordering."""

    return _validate_csrf(request, authenticated, settings, csrf_header)


CsrfProtectedUntouchedSessionDependency = Annotated[
    AuthenticatedSession,
    Depends(require_valid_csrf_without_touch),
]
