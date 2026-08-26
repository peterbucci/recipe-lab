from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.core.config import Settings
from app.services.oidc import (
    InvalidOIDCLoginError,
    OIDCClient,
    OIDCConfigurationError,
    OIDCProviderUnavailableError,
)

ISSUER = "https://identity.example.test"
CLIENT_ID = "recipe-lab-test"
REDIRECT_URI = "https://app.example.test/api/auth/callback"
NONCE = "nonce-that-belongs-to-the-login-transaction"
KEY_ID = "test-signing-key"


def auth_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "app_environment": "test",
        "oidc_issuer": ISSUER,
        "oidc_client_id": CLIENT_ID,
        "oidc_client_secret": "test-client-secret",
        "oidc_redirect_uri": REDIRECT_URI,
    }
    values.update(overrides)
    return Settings.model_validate(values)


def signed_id_token(
    private_key: rsa.RSAPrivateKey,
    **claim_overrides: object,
) -> str:
    now = datetime.now(UTC)
    claims: dict[str, object] = {
        "iss": ISSUER,
        "sub": "provider-user-123",
        "aud": CLIENT_ID,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=5)).timestamp()),
        "nonce": NONCE,
        "email": "Cook@example.test",
        "email_verified": True,
        "name": "Test Cook",
    }
    claims.update(claim_overrides)
    return jwt.encode(
        claims,
        private_key,
        algorithm="RS256",
        headers={"kid": KEY_ID},
    )


def oidc_http_client(
    id_token: str,
    public_key: rsa.RSAPublicKey,
    *,
    discovered_issuer: str = ISSUER,
    token_endpoint: str | None = None,
) -> tuple[httpx.Client, list[httpx.Request]]:
    requests: list[httpx.Request] = []
    public_jwk = jwt.algorithms.RSAAlgorithm.to_jwk(public_key, as_dict=True)
    public_jwk.update({"kid": KEY_ID, "use": "sig", "alg": "RS256"})

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("/.well-known/openid-configuration"):
            return httpx.Response(
                200,
                json={
                    "issuer": discovered_issuer,
                    "authorization_endpoint": f"{ISSUER}/authorize",
                    "token_endpoint": token_endpoint or f"{ISSUER}/token",
                    "jwks_uri": f"{ISSUER}/jwks",
                    "id_token_signing_alg_values_supported": ["RS256"],
                },
            )
        if request.url.path == "/token":
            form = parse_qs(request.content.decode("ascii"))
            assert form["grant_type"] == ["authorization_code"]
            assert form["client_id"] == [CLIENT_ID]
            assert form["redirect_uri"] == [REDIRECT_URI]
            assert form["code_verifier"] == ["v" * 64]
            assert request.headers["authorization"].startswith("Basic ")
            return httpx.Response(200, json={"id_token": id_token, "access_token": "not-stored"})
        if request.url.path == "/jwks":
            return httpx.Response(200, json={"keys": [public_jwk]})
        raise AssertionError(f"Unexpected OIDC request: {request.method} {request.url}")

    return httpx.Client(transport=httpx.MockTransport(handler)), requests


def test_authorization_and_token_exchange_use_exact_configured_redirect_and_pkce() -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    http_client, requests = oidc_http_client(
        signed_id_token(private_key),
        private_key.public_key(),
    )

    with OIDCClient(auth_settings(), http_client=http_client) as client:
        authorization_url = client.build_authorization_url(
            state="state-value",
            nonce=NONCE,
            code_challenge="challenge-value",
        )
        query = parse_qs(httpx.URL(authorization_url).query.decode("ascii"))
        assert query == {
            "response_type": ["code"],
            "response_mode": ["query"],
            "client_id": [CLIENT_ID],
            "redirect_uri": [REDIRECT_URI],
            "scope": ["openid email profile"],
            "state": ["state-value"],
            "nonce": [NONCE],
            "code_challenge": ["challenge-value"],
            "code_challenge_method": ["S256"],
        }
        reauthentication_url = client.build_authorization_url(
            state="reauth-state",
            nonce=NONCE,
            code_challenge="challenge-value",
            force_reauthentication=True,
        )
        reauthentication_query = parse_qs(httpx.URL(reauthentication_url).query.decode("ascii"))
        assert reauthentication_query["prompt"] == ["login"]
        assert reauthentication_query["max_age"] == ["0"]

        identity = client.exchange_code(
            code="one-time-code",
            code_verifier="v" * 64,
            expected_nonce=NONCE,
        )

    assert identity.issuer == ISSUER
    assert identity.subject == "provider-user-123"
    assert identity.email == "cook@example.test"
    assert identity.email_verified is True
    assert identity.suggested_display_name == "Test Cook"
    assert identity.authenticated_at is None
    assert [request.url.path for request in requests] == [
        "/.well-known/openid-configuration",
        "/token",
        "/jwks",
    ]
    assert "not-stored" not in repr(identity)


def test_reauthentication_requires_a_fresh_valid_provider_auth_time() -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    authenticated_at = datetime.now(UTC).replace(microsecond=0)
    http_client, _ = oidc_http_client(
        signed_id_token(private_key, auth_time=int(authenticated_at.timestamp())),
        private_key.public_key(),
    )

    with OIDCClient(auth_settings(), http_client=http_client) as client:
        identity = client.exchange_code(
            code="one-time-code",
            code_verifier="v" * 64,
            expected_nonce=NONCE,
            require_auth_time_after=authenticated_at - timedelta(seconds=5),
        )

    assert identity.authenticated_at == authenticated_at


