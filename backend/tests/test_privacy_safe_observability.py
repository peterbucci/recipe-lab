import json
import logging
from collections.abc import AsyncIterator
from enum import Enum
from typing import Annotated, Any, cast
from uuid import UUID

import pytest
from fastapi import Body
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.api.errors import ApiError
from app.core.domain_errors import (
    DomainConflictError,
    DomainForbiddenError,
    DomainNotFoundError,
    DomainPreconditionFailedError,
    DomainRateLimitedError,
    DomainUnavailableError,
    DomainValidationError,
)
from app.core.observability import (
    OPERATIONAL_FAILURE_EVENTS,
    emit_operational_failure,
    new_correlation_id,
)
from app.main import create_app


class _MissingDomainResource(DomainNotFoundError):
    code = "missing_domain_resource"
    public_message = "The domain resource was not found."


class _ForbiddenDomainAction(DomainForbiddenError):
    code = "forbidden_domain_action"
    public_message = "This domain action is not allowed."


class _ConflictingDomainAction(DomainConflictError):
    code = "conflicting_domain_action"
    public_message = "The domain state conflicts with this action."


class _FailedDomainPrecondition(DomainPreconditionFailedError):
    code = "failed_domain_precondition"
    public_message = "The domain precondition no longer holds."


class _InvalidDomainInput(DomainValidationError):
    code = "invalid_domain_input"
    public_message = "The domain input is invalid."


class _LimitedDomainAction(DomainRateLimitedError):
    code = "limited_domain_action"
    public_message = "The domain action limit was exceeded."


class _LimitedDomainActionWithRetry(_LimitedDomainAction):
    def __init__(self) -> None:
        super().__init__(headers={"Retry-After": "17"})


class _UnavailableDomainCapability(DomainUnavailableError):
    code = "unavailable_domain_capability"
    public_message = "The domain capability is temporarily unavailable."


def _assert_uuid4(value: str) -> None:
    parsed = UUID(value)
    assert parsed.version == 4
    assert str(parsed) == value


def _event_payloads(caplog: pytest.LogCaptureFixture) -> list[dict[str, str]]:
    return [
        cast(dict[str, str], json.loads(record.getMessage()))
        for record in caplog.records
        if record.name == "recipe_lab.operations"
    ]


@pytest.mark.parametrize(
    ("exception", "expected_status", "expected_code", "expected_message"),
    [
        (
            _MissingDomainResource("private lookup detail"),
            404,
            "missing_domain_resource",
            "The domain resource was not found.",
        ),
        (
            _ForbiddenDomainAction("private authorization detail"),
            403,
            "forbidden_domain_action",
            "This domain action is not allowed.",
        ),
        (
            _ConflictingDomainAction("private conflict detail"),
            409,
            "conflicting_domain_action",
            "The domain state conflicts with this action.",
        ),
        (
            _FailedDomainPrecondition("private revision detail"),
            412,
            "failed_domain_precondition",
            "The domain precondition no longer holds.",
        ),
        (
            _InvalidDomainInput("private validation detail"),
            422,
            "invalid_domain_input",
            "The domain input is invalid.",
        ),
        (
            _LimitedDomainAction("private quota detail"),
            429,
            "limited_domain_action",
            "The domain action limit was exceeded.",
        ),
        (
            _UnavailableDomainCapability("private dependency detail"),
            503,
            "unavailable_domain_capability",
            "The domain capability is temporarily unavailable.",
        ),
    ],
)
def test_domain_errors_map_to_one_stable_http_contract(
    exception: Exception,
    expected_status: int,
    expected_code: str,
    expected_message: str,
) -> None:
    application = create_app()

    @application.get("/test/domain-error")
    def fail_with_domain_error() -> None:
        raise exception

    with TestClient(application) as client:
        response = client.get("/test/domain-error")

    correlation_id = response.headers["X-Correlation-ID"]
    assert response.status_code == expected_status
    assert response.json() == {
        "error": {
            "code": expected_code,
            "message": expected_message,
            "issues": [],
            "correlation_id": correlation_id,
        }
    }
    assert "private" not in response.text


def test_domain_error_headers_are_preserved() -> None:
    application = create_app()

    @application.get("/test/limited-domain-error")
    def fail_with_limited_domain_error() -> None:
        raise _LimitedDomainActionWithRetry()

    with TestClient(application) as client:
        response = client.get("/test/limited-domain-error")

    assert response.status_code == 429
    assert response.headers["retry-after"] == "17"


def test_correlation_ids_are_cryptographically_random_per_request_and_ignore_input() -> None:
    application = create_app()
    supplied = "00000000-0000-4000-8000-000000000000"

    with TestClient(application) as client:
        responses = [
            client.get("/api/health", headers={"X-Correlation-ID": supplied}) for _ in range(64)
        ]

    identifiers = [response.headers["X-Correlation-ID"] for response in responses]
    assert supplied not in identifiers
    assert len(set(identifiers)) == len(identifiers)
    for identifier in identifiers:
        _assert_uuid4(identifier)


def test_correlation_id_generator_reads_exactly_16_random_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[int] = []

    def deterministic_bytes(length: int) -> bytes:
        calls.append(length)
        return bytes(range(length))

    monkeypatch.setattr("app.core.observability.secrets.token_bytes", deterministic_bytes)
    identifier = new_correlation_id()

    assert calls == [16]
    _assert_uuid4(identifier)


