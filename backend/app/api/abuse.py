from fastapi import Request

from app.api.dependencies import SessionDependency, SettingsDependency
from app.core.security import AUTH_SESSION_COOKIE_NAME
from app.policies.abuse import classify_rate_limited_request
from app.services.abuse_limits import client_network_subject, enforce_request_rate_limit
from app.services.auth import resolve_authenticated_session, utc_now


def enforce_abuse_rate_limits(
    request: Request,
    session: SessionDependency,
    settings: SettingsDependency,
) -> None:
    policy = classify_rate_limited_request(
        method=request.method,
        path=request.url.path,
        settings=settings,
    )
    if policy is None:
        return

    now = utc_now()
    raw_session_token = request.cookies.get(AUTH_SESSION_COOKIE_NAME)
    authenticated = (
        resolve_authenticated_session(
            session,
            raw_session_token=raw_session_token,
            now=now,
            touch=False,
        )
        if raw_session_token is not None
        else None
    )
    enforce_request_rate_limit(
        session,
        settings=settings,
        policy=policy,
        client_host=client_network_subject(
            request.headers,
            settings=settings,
            method=request.method,
            path=request.url.path,
            direct_client_host=request.client.host if request.client is not None else None,
            now=now,
        ),
        account_user_id=authenticated.user_id if authenticated is not None else None,
        now=now,
    )
