import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_environment_backed_settings_have_immutable_concern_views() -> None:
    settings = Settings(
        app_environment="test",
        auth_allowed_origins="https://app.example.test",
        auth_session_ttl_seconds=3_600,
        database_operation_timeout_seconds=7,
        max_request_body_bytes=4_096,
        oidc_allowed_signing_algorithms="RS256,ES256",
        oidc_client_id="recipe-lab",
        oidc_issuer="https://identity.example.test",
        oidc_redirect_uri="https://app.example.test/api/auth/callback",
        oidc_scopes="openid email profile email",
    )

    assert settings.database.operation_timeout_seconds == 7
    assert settings.http.environment == "test"
    assert settings.http.max_request_body_bytes == 4_096
    assert settings.session.allowed_origins == ("https://app.example.test",)
    assert settings.session.cookie_secure is True
    assert settings.session.ttl_seconds == 3_600
    assert settings.oidc.allowed_signing_algorithms == ("RS256", "ES256")
    assert settings.oidc.scopes == ("openid", "email", "profile")

    with pytest.raises(ValidationError, match="frozen_instance"):
        settings.database.operation_timeout_seconds = 9


def test_concern_views_reflect_supported_runtime_test_overrides() -> None:
    settings = Settings(app_environment="test", auth_session_ttl_seconds=3_600)

    settings.auth_session_ttl_seconds = 7_200
    settings.abuse_rate_limit_auth_network = 17

    assert settings.session.ttl_seconds == 7_200
    assert settings.abuse.rate_limit_auth_network == 17
