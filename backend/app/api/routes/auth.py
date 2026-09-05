from datetime import datetime
from typing import Annotated
from urllib.parse import urlencode

from fastapi import APIRouter, Query, Request, Response, status
from fastapi.responses import RedirectResponse

from app.api.dependencies import (
    CsrfProtectedSessionDependency,
    CsrfProtectedUntouchedSessionDependency,
    OIDCClientDependency,
    OptionalAuthenticatedSessionDependency,
    RequiredAuthenticatedSessionDependency,
    SessionDependency,
    SettingsDependency,
)
from app.api.errors import ApiError
from app.core.security import (
    AUTH_CSRF_COOKIE_NAME,
    AUTH_FORCE_LOGIN_COOKIE_NAME,
    AUTH_LOGIN_COOKIE_NAME,
    AUTH_SESSION_COOKIE_NAME,
)
from app.schemas.auth import (
    AccountCapabilitiesResponse,
    AccountDeletionRequest,
    AccountProfileUpdateRequest,
    AccountSessionResponse,
    AccountUserResponse,
    AnonymousSessionResponse,
    MemberSessionResponse,
)
from app.schemas.errors import ErrorResponse
from app.services.auth_workflows import (
    AccountConfirmationInvalidWorkflowError,
    AuthenticationRequiredWorkflowError,
    AuthenticationUnavailableError,
    HandleUnavailableWorkflowError,
    InvalidLoginWorkflowError,
    InvalidReturnPathError,
    MemberSessionSnapshot,
    ReauthenticationFailedError,
    RecentAuthenticationRequiredWorkflowError,
    complete_login_workflow,
    delete_account_workflow,
    logout_workflow,
    read_account_session_workflow,
    start_login_workflow,
    start_reauthentication_workflow,
    update_account_profile_workflow,
)

router = APIRouter(prefix="/auth")

AUTH_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    400: {"model": ErrorResponse, "description": "The authentication request is invalid."},
    401: {"model": ErrorResponse, "description": "Authentication is required."},
    403: {"model": ErrorResponse, "description": "CSRF or Origin evidence is invalid."},
    409: {"model": ErrorResponse, "description": "The selected handle is unavailable."},
    429: {"model": ErrorResponse, "description": "The authentication rate limit was exceeded."},
    422: {"model": ErrorResponse, "description": "The request parameters are invalid."},
    503: {"model": ErrorResponse, "description": "Authentication is unavailable."},
}


def _auth_unavailable(error: Exception) -> ApiError:
    return ApiError(
        status_code=503,
        code="authentication_unavailable",
        message="Sign-in is temporarily unavailable. Please try again.",
    )


def _invalid_login(error: Exception | None = None) -> ApiError:
    return ApiError(
        status_code=400,
        code="invalid_login",
        message="The sign-in attempt is invalid or has expired. Please start again.",
    )


def _member_response(
    snapshot: MemberSessionSnapshot,
) -> MemberSessionResponse:
    authenticated = snapshot.authenticated
    return MemberSessionResponse(
        status="authenticated" if authenticated.handle is not None else "onboarding_required",
        user=AccountUserResponse(
            id=authenticated.user_id,
            handle=authenticated.handle,
            display_name=authenticated.display_name,
            description=authenticated.profile_description,
        ),
        capabilities=AccountCapabilitiesResponse(
            review_ingredient_requests=snapshot.can_review_ingredient_requests,
            moderate_recipe_reports=snapshot.can_moderate_recipe_reports,
        ),
    )


def _set_no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


def _set_session_cookies(
    response: Response,
    *,
    settings: SettingsDependency,
    session_token: str,
    csrf_token: str,
    expires_at: datetime,
) -> None:
    response.set_cookie(
        AUTH_SESSION_COOKIE_NAME,
        session_token,
        httponly=True,
        secure=settings.session.cookie_secure,
        samesite="lax",
        path="/",
        max_age=settings.session.ttl_seconds,
        expires=expires_at,
    )
    response.set_cookie(
        AUTH_CSRF_COOKIE_NAME,
        csrf_token,
        httponly=False,
        secure=settings.session.cookie_secure,
        samesite="lax",
        path="/",
        max_age=settings.session.ttl_seconds,
        expires=expires_at,
    )


def _clear_auth_cookies(response: Response, settings: SettingsDependency) -> None:
    response.delete_cookie(
        AUTH_SESSION_COOKIE_NAME,
        path="/",
        secure=settings.session.cookie_secure,
        httponly=True,
        samesite="lax",
    )
    response.delete_cookie(
        AUTH_CSRF_COOKIE_NAME,
        path="/",
        secure=settings.session.cookie_secure,
        httponly=False,
        samesite="lax",
    )


