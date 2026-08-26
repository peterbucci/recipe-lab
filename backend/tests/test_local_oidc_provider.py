import hashlib
import re
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlencode, urlsplit

import jwt
import pytest
from fastapi.testclient import TestClient
from pytest import MonkeyPatch

from app.core.config import Settings
from app.services.oidc import OIDCClient
from app.testing.local_oidc_provider import (
    LOCAL_IDENTITIES,
    LocalOIDCProviderConfig,
    LocalOIDCProviderError,
    config_from_environment,
    create_provider_app,
    main,
)

ISSUER = "http://127.0.0.1:8200"
CLIENT_ID = "recipe-lab-rcp32"
REDIRECT_URI = "http://127.0.0.1:3000/api/auth/callback"
REDIRECT_ORIGIN = "http://127.0.0.1:3000"
STATE = "state-value-that-is-long-enough-123"
NONCE = "nonce-value-that-is-long-enough-123"
VERIFIER = "verifier-that-is-long-enough-for-pkce-12345678901234567890"


def provider_config() -> LocalOIDCProviderConfig:
    return LocalOIDCProviderConfig(
        issuer=ISSUER,
        client_id=CLIENT_ID,
        redirect_uri=REDIRECT_URI,
    )


def guarded_environment(**overrides: str) -> dict[str, str]:
    environment = {
        "RCP32_ACCEPTANCE": "1",
        "ACCEPTANCE_DATABASE_ISOLATED": "1",
        "APP_ENVIRONMENT": "local",
        "OIDC_ISSUER": ISSUER,
        "OIDC_CLIENT_ID": CLIENT_ID,
        "OIDC_REDIRECT_URI": REDIRECT_URI,
    }
    environment.update(overrides)
    return environment


def challenge(verifier: str = VERIFIER) -> str:
    return jwt.utils.base64url_encode(hashlib.sha256(verifier.encode("ascii")).digest()).decode(
        "ascii"
    )


def authorization_parameters(**overrides: str) -> dict[str, str]:
    parameters = {
        "response_type": "code",
        "response_mode": "query",
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": "openid email profile",
        "state": STATE,
        "nonce": NONCE,
        "code_challenge": challenge(),
        "code_challenge_method": "S256",
    }
    parameters.update(overrides)
    return parameters


def begin_and_approve(
    client: TestClient,
    *,
    identity: str = "alice",
    **authorization_overrides: str,
) -> tuple[str, str]:
    authorize = client.get("/authorize", params=authorization_parameters(**authorization_overrides))
    assert authorize.status_code == 200
    request_match = re.search(r'name="request_id" value="([A-Za-z0-9_-]+)"', authorize.text)
    assert request_match is not None
    approved = client.post(
        "/authorize",
        data={"request_id": request_match.group(1), "identity": identity},
        follow_redirects=False,
    )
    assert approved.status_code == 303
    location = approved.headers["location"]
    query = parse_qs(urlsplit(location).query)
    return query["code"][0], location


def token_form(code: str, *, verifier: str = VERIFIER) -> dict[str, str]:
    return {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "code_verifier": verifier,
    }


