from collections.abc import Iterator
from dataclasses import dataclass
from urllib.parse import parse_qs, urlencode, urlsplit

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import Engine, delete, func, select
from sqlalchemy.orm import Session

from app.api.dependencies import get_oidc_client, get_session
from app.core.config import Settings, get_settings
from app.core.security import AUTH_CSRF_COOKIE_NAME, token_digest
from app.main import create_app
from app.models import OIDCIdentity, OIDCLoginTransaction, User, UserSession
from app.services.oidc import InvalidOIDCLoginError, VerifiedOIDCIdentity


class FakeOIDCClient:
    def __init__(self) -> None:
        self.exchange_calls = 0

    def build_authorization_url(
        self,
        *,
        state: str,
        nonce: str,
        code_challenge: str,
    ) -> str:
        return "https://identity.example.test/authorize?" + urlencode(
            {
                "state": state,
                "nonce": nonce,
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
            }
        )

    def exchange_code(
        self,
        *,
        code: str,
        code_verifier: str,
        expected_nonce: str,
    ) -> VerifiedOIDCIdentity:
        self.exchange_calls += 1
        assert 43 <= len(code_verifier) <= 128
        assert len(expected_nonce) >= 43
        if code != "valid-code":
            raise InvalidOIDCLoginError("Provider detail that must not be exposed.")
        return VerifiedOIDCIdentity(
            issuer="https://identity.example.test",
            subject="member-subject-123",
            email="member@example.test",
            email_verified=True,
            suggested_display_name="Member Cook",
        )


@dataclass(frozen=True, slots=True)
class AuthApi:
    client: TestClient
    engine: Engine
    oidc: FakeOIDCClient
    settings: Settings


def _clear_member_auth(engine: Engine) -> None:
    with Session(bind=engine) as session, session.begin():
        session.execute(delete(UserSession))
        session.execute(delete(OIDCIdentity))
        session.execute(delete(OIDCLoginTransaction))
        session.execute(delete(User).where(User.account_kind == "member"))


@pytest.fixture
def auth_api(migrated_engine: Engine) -> Iterator[AuthApi]:
    _clear_member_auth(migrated_engine)
    application = create_app()
    settings = Settings.model_validate(
        {
            "app_environment": "local",
            "auth_allowed_origins": "http://app.example.test",
            "auth_session_ttl_seconds": 3600,
            "oidc_issuer": "https://identity.example.test",
            "oidc_client_id": "recipe-lab-test",
            # Deliberately browser-facing, not TestClient's backend base URL.
            "oidc_redirect_uri": "http://app.example.test/api/auth/callback",
        }
    )
    fake_oidc = FakeOIDCClient()

    def override_session() -> Iterator[Session]:
        with Session(bind=migrated_engine, expire_on_commit=False) as session:
            yield session

    application.dependency_overrides[get_session] = override_session
    application.dependency_overrides[get_settings] = lambda: settings
    application.dependency_overrides[get_oidc_client] = lambda: fake_oidc
    try:
        with TestClient(application, base_url="https://internal-backend.test") as client:
            yield AuthApi(
                client=client,
                engine=migrated_engine,
                oidc=fake_oidc,
                settings=settings,
            )
    finally:
        application.dependency_overrides.clear()
        _clear_member_auth(migrated_engine)


def _start_login(auth_api: AuthApi, *, return_to: str = "/recipes") -> str:
    response: Response = auth_api.client.get(
        "/api/auth/login",
        params={"return_to": return_to},
        follow_redirects=False,
    )
    assert response.status_code == 307
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["referrer-policy"] == "no-referrer"
    state = str(parse_qs(urlsplit(response.headers["location"]).query)["state"][0])
    assert state not in response.text
    return state


def _complete_login(auth_api: AuthApi, state: str) -> Response:
    response: Response = auth_api.client.get(
        "/api/auth/callback",
        params={"state": state, "code": "valid-code"},
        follow_redirects=False,
    )
    return response


def test_proxy_callback_creates_one_member_and_routes_first_login_to_onboarding(
    auth_api: AuthApi,
) -> None:
    state = _start_login(auth_api, return_to="/recipes?type=originals")
    callback = _complete_login(auth_api, state)

    assert callback.status_code == 303
    assert callback.headers["location"] == ("/onboarding?return_to=%2Frecipes%3Ftype%3Doriginals")
    assert auth_api.oidc.exchange_calls == 1
    cookies = callback.headers.get_list("set-cookie")
    session_cookie = next(value for value in cookies if value.startswith("recipe_lab_session="))
    csrf_cookie = next(value for value in cookies if value.startswith("recipe_lab_csrf="))
    assert "HttpOnly" in session_cookie
    assert "SameSite=lax" in session_cookie
    assert "Secure" not in session_cookie
    assert "HttpOnly" not in csrf_cookie
    assert "SameSite=lax" in csrf_cookie

    with Session(bind=auth_api.engine) as session:
        assert session.scalar(select(func.count()).select_from(User)) == 1
        assert session.scalar(select(func.count()).select_from(OIDCIdentity)) == 1
        assert session.scalar(select(func.count()).select_from(OIDCLoginTransaction)) == 0
        stored = session.scalar(select(UserSession))
        assert stored is not None
        raw_session = auth_api.client.cookies.get("recipe_lab_session")
        raw_csrf = auth_api.client.cookies.get(AUTH_CSRF_COOKIE_NAME)
        assert raw_session is not None
        assert raw_csrf is not None
        assert stored.token_digest == token_digest(raw_session)
        assert stored.csrf_token_digest == token_digest(raw_csrf)
        assert raw_session not in repr(stored)
        assert raw_csrf not in repr(stored)

    session_response = auth_api.client.get("/api/auth/session")
    assert session_response.status_code == 200
    assert session_response.json()["status"] == "onboarding_required"
    assert set(session_response.json()["user"]) == {"id", "handle", "display_name"}
    assert session_response.json()["capabilities"] == {"review_ingredient_requests": False}
    assert "email" not in session_response.text
    assert "member-subject-123" not in session_response.text