def test_normal_login_rejects_a_future_provider_auth_time() -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    http_client, _ = oidc_http_client(
        signed_id_token(
            private_key,
            auth_time=int((datetime.now(UTC) + timedelta(minutes=10)).timestamp()),
        ),
        private_key.public_key(),
    )

    with OIDCClient(auth_settings(), http_client=http_client) as client:
        with pytest.raises(InvalidOIDCLoginError):
            client.exchange_code(
                code="one-time-code",
                code_verifier="v" * 64,
                expected_nonce=NONCE,
            )


@pytest.mark.parametrize(
    "auth_time",
    [
        None,
        int((datetime.now(UTC) - timedelta(minutes=10)).timestamp()),
        int((datetime.now(UTC) + timedelta(minutes=10)).timestamp()),
        "not-a-timestamp",
        True,
    ],
    ids=["missing", "stale", "future", "wrong-type", "boolean"],
)
def test_reauthentication_rejects_missing_stale_future_or_invalid_auth_time(
    auth_time: object | None,
) -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    overrides = {} if auth_time is None else {"auth_time": auth_time}
    http_client, _ = oidc_http_client(
        signed_id_token(private_key, **overrides),
        private_key.public_key(),
    )

    with OIDCClient(auth_settings(), http_client=http_client) as client:
        with pytest.raises(InvalidOIDCLoginError):
            client.exchange_code(
                code="one-time-code",
                code_verifier="v" * 64,
                expected_nonce=NONCE,
                require_auth_time_after=datetime.now(UTC) - timedelta(seconds=5),
            )


@pytest.mark.parametrize(
    "claim_overrides",
    [
        {"iss": "https://attacker.example.test"},
        {"aud": "another-client"},
        {"exp": int((datetime.now(UTC) - timedelta(minutes=2)).timestamp())},
        {"nonce": "another-login-nonce"},
        {"nonce": "unicode-\u00e9-nonce"},
        {"email_verified": False},
    ],
    ids=["issuer", "audience", "expiry", "nonce", "unicode-nonce", "unverified-email"],
)
def test_invalid_security_claims_are_rejected(claim_overrides: dict[str, object]) -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    http_client, _ = oidc_http_client(
        signed_id_token(private_key, **claim_overrides),
        private_key.public_key(),
    )

    with OIDCClient(auth_settings(), http_client=http_client) as client:
        with pytest.raises(InvalidOIDCLoginError):
            client.exchange_code(
                code="one-time-code",
                code_verifier="v" * 64,
                expected_nonce=NONCE,
            )


@pytest.mark.parametrize("suffix", ["/", "\u00e9"], ids=["slash", "unicode"])
def test_discovery_issuer_must_match_exactly(suffix: str) -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    http_client, _ = oidc_http_client(
        signed_id_token(private_key),
        private_key.public_key(),
        discovered_issuer=f"{ISSUER}{suffix}",
    )

    with OIDCClient(auth_settings(), http_client=http_client) as client:
        with pytest.raises(OIDCProviderUnavailableError):
            client.build_authorization_url(
                state="state-value",
                nonce=NONCE,
                code_challenge="challenge-value",
            )


def test_id_token_signed_by_an_unpublished_key_is_rejected() -> None:
    signing_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    published_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    http_client, _ = oidc_http_client(
        signed_id_token(signing_key),
        published_key.public_key(),
    )

    with OIDCClient(auth_settings(), http_client=http_client) as client:
        with pytest.raises(InvalidOIDCLoginError):
            client.exchange_code(
                code="one-time-code",
                code_verifier="v" * 64,
                expected_nonce=NONCE,
            )


@pytest.mark.parametrize("algorithm", ["none", "HS256"])
def test_unsigned_or_symmetric_algorithm_downgrade_is_rejected(algorithm: str) -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    valid_token = signed_id_token(private_key)
    claims = jwt.decode(valid_token, options={"verify_signature": False})
    downgraded = jwt.encode(
        claims,
        key="" if algorithm == "none" else "attacker-secret-that-is-long-enough",
        algorithm=algorithm,
        headers={"kid": KEY_ID},
    )
    http_client, _ = oidc_http_client(downgraded, private_key.public_key())

    with OIDCClient(auth_settings(), http_client=http_client) as client:
        with pytest.raises(InvalidOIDCLoginError):
            client.exchange_code(
                code="one-time-code",
                code_verifier="v" * 64,
                expected_nonce=NONCE,
            )


def test_blank_client_secret_uses_public_client_token_exchange() -> None:
    settings = auth_settings(oidc_client_secret="")
    assert settings.oidc_client_secret is None


@pytest.mark.parametrize(
    "issuer",
    [
        "https://identity.example.test?tenant=other",
        "https://identity.example.test:notaport",
        "http://identity.example.test",
        "http://192.168.1.20",
    ],
    ids=[
        "issuer-query",
        "invalid-port",
        "cleartext-host",
        "cleartext-private-network",
    ],
)
def test_issuer_rejects_ambiguous_or_non_loopback_cleartext_urls(issuer: str) -> None:
    settings = auth_settings(
        app_environment="local",
        oidc_issuer=issuer,
        oidc_redirect_uri="http://localhost:3000/api/auth/callback",
    )
    with OIDCClient(settings, http_client=httpx.Client()) as client:
        with pytest.raises(OIDCConfigurationError):
            client.validate_configuration()


def test_discovery_endpoint_with_invalid_port_is_rejected_stably() -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    http_client, _ = oidc_http_client(
        signed_id_token(private_key),
        private_key.public_key(),
        token_endpoint="https://identity.example.test:notaport/token",
    )

    with OIDCClient(auth_settings(), http_client=http_client) as client:
        with pytest.raises(OIDCProviderUnavailableError):
            client.build_authorization_url(
                state="state-value",
                nonce=NONCE,
                code_challenge="challenge-value",
            )
