from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import app.api.routes.recipe_duplicates as duplicate_routes
from app.api.dependencies import get_required_authenticated_session, get_session
from app.core.security import AUTH_CSRF_COOKIE_NAME, token_digest
from app.main import create_app
from app.schemas.recipe_duplicates import (
    RecipeDuplicateAcknowledgementResponse,
    RecipeDuplicateDecisionResponse,
    RecipeDuplicatePreflightResponse,
    RecipeDuplicateWarningResponse,
)
from app.services.auth import AuthenticatedSession
from app.services.recipe_duplicate_preflights import (
    RecipeDuplicateDecisionServiceResult,
    RecipeDuplicatePreflightCapacityError,
    RecipeDuplicatePreflightServiceResult,
    RecipeDuplicatePreflightStaleError,
)

TEST_ORIGIN = "http://localhost:3000"


def _json_object(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return value


def _authenticated_session(actor_id: UUID, csrf_token: str) -> AuthenticatedSession:
    return AuthenticatedSession(
        session_id=uuid4(),
        user_id=actor_id,
        csrf_token_digest=token_digest(csrf_token),
        expires_at=datetime.now(UTC) + timedelta(hours=1),
        handle="duplicate_tester",
        display_name="Duplicate tester",
    )


def _payload() -> dict[str, object]:
    return {
        "title": "Proposed recipe",
        "description": "Display prose",
        "servings": "4.00",
        "ingredient_edits": [],
        "instruction_edits": [],
    }


@pytest.fixture
def actor_id() -> UUID:
    return uuid4()


@pytest.fixture
def csrf_token() -> str:
    return "duplicate-preflight-csrf-token"


@pytest.fixture
def duplicate_client(
    monkeypatch: pytest.MonkeyPatch,
    actor_id: UUID,
    csrf_token: str,
) -> Iterator[TestClient]:
    application = create_app()
    database_session = Session()
    authenticated = _authenticated_session(actor_id, csrf_token)

    def override_session() -> Iterator[Session]:
        yield database_session

    application.dependency_overrides[get_session] = override_session
    application.dependency_overrides[get_required_authenticated_session] = lambda: authenticated
    monkeypatch.setattr(
        duplicate_routes,
        "lock_active_member_actor",
        lambda _session, _authenticated: actor_id,
    )
    try:
        with TestClient(application) as client:
            client.cookies.set(AUTH_CSRF_COOKIE_NAME, csrf_token)
            client.headers.update(
                {
                    "Origin": TEST_ORIGIN,
                    "X-CSRF-Token": csrf_token,
                }
            )
            yield client
    finally:
        application.dependency_overrides.clear()
        database_session.close()


def test_preflight_route_returns_private_bounded_contract(
    monkeypatch: pytest.MonkeyPatch,
    duplicate_client: TestClient,
    actor_id: UUID,
) -> None:
    source_id = uuid4()
    preflight_id = uuid4()
    result_digest = "a" * 64

    def run_preflight(
        _session: Session,
        *,
        source_version_id: UUID,
        actor_user_id: UUID,
        action_id: UUID,
        payload: object,
    ) -> RecipeDuplicatePreflightServiceResult:
        assert source_version_id == source_id
        assert actor_user_id == actor_id
        assert isinstance(action_id, UUID)
        assert payload is not None
        return RecipeDuplicatePreflightServiceResult(
            response=RecipeDuplicatePreflightResponse(
                classification="exact_duplicate",
                same_lineage_no_change=True,
                candidates=[],
                warnings=[
                    RecipeDuplicateWarningResponse(
                        code="same_lineage_no_change",
                        message=(
                            "This version has the same canonical structure as its direct parent."
                        ),
                    )
                ],
                acknowledgement=RecipeDuplicateAcknowledgementResponse(
                    preflight_id=preflight_id,
                    policy_version="recipe-duplicate-preflight-policy-v1",
                    result_digest=result_digest,
                    required=True,
                    allowed_decisions=["continue", "revise"],
                ),
            ),
            state="created",
        )

    monkeypatch.setattr(duplicate_routes, "run_recipe_duplicate_preflight", run_preflight)
    response = duplicate_client.post(
        f"/api/recipes/{source_id}/duplicate-preflights",
        headers={"Idempotency-Key": str(uuid4())},
        json=_payload(),
    )

    assert response.status_code == 201
    assert response.headers["cache-control"] == "private, no-store"
    assert "cookie" in response.headers["vary"].casefold()
    body = _json_object(response.json())
    assert body["classification"] == "exact_duplicate"
    acknowledgement = _json_object(body["acknowledgement"])
    assert acknowledgement == {
        "preflight_id": str(preflight_id),
        "policy_version": "recipe-duplicate-preflight-policy-v1",
        "result_digest": result_digest,
        "required": True,
        "allowed_decisions": ["continue", "revise"],
    }


def test_mutating_duplicate_routes_require_csrf_and_idempotency(
    duplicate_client: TestClient,
) -> None:
    source_id = uuid4()
    missing_key = duplicate_client.post(
        f"/api/recipes/{source_id}/duplicate-preflights",
        json=_payload(),
    )
    assert missing_key.status_code == 422

    missing_csrf = duplicate_client.post(
        f"/api/recipes/{source_id}/duplicate-preflights",
        headers={
            "Idempotency-Key": str(uuid4()),
            "X-CSRF-Token": "",
        },
        json=_payload(),
    )
    assert missing_csrf.status_code == 403
    assert _json_object(missing_csrf.json())["error"] == {
        "code": "invalid_csrf",
        "message": "The request could not be verified.",
        "issues": [],
    }


def test_decision_route_records_only_acknowledged_advisory_choice(
    monkeypatch: pytest.MonkeyPatch,
    duplicate_client: TestClient,
    actor_id: UUID,
) -> None:
    preflight_id = uuid4()
    recorded_at = datetime(2026, 8, 25, tzinfo=UTC)

    def record_decision(
        _session: Session,
        *,
        preflight_id: UUID,
        actor_user_id: UUID,
        action_id: UUID,
        payload: object,
    ) -> RecipeDuplicateDecisionServiceResult:
        assert actor_user_id == actor_id
        assert isinstance(action_id, UUID)
        assert payload is not None
        return RecipeDuplicateDecisionServiceResult(
            response=RecipeDuplicateDecisionResponse(
                preflight_id=preflight_id,
                decision="continue",
                recorded_at=recorded_at,
            ),
            state="created",
        )

    monkeypatch.setattr(
        duplicate_routes,
        "record_recipe_duplicate_decision",
        record_decision,
    )
    response = duplicate_client.post(
        f"/api/recipe-duplicate-preflights/{preflight_id}/decision",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "policy_version": "recipe-duplicate-preflight-policy-v1",
            "result_digest": "b" * 64,
            "decision": "continue",
        },
    )

    assert response.status_code == 201
    assert response.json() == {
        "preflight_id": str(preflight_id),
        "decision": "continue",
        "recorded_at": "2026-08-25T00:00:00Z",
    }


