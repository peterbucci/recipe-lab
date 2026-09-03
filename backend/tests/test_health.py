import json
import logging
from collections.abc import Iterator
from typing import cast
from unittest.mock import Mock
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.main import app, create_app
from tests.application import application_with_session, application_with_session_dependency

client = TestClient(app)


def test_health_check() -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "recipe-lab-api"}
    assert UUID(response.headers["X-Correlation-ID"]).version == 4


def test_readiness_checks_the_database_dependency() -> None:
    session = Mock(spec=Session)
    session.execute.return_value.scalar_one.return_value = 1

    with application_with_session(cast(Session, session)) as application:
        with TestClient(application) as ready_client:
            response = ready_client.get("/api/readiness")

    assert response.status_code == 200
    assert response.json() == {"status": "ready", "service": "recipe-lab-api"}
    assert UUID(response.headers["X-Correlation-ID"]).version == 4
    session.execute.assert_called_once()
    session.execute.return_value.scalar_one.assert_called_once_with()


def test_liveness_survives_database_failure_while_readiness_fails_closed(
    caplog: pytest.LogCaptureFixture,
) -> None:
    def unavailable_session() -> Iterator[Session]:
        raise OperationalError("SELECT private_value", {"token": "provider-secret"}, RuntimeError())
        yield  # pragma: no cover

    with application_with_session_dependency(unavailable_session) as application:
        with TestClient(application) as unavailable_client:
            health = unavailable_client.get("/api/health")
            with caplog.at_level(logging.ERROR, logger="recipe_lab.operations"):
                readiness = unavailable_client.get("/api/readiness")

    assert health.status_code == 200
    assert health.json() == {"status": "ok", "service": "recipe-lab-api"}
    assert readiness.status_code == 503
    correlation_id = readiness.headers["X-Correlation-ID"]
    assert readiness.json() == {
        "error": {
            "code": "dependency_unavailable",
            "message": "A required service dependency is temporarily unavailable.",
            "issues": [],
            "correlation_id": correlation_id,
        }
    }
    events = [
        json.loads(record.getMessage())
        for record in caplog.records
        if record.name == "recipe_lab.operations"
    ]
    assert events == [{"correlation_id": correlation_id, "event": "database_failure"}]


def test_openapi_distinguishes_liveness_from_readiness_and_correlated_errors() -> None:
    schema = create_app().openapi()
    assert set(schema["paths"]["/api/health"]["get"]["responses"]) == {"200"}
    assert set(schema["paths"]["/api/readiness"]["get"]["responses"]) == {"200", "503"}
    assert schema["paths"]["/api/readiness"]["get"]["responses"]["503"]["content"][
        "application/json"
    ]["schema"] == {"$ref": "#/components/schemas/ErrorResponse"}
    error_detail = schema["components"]["schemas"]["ErrorDetail"]
    assert "correlation_id" in error_detail["required"]
    assert error_detail["properties"]["correlation_id"]["pattern"].startswith("^")