def test_discovery_jwks_and_accessible_authorize_page_disclose_no_identity_data() -> None:
    application = create_provider_app(provider_config())

    with TestClient(application) as client:
        discovery = client.get("/.well-known/openid-configuration")
        jwks = client.get("/jwks")
        authorize = client.get("/authorize", params=authorization_parameters())

    assert discovery.status_code == 200
    assert discovery.json() == {
        "issuer": ISSUER,
        "authorization_endpoint": f"{ISSUER}/authorize",
        "token_endpoint": f"{ISSUER}/token",
        "jwks_uri": f"{ISSUER}/jwks",
        "response_types_supported": ["code"],
        "response_modes_supported": ["query"],
        "grant_types_supported": ["authorization_code"],
        "token_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": ["openid", "email", "profile"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["RS256"],
        "code_challenge_methods_supported": ["S256"],
    }
    assert jwks.status_code == 200
    published_key = jwks.json()["keys"][0]
    assert published_key["alg"] == "RS256"
    assert published_key["kty"] == "RSA"
    assert published_key["use"] == "sig"
    assert set(published_key) >= {"alg", "e", "kid", "kty", "n", "use"}
    assert authorize.status_code == 200
    assert '<html lang="en">' in authorize.text
    assert '<main aria-labelledby="provider-heading">' in authorize.text
    for identity in LOCAL_IDENTITIES:
        assert f"Continue as {identity.display_name}" in authorize.text
        assert identity.email not in authorize.text
        assert identity.subject not in authorize.text
    assert authorize.headers["cache-control"] == "no-store"
    content_security_policy = authorize.headers["content-security-policy"]
    assert content_security_policy == (
        "default-src 'none'; "
        f"form-action 'self' {REDIRECT_ORIGIN}; "
        "style-src 'none'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    )
    assert REDIRECT_URI not in content_security_policy
    assert "/api/auth/callback" not in content_security_policy
    assert "?" not in content_security_policy
    for identity in LOCAL_IDENTITIES:
        assert identity.email not in content_security_policy
        assert identity.subject not in content_security_policy


def test_authorization_code_flow_signs_expected_verified_identity_claims() -> None:
    now = datetime(2026, 8, 26, 18, 0, tzinfo=UTC)
    application = create_provider_app(provider_config(), clock=lambda: now)

    with TestClient(application) as client:
        code, location = begin_and_approve(client, identity="alice")
        response = client.post("/token", data=token_form(code))
        jwk = client.get("/jwks").json()["keys"][0]

    assert location.startswith(f"{REDIRECT_URI}?")
    assert parse_qs(urlsplit(location).query)["state"] == [STATE]
    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {"expires_in", "id_token", "token_type"}
    assert payload["token_type"] == "Bearer"
    claims = jwt.decode(
        payload["id_token"],
        key=jwt.PyJWK.from_dict(jwk, algorithm="RS256").key,
        algorithms=["RS256"],
        audience=CLIENT_ID,
        issuer=ISSUER,
        options={"verify_exp": False, "verify_iat": False},
    )
    alice = next(identity for identity in LOCAL_IDENTITIES if identity.key == "alice")
    assert claims == {
        "iss": ISSUER,
        "sub": alice.subject,
        "aud": CLIENT_ID,
        "exp": int((now + timedelta(minutes=5)).timestamp()),
        "iat": int(now.timestamp()),
        "auth_time": int(now.timestamp()),
        "nonce": NONCE,
        "email": alice.email,
        "email_verified": True,
        "name": alice.display_name,
    }


def test_recipe_lab_oidc_client_completes_the_provider_flow() -> None:
    application = create_provider_app(provider_config())
    settings = Settings.model_validate(
        {
            "app_environment": "local",
            "oidc_issuer": ISSUER,
            "oidc_client_id": CLIENT_ID,
            "oidc_redirect_uri": REDIRECT_URI,
        }
    )

    with TestClient(application, base_url=ISSUER) as provider_http:
        oidc_client = OIDCClient(settings, http_client=provider_http)
        authorization_url = oidc_client.build_authorization_url(
            state=STATE,
            nonce=NONCE,
            code_challenge=challenge(),
        )
        authorize = provider_http.get(authorization_url)
        request_match = re.search(r'name="request_id" value="([A-Za-z0-9_-]+)"', authorize.text)
        assert request_match is not None
        approved = provider_http.post(
            "/authorize",
            data={"request_id": request_match.group(1), "identity": "bob"},
            follow_redirects=False,
        )
        code = parse_qs(urlsplit(approved.headers["location"]).query)["code"][0]
        identity = oidc_client.exchange_code(
            code=code,
            code_verifier=VERIFIER,
            expected_nonce=NONCE,
        )

    assert identity.issuer == ISSUER
    assert identity.subject == "rcp32-bob"
    assert identity.email == "bob@rcp32.recipe-lab.invalid"
    assert identity.email_verified is True
    assert identity.suggested_display_name == "Bob"
    assert identity.authenticated_at is not None


def test_authorization_request_and_code_are_each_single_use() -> None:
    application = create_provider_app(provider_config())

    with TestClient(application) as client:
        authorize = client.get("/authorize", params=authorization_parameters())
        request_match = re.search(r'name="request_id" value="([A-Za-z0-9_-]+)"', authorize.text)
        assert request_match is not None
        form = {"request_id": request_match.group(1), "identity": "bob"}
        approved = client.post("/authorize", data=form, follow_redirects=False)
        replayed_approval = client.post("/authorize", data=form, follow_redirects=False)
        code = parse_qs(urlsplit(approved.headers["location"]).query)["code"][0]
        first = client.post("/token", data=token_form(code))
        second = client.post("/token", data=token_form(code))

    assert approved.status_code == 303
    assert replayed_approval.status_code == 400
    assert replayed_approval.json()["error"] == "invalid_request"
    assert first.status_code == 200
    assert second.status_code == 400
    assert second.json()["error"] == "invalid_grant"


def test_wrong_pkce_verifier_consumes_the_one_time_code() -> None:
    application = create_provider_app(provider_config())
    wrong_verifier = "wrong-verifier-that-is-long-enough-123456789012345678901"

    with TestClient(application) as client:
        code, _location = begin_and_approve(client)
        rejected = client.post("/token", data=token_form(code, verifier=wrong_verifier))
        replayed = client.post("/token", data=token_form(code))

    assert rejected.status_code == 400
    assert rejected.json()["error"] == "invalid_grant"
    assert replayed.status_code == 400
    assert replayed.json()["error"] == "invalid_grant"


def test_authorization_codes_expire_after_the_short_provider_window() -> None:
    current_time = [datetime(2026, 8, 26, 18, 0, tzinfo=UTC)]
    application = create_provider_app(provider_config(), clock=lambda: current_time[0])

    with TestClient(application) as client:
        code, _location = begin_and_approve(client)
        current_time[0] += timedelta(minutes=3)
        expired = client.post("/token", data=token_form(code))

    assert expired.status_code == 400
    assert expired.json()["error"] == "invalid_grant"


@pytest.mark.parametrize(
    ("environment", "message"),
    [
        ({}, "RCP32_ACCEPTANCE=1"),
        (
            {"RCP32_ACCEPTANCE": "1"},
            "ACCEPTANCE_DATABASE_ISOLATED=1",
        ),
        (
            guarded_environment(APP_ENVIRONMENT="production"),
            "cannot run in production",
        ),
        (
            guarded_environment(OIDC_ISSUER="http://192.0.2.10:8200"),
            "loopback URL",
        ),
        (
            guarded_environment(OIDC_REDIRECT_URI="https://example.test/api/auth/callback"),
            "loopback URL",
        ),
        (
            guarded_environment(OIDC_ISSUER="https://127.0.0.1:8200"),
            "requires loopback HTTP URLs",
        ),
    ],
)
def test_unsafe_provider_environments_are_rejected(
    environment: dict[str, str],
    message: str,
) -> None:
    with pytest.raises(LocalOIDCProviderError, match=message):
        config_from_environment(environment)


def test_main_refuses_non_loopback_bind_and_issuer_port_mismatch() -> None:
    with pytest.raises(SystemExit, match="bind host must be loopback"):
        main(["--host", "0.0.0.0", "--port", "8200"], environment=guarded_environment())
    with pytest.raises(SystemExit, match="bind port must match"):
        main(["--host", "127.0.0.1", "--port", "8201"], environment=guarded_environment())


def test_main_starts_only_the_guarded_loopback_server_without_access_logs(
    monkeypatch: MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    def fake_run(application: object, **options: object) -> None:
        captured["application"] = application
        captured.update(options)

    monkeypatch.setattr("app.testing.local_oidc_provider.uvicorn.run", fake_run)

    assert (
        main(
            ["--host", "127.0.0.1", "--port", "8200"],
            environment=guarded_environment(),
        )
        == 0
    )
    assert captured["host"] == "127.0.0.1"
    assert captured["port"] == 8200
    assert captured["access_log"] is False
    assert captured["log_level"] == "warning"


def test_invalid_authorization_inputs_and_oversized_forms_fail_without_redirecting() -> None:
    application = create_provider_app(provider_config())

    with TestClient(application) as client:
        wrong_client = client.get(
            "/authorize",
            params=authorization_parameters(client_id="attacker-client"),
            follow_redirects=False,
        )
        wrong_redirect = client.get(
            "/authorize",
            params=authorization_parameters(redirect_uri="http://127.0.0.1:3999/api/auth/callback"),
            follow_redirects=False,
        )
        duplicate_state = client.get(
            "/authorize?" + urlencode_for_duplicate_state(),
            follow_redirects=False,
        )
        invalid_pkce = client.get(
            "/authorize",
            params=authorization_parameters(code_challenge="not-s256"),
            follow_redirects=False,
        )
        oversized = client.post(
            "/token",
            content=b"x" * 4_097,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        streamed = client.post(
            "/token",
            content=(chunk for chunk in (b"x" * 2_048, b"y" * 2_049)),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    for response in (wrong_client, wrong_redirect, duplicate_state, invalid_pkce):
        assert response.status_code == 400
        assert "location" not in response.headers
        assert response.json()["error"] == "invalid_request"
    assert oversized.status_code == 400
    assert oversized.json()["error"] == "invalid_request"
    assert streamed.status_code == 400
    assert streamed.json()["error"] == "invalid_request"


def urlencode_for_duplicate_state() -> str:
    parameters = authorization_parameters()
    pairs = list(parameters.items())
    pairs.append(("state", "another-state-value-that-is-long-enough"))
    return urlencode(pairs)