def test_preflight_capacity_failure_is_generic_and_fail_closed(
    monkeypatch: pytest.MonkeyPatch,
    duplicate_client: TestClient,
) -> None:
    def capacity_failure(
        *_args: object, **_kwargs: object
    ) -> RecipeDuplicatePreflightServiceResult:
        raise RecipeDuplicatePreflightCapacityError(
            "Internal work-limit details must not reach the response."
        )

    monkeypatch.setattr(
        duplicate_routes,
        "run_recipe_duplicate_preflight",
        capacity_failure,
    )
    response = duplicate_client.post(
        f"/api/recipes/{uuid4()}/duplicate-preflights",
        headers={"Idempotency-Key": str(uuid4())},
        json=_payload(),
    )

    assert response.status_code == 503
    assert _json_object(response.json())["error"] == {
        "code": "duplicate_preflight_unavailable",
        "message": "Duplicate preflight is temporarily unavailable. Please try again later.",
        "issues": [],
    }


def test_stale_candidate_evidence_is_generic_for_replay_and_decision_routes(
    monkeypatch: pytest.MonkeyPatch,
    duplicate_client: TestClient,
) -> None:
    hidden_candidate_id = uuid4()
    hidden_title = "Unavailable private candidate title"

    def stale_failure(*_args: object, **_kwargs: object) -> None:
        raise RecipeDuplicatePreflightStaleError(
            f"Internal evidence mentioned {hidden_candidate_id} and {hidden_title}."
        )

    monkeypatch.setattr(
        duplicate_routes,
        "run_recipe_duplicate_preflight",
        stale_failure,
    )
    preflight_response = duplicate_client.post(
        f"/api/recipes/{uuid4()}/duplicate-preflights",
        headers={"Idempotency-Key": str(uuid4())},
        json=_payload(),
    )

    monkeypatch.setattr(
        duplicate_routes,
        "record_recipe_duplicate_decision",
        stale_failure,
    )
    decision_response = duplicate_client.post(
        f"/api/recipe-duplicate-preflights/{uuid4()}/decision",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "policy_version": "recipe-duplicate-preflight-policy-v1",
            "result_digest": "c" * 64,
            "decision": "continue",
        },
    )

    expected = {
        "code": "duplicate_preflight_stale",
        "message": "The duplicate preflight is no longer current. Run it again.",
        "issues": [],
    }
    for response in (preflight_response, decision_response):
        assert response.status_code == 409
        assert _json_object(response.json())["error"] == expected
        assert str(hidden_candidate_id) not in response.text
        assert hidden_title not in response.text


def test_openapi_documents_both_duplicate_preflight_actions(
    duplicate_client: TestClient,
) -> None:
    schema = duplicate_client.get("/openapi.json").json()
    paths = _json_object(schema["paths"])
    for path in (
        "/api/recipes/{recipe_version_id}/duplicate-preflights",
        "/api/recipe-duplicate-preflights/{preflight_id}/decision",
    ):
        operation = _json_object(_json_object(paths[path])["post"])
        parameters = operation["parameters"]
        assert isinstance(parameters, list)
        idempotency = next(
            _json_object(parameter)
            for parameter in parameters
            if _json_object(parameter)["name"] == "Idempotency-Key"
        )
        assert idempotency["in"] == "header"
        assert idempotency["required"] is True
        assert _json_object(idempotency["schema"])["format"] == "uuid"