def test_onboarding_requires_origin_and_session_bound_csrf_then_logout_revokes(
    auth_api: AuthApi,
) -> None:
    state = _start_login(auth_api)
    callback = _complete_login(auth_api, state)
    assert callback.status_code == 303
    csrf = auth_api.client.cookies.get(AUTH_CSRF_COOKIE_NAME)
    assert csrf is not None
    profile = {"handle": "test-cook", "display_name": "Test Cook"}

    missing_origin = auth_api.client.patch(
        "/api/auth/session/profile",
        json=profile,
        headers={"X-CSRF-Token": csrf},
    )
    wrong_csrf = auth_api.client.patch(
        "/api/auth/session/profile",
        json=profile,
        headers={"Origin": "http://app.example.test", "X-CSRF-Token": "wrong"},
    )
    assert missing_origin.status_code == 403
    assert wrong_csrf.status_code == 403
    assert missing_origin.json()["error"]["code"] == "invalid_csrf"

    updated = auth_api.client.patch(
        "/api/auth/session/profile",
        json=profile,
        headers={"Origin": "http://app.example.test", "X-CSRF-Token": csrf},
    )
    assert updated.status_code == 200
    assert updated.json() == {
        "status": "authenticated",
        "user": {
            "id": updated.json()["user"]["id"],
            "handle": "test-cook",
            "display_name": "Test Cook",
        },
        "capabilities": {"review_ingredient_requests": False},
    }

    logout = auth_api.client.post(
        "/api/auth/logout",
        headers={"Origin": "http://app.example.test", "X-CSRF-Token": csrf},
    )
    assert logout.status_code == 204
    with Session(bind=auth_api.engine) as session:
        stored = session.scalar(select(UserSession))
        assert stored is not None
        assert stored.revoked_at is not None
    assert auth_api.client.get("/api/auth/session").json() == {"status": "anonymous"}


def test_existing_onboarded_member_returns_directly_to_validated_path(auth_api: AuthApi) -> None:
    first_state = _start_login(auth_api, return_to="/recipes")
    first_callback = _complete_login(auth_api, first_state)
    assert first_callback.status_code == 303
    csrf = auth_api.client.cookies.get(AUTH_CSRF_COOKIE_NAME)
    assert csrf is not None
    profile = auth_api.client.patch(
        "/api/auth/session/profile",
        json={"handle": "returning-cook", "display_name": "Returning Cook"},
        headers={"Origin": "http://app.example.test", "X-CSRF-Token": csrf},
    )
    assert profile.status_code == 200

    second_state = _start_login(auth_api, return_to="/account?tab=saved")
    second_callback = _complete_login(auth_api, second_state)
    assert second_callback.status_code == 303
    assert second_callback.headers["location"] == "/account?tab=saved"
    with Session(bind=auth_api.engine) as session:
        assert session.scalar(select(func.count()).select_from(User)) == 1
        assert session.scalar(select(func.count()).select_from(OIDCIdentity)) == 1


def test_provider_error_consumes_state_and_redacts_details(auth_api: AuthApi) -> None:
    state = _start_login(auth_api)
    provider_error = auth_api.client.get(
        "/api/auth/callback",
        params={
            "state": state,
            "error": "access_denied",
            "error_description": "private provider detail",
        },
        follow_redirects=False,
    )
    replay = _complete_login(auth_api, state)

    assert provider_error.status_code == 400
    assert replay.status_code == 400
    for response in (provider_error, replay):
        assert response.json()["error"]["code"] == "invalid_login"
        assert "access_denied" not in response.text
        assert "private provider detail" not in response.text
        assert state not in response.text
    assert auth_api.oidc.exchange_calls == 0
    with Session(bind=auth_api.engine) as session:
        assert session.scalar(select(func.count()).select_from(UserSession)) == 0
        assert session.scalar(select(func.count()).select_from(User)) == 0
        assert session.scalar(select(func.count()).select_from(OIDCLoginTransaction)) == 0


def test_mismatched_browser_state_cannot_consume_real_login_or_create_session(
    auth_api: AuthApi,
) -> None:
    state = _start_login(auth_api)
    mismatch = auth_api.client.get(
        "/api/auth/callback",
        params={"state": "x" * 43, "code": "valid-code"},
        follow_redirects=False,
    )
    assert mismatch.status_code == 400
    assert auth_api.oidc.exchange_calls == 0

    valid = _complete_login(auth_api, state)
    assert valid.status_code == 303
    assert auth_api.oidc.exchange_calls == 1


def test_non_local_auth_cookies_are_secure(auth_api: AuthApi) -> None:
    auth_api.settings.app_environment = "test"
    login = auth_api.client.get("/api/auth/login", follow_redirects=False)
    assert login.status_code == 307
    assert "Secure" in login.headers["set-cookie"]
    state = parse_qs(urlsplit(login.headers["location"]).query)["state"][0]

    callback = _complete_login(auth_api, state)
    assert callback.status_code == 303
    cookies = callback.headers.get_list("set-cookie")
    assert "Secure" in next(value for value in cookies if value.startswith("recipe_lab_session="))
    assert "Secure" in next(value for value in cookies if value.startswith("recipe_lab_csrf="))