@pytest.mark.parametrize(
    ("tags", "expected_event"),
    [
        (["authentication"], "authentication_failure"),
        (["recipe publication"], "publication_failure"),
        ([], "application_failure"),
    ],
)
def test_unhandled_failures_emit_only_fixed_redacted_events(
    tags: list[str | Enum],
    expected_event: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    application = create_app()

    @application.post("/test/failure", tags=tags)
    def fail(payload: Annotated[dict[str, object], Body()]) -> None:
        del payload
        raise RuntimeError(
            "provider-secret session-cookie csrf-token cook@example.test "
            "/private/drafts/123?token=bad"
        )

    with (
        TestClient(application) as client,
        caplog.at_level(logging.ERROR, logger="recipe_lab.operations"),
    ):
        response = client.post(
            "/test/failure?email=cook@example.test",
            headers={
                "Authorization": "Bearer provider-secret",
                "X-CSRF-Token": "csrf-token",
                "Cookie": "recipe_lab_session=session-cookie",
            },
            json={"private_recipe": "Grandma's private recipe"},
        )

    correlation_id = response.headers["X-Correlation-ID"]
    assert response.status_code == 500
    assert response.json() == {
        "error": {
            "code": "internal_error",
            "message": "The service could not complete the request.",
            "issues": [],
            "correlation_id": correlation_id,
        }
    }
    events = _event_payloads(caplog)
    assert events == [{"correlation_id": correlation_id, "event": expected_event}]
    rendered = "\n".join(record.getMessage() for record in caplog.records)
    for private_value in (
        "provider-secret",
        "session-cookie",
        "csrf-token",
        "cook@example.test",
        "Grandma's private recipe",
        "/private/drafts/123",
        "token=bad",
    ):
        assert private_value not in rendered


@pytest.mark.parametrize(
    ("tags", "expected_event"),
    [
        (["authentication"], "authentication_failure"),
        (["recipe publication"], "publication_failure"),
    ],
)
def test_expected_operational_failures_are_correlated_without_error_details(
    tags: list[str | Enum],
    expected_event: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    application = create_app()

    @application.get("/test/unavailable", tags=tags)
    def unavailable() -> None:
        raise ApiError(
            status_code=503,
            code="temporarily_unavailable",
            message="Please retry without exposing provider internals.",
        )

    with (
        TestClient(application) as client,
        caplog.at_level(logging.ERROR, logger="recipe_lab.operations"),
    ):
        response = client.get("/test/unavailable")

    correlation_id = response.headers["X-Correlation-ID"]
    assert response.status_code == 503
    assert response.json()["error"]["correlation_id"] == correlation_id
    assert _event_payloads(caplog) == [{"correlation_id": correlation_id, "event": expected_event}]


def test_database_failure_never_emits_statement_parameters_or_exception_text(
    caplog: pytest.LogCaptureFixture,
) -> None:
    application = create_app()

    @application.get("/test/database")
    def database_failure() -> None:
        raise OperationalError(
            "SELECT * FROM private_drafts WHERE owner_email = %(email)s",
            {"email": "cook@example.test", "token": "database-secret"},
            RuntimeError("session-cookie"),
        )

    with (
        TestClient(application) as client,
        caplog.at_level(logging.ERROR, logger="recipe_lab.operations"),
    ):
        response = client.get("/test/database")

    correlation_id = response.headers["X-Correlation-ID"]
    assert response.status_code == 503
    assert response.json()["error"]["correlation_id"] == correlation_id
    assert _event_payloads(caplog) == [
        {"correlation_id": correlation_id, "event": "database_failure"}
    ]
    rendered = "\n".join(record.getMessage() for record in caplog.records)
    assert "SELECT" not in rendered
    assert "private_drafts" not in rendered
    assert "cook@example.test" not in rendered
    assert "database-secret" not in rendered
    assert "session-cookie" not in rendered


def test_failure_after_response_start_closes_stream_without_logging_private_text(
    caplog: pytest.LogCaptureFixture,
) -> None:
    application = create_app()

    async def failed_stream() -> AsyncIterator[bytes]:
        yield b"safe-prefix"
        raise RuntimeError("private-stream-canary cook@example.test /private/draft/42")

    @application.get("/test/stream")
    def stream() -> StreamingResponse:
        return StreamingResponse(failed_stream(), media_type="text/plain")

    with (
        TestClient(application) as client,
        caplog.at_level(logging.ERROR, logger="recipe_lab.operations"),
    ):
        response = client.get("/test/stream")

    assert response.status_code == 200
    assert response.content == b"safe-prefix"
    correlation_id = response.headers["X-Correlation-ID"]
    assert _event_payloads(caplog) == [
        {"correlation_id": correlation_id, "event": "application_failure"}
    ]
    rendered = "\n".join(record.getMessage() for record in caplog.records)
    assert "private-stream-canary" not in rendered
    assert "cook@example.test" not in rendered
    assert "/private/draft/42" not in rendered


def test_validation_errors_and_cors_responses_include_matching_server_ids() -> None:
    application = create_app()

    @application.get("/test/validated")
    def validated(value: int) -> dict[str, int]:
        return {"value": value}

    with TestClient(application) as client:
        invalid = client.get(
            "/test/validated?value=private-value",
            headers={"X-Correlation-ID": "caller-controlled"},
        )
        preflight = client.options(
            "/api/health",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
            },
        )

    invalid_id = invalid.headers["X-Correlation-ID"]
    _assert_uuid4(invalid_id)
    assert invalid.json()["error"]["correlation_id"] == invalid_id
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == "http://localhost:3000"
    _assert_uuid4(preflight.headers["X-Correlation-ID"])


def test_operational_event_names_are_closed_to_unreviewed_values() -> None:
    assert OPERATIONAL_FAILURE_EVENTS == {
        "authentication_failure",
        "publication_failure",
        "database_failure",
        "application_failure",
    }
    with pytest.raises(ValueError, match="not allowlisted"):
        emit_operational_failure(
            cast(Any, "private_recipe_viewed"),
            correlation_id="00000000-0000-4000-8000-000000000000",
        )