def _require_fresh_login_after_sign_out(
    response: Response,
    settings: SettingsDependency,
) -> None:
    response.set_cookie(
        AUTH_FORCE_LOGIN_COOKIE_NAME,
        "1",
        max_age=settings.session.ttl_seconds,
        secure=settings.session.cookie_secure,
        httponly=True,
        samesite="lax",
        path="/api/auth/login",
    )


def _clear_fresh_login_requirement(
    response: Response,
    settings: SettingsDependency,
) -> None:
    response.delete_cookie(
        AUTH_FORCE_LOGIN_COOKIE_NAME,
        path="/api/auth/login",
        secure=settings.session.cookie_secure,
        httponly=True,
        samesite="lax",
    )


def _reauthentication_failure_redirect(
    *,
    settings: SettingsDependency,
    return_path: str,
) -> RedirectResponse:
    response = RedirectResponse(
        "/auth/callback?"
        + urlencode(
            {
                "error": "reauthentication_failed",
                "return_to": return_path,
            }
        ),
        status_code=status.HTTP_303_SEE_OTHER,
    )
    response.delete_cookie(
        AUTH_LOGIN_COOKIE_NAME,
        path="/api/auth/callback",
        secure=settings.session.cookie_secure,
        httponly=True,
        samesite="lax",
    )
    response.headers["Referrer-Policy"] = "no-referrer"
    _set_no_store(response)
    return response


@router.get(
    "/login",
    response_class=RedirectResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Start a secure OpenID Connect login",
)
def start_login(
    request: Request,
    session: SessionDependency,
    settings: SettingsDependency,
    oidc_client: OIDCClientDependency,
    return_to: Annotated[
        str,
        Query(min_length=1, max_length=2048, description="Local path to return to after login."),
    ] = "/",
) -> RedirectResponse:
    force_reauthentication = request.cookies.get(AUTH_FORCE_LOGIN_COOKIE_NAME) == "1"
    try:
        login = start_login_workflow(
            session,
            settings=settings,
            oidc_client=oidc_client,
            return_path=return_to,
            force_reauthentication=force_reauthentication,
        )
    except InvalidReturnPathError as error:
        raise ApiError(
            status_code=422,
            code="invalid_return_path",
            message="The return path is invalid.",
        ) from error
    except AuthenticationUnavailableError as error:
        raise _auth_unavailable(error) from error

    response = RedirectResponse(
        login.authorization_url,
        status_code=status.HTTP_307_TEMPORARY_REDIRECT,
    )
    response.set_cookie(
        AUTH_LOGIN_COOKIE_NAME,
        login.state,
        max_age=settings.oidc.login_ttl_seconds,
        secure=settings.session.cookie_secure,
        httponly=True,
        samesite="lax",
        path="/api/auth/callback",
    )
    _clear_fresh_login_requirement(response, settings)
    response.headers["Referrer-Policy"] = "no-referrer"
    _set_no_store(response)
    return response


@router.get(
    "/reauthenticate",
    response_class=RedirectResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Reauthenticate before a sensitive account action",
)
def start_reauthentication(
    session: SessionDependency,
    settings: SettingsDependency,
    oidc_client: OIDCClientDependency,
    authenticated: RequiredAuthenticatedSessionDependency,
    return_to: Annotated[
        str,
        Query(min_length=1, max_length=2048, description="Local path to return to."),
    ] = "/account",
) -> RedirectResponse:
    try:
        login = start_reauthentication_workflow(
            session,
            settings=settings,
            oidc_client=oidc_client,
            authenticated=authenticated,
            return_path=return_to,
        )
    except AuthenticationRequiredWorkflowError as error:
        raise ApiError(
            status_code=401,
            code="authentication_required",
            message="Sign in to continue.",
        ) from error
    except InvalidReturnPathError as error:
        raise ApiError(
            status_code=422,
            code="invalid_return_path",
            message="The return path is invalid.",
        ) from error
    except AuthenticationUnavailableError as error:
        raise _auth_unavailable(error) from error

    response = RedirectResponse(
        login.authorization_url,
        status_code=status.HTTP_307_TEMPORARY_REDIRECT,
    )
    response.set_cookie(
        AUTH_LOGIN_COOKIE_NAME,
        login.state,
        max_age=settings.oidc.login_ttl_seconds,
        secure=settings.session.cookie_secure,
        httponly=True,
        samesite="lax",
        path="/api/auth/callback",
    )
    response.headers["Referrer-Policy"] = "no-referrer"
    _set_no_store(response)
    return response


