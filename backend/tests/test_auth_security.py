import logging

import pytest
from pydantic import ValidationError

from app.core.logging import RedactAuthCallbackQueryFilter
from app.core.security import (
    generate_opaque_token,
    generate_pkce_verifier,
    normalize_origin,
    pkce_s256_challenge,
    token_digest,
    validate_return_path,
)
from app.schemas.auth import AccountProfileUpdateRequest


def test_session_tokens_are_high_entropy_and_only_stable_as_digests() -> None:
    first = generate_opaque_token()
    second = generate_opaque_token()

    assert first != second
    assert len(first) >= 43
    assert token_digest(first) != first
    assert len(token_digest(first)) == 64
    assert token_digest(first) == token_digest(first)


def test_pkce_verifier_and_s256_challenge_use_supported_lengths() -> None:
    verifier = generate_pkce_verifier()
    challenge = pkce_s256_challenge(verifier)

    assert 43 <= len(verifier) <= 128
    assert len(challenge) == 43
    assert "=" not in challenge


@pytest.mark.parametrize(
    "return_path",
    [
        "https://attacker.example.test/",
        "//attacker.example.test/",
        "/\\attacker.example.test/",
        "recipes",
        "/recipes\r\nSet-Cookie: bad=1",
    ],
)
def test_return_path_rejects_origin_changes_and_control_characters(return_path: str) -> None:
    with pytest.raises(ValueError):
        validate_return_path(return_path)


def test_origin_normalization_is_exact_and_rejects_credentials_or_paths() -> None:
    assert normalize_origin("HTTPS://APP.EXAMPLE.TEST:443") == "https://app.example.test"
    with pytest.raises(ValueError):
        normalize_origin("https://user:password@app.example.test")
    with pytest.raises(ValueError):
        normalize_origin("https://app.example.test/api")


def test_onboarding_normalizes_handle_and_rejects_control_characters() -> None:
    payload = AccountProfileUpdateRequest(handle="  Test_Cook  ", display_name=" Test Cook ")
    assert payload.handle == "test_cook"
    assert payload.display_name == "Test Cook"

    with pytest.raises(ValidationError):
        AccountProfileUpdateRequest(handle="test-cook", display_name="Cook\u200bName")


@pytest.mark.parametrize(
    "callback_path",
    ["/api/auth/callback", "/api/auth/callback/"],
    ids=["canonical", "slash-redirect"],
)
def test_uvicorn_access_filter_removes_callback_secrets(callback_path: str) -> None:
    record = logging.LogRecord(
        name="uvicorn.access",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg='%s - "%s %s HTTP/%s" %d',
        args=(
            "127.0.0.1:1234",
            "GET",
            f"{callback_path}?code=provider-code&state=secret-state",
            "1.1",
            303,
        ),
        exc_info=None,
    )

    assert RedactAuthCallbackQueryFilter().filter(record) is True
    rendered = record.getMessage()
    assert "/api/auth/callback" in rendered
    assert "provider-code" not in rendered
    assert "secret-state" not in rendered