@router.get(
    "/callback",
    response_class=RedirectResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Complete a secure OpenID Connect login",
)
def complete_login(
    request: Request,
    session: SessionDependency,
    settings: SettingsDependency,
    oidc_client: OIDCClientDependency,
    state_value: Annotated[str, Query(alias="state", min_length=16, max_length=512)],
    code: Annotated[str | None, Query(min_length=1, max_length=4096)] = None,
    provider_error: Annotated[str | None, Query(alias="error", max_length=256)] = None,
) -> RedirectResponse:
    try:
        completed = complete_login_workflow(
            session,
            settings=settings,
            oidc_client=oidc_client,
            flow_cookie=request.cookies.get(AUTH_LOGIN_COOKIE_NAME),
            state_value=state_value,
            code=code,
            provider_error=provider_error,
        )
    except ReauthenticationFailedError as error:
        return _reauthentication_failure_redirect(
            settings=settings,
            return_path=error.return_path,
        )
    except InvalidLoginWorkflowError as error:
        raise _invalid_login(error) from error
    except AuthenticationUnavailableError as error:
        raise _auth_unavailable(error) from error

    issued = completed.issued_session
    redirect_target = issued.return_path
    if not completed.is_reauthentication and issued.user.handle is None:
        redirect_target = f"/onboarding?{urlencode({'return_to': issued.return_path})}"
    response = RedirectResponse(redirect_target, status_code=status.HTTP_303_SEE_OTHER)
    _set_session_cookies(
        response,
        settings=settings,
        session_token=issued.session_token,
        csrf_token=issued.csrf_token,
        expires_at=issued.expires_at,
    )
    response.delete_cookie(
        AUTH_LOGIN_COOKIE_NAME,
        path="/api/auth/callback",
        secure=settings.session.cookie_secure,
        httponly=True,
        samesite="lax",
    )
    response.headers["Referrer-Policy"] = "no-referrer"
    _set_no_store(response)
    return response


@router.get(
    "/session",
    response_model=AccountSessionResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Read the current account session",
)
def account_session(
    request: Request,
    response: Response,
    session: SessionDependency,
    settings: SettingsDependency,
    authenticated: OptionalAuthenticatedSessionDependency,
) -> AnonymousSessionResponse | MemberSessionResponse:
    _set_no_store(response)
    snapshot = read_account_session_workflow(session, authenticated)
    if snapshot is None:
        if AUTH_SESSION_COOKIE_NAME in request.cookies or AUTH_CSRF_COOKIE_NAME in request.cookies:
            _clear_auth_cookies(response, settings)
        return AnonymousSessionResponse()
    return _member_response(snapshot)


@router.patch(
    "/session/profile",
    response_model=MemberSessionResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Update the account profile",
)
def update_account_profile(
    payload: AccountProfileUpdateRequest,
    response: Response,
    session: SessionDependency,
    authenticated: CsrfProtectedSessionDependency,
) -> MemberSessionResponse:
    try:
        updated = update_account_profile_workflow(
            session,
            authenticated=authenticated,
            handle=payload.handle,
            display_name=payload.display_name,
            profile_description=payload.description,
            update_profile_description="description" in payload.model_fields_set,
        )
    except HandleUnavailableWorkflowError as error:
        raise ApiError(
            status_code=409,
            code="handle_unavailable",
            message="That handle is unavailable.",
        ) from error
    except AuthenticationRequiredWorkflowError as error:
        raise ApiError(
            status_code=401,
            code="authentication_required",
            message="Sign in to continue.",
        ) from error
    _set_no_store(response)
    return _member_response(updated)


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    responses=AUTH_ERROR_RESPONSES,
    summary="Revoke the current account session",
)
def logout(
    session: SessionDependency,
    settings: SettingsDependency,
    authenticated: CsrfProtectedSessionDependency,
) -> Response:
    logout_workflow(session, authenticated=authenticated)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    _clear_auth_cookies(response, settings)
    _require_fresh_login_after_sign_out(response, settings)
    _set_no_store(response)
    return response


@router.delete(
    "/account",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    responses=AUTH_ERROR_RESPONSES,
    summary="Delete the current member account",
    description=(
        "Requires recent provider authentication and the exact current handle, or DELETE before "
        "onboarding, as confirmation. Private account data is erased while published recipe "
        "topology remains attributed to Deleted cook."
    ),
)
def delete_account(
    payload: AccountDeletionRequest,
    session: SessionDependency,
    settings: SettingsDependency,
    authenticated: CsrfProtectedUntouchedSessionDependency,
) -> Response:
    try:
        delete_account_workflow(
            session,
            settings=settings,
            authenticated=authenticated,
            confirmation=payload.confirmation,
        )
    except RecentAuthenticationRequiredWorkflowError as error:
        raise ApiError(
            status_code=403,
            code="recent_authentication_required",
            message="Sign in again before deleting your account.",
        ) from error
    except AccountConfirmationInvalidWorkflowError as error:
        raise ApiError(
            status_code=400,
            code="account_confirmation_invalid",
            message="Type the current account confirmation phrase exactly.",
        ) from error
    except AuthenticationRequiredWorkflowError as error:
        raise ApiError(
            status_code=401,
            code="authentication_required",
            message="Sign in to continue.",
        ) from error

    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    _clear_auth_cookies(response, settings)
    _set_no_store(response)
    return response
