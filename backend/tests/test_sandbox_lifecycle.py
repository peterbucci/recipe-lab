from datetime import UTC, datetime, timedelta
from typing import cast
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

import app.api.sandbox as sandbox_api
import app.services.sandbox as sandbox_service
from app.api.dependencies import get_session
from app.api.sandbox import get_sandbox_admission_session
from app.core.config import Settings, get_settings
from app.main import create_app
from app.models import SandboxGeneration, User
from app.services.auth import AuthenticatedSession
from app.services.sandbox import (
    SandboxUnavailableError,
    initialize_generation_workflow,
    verify_active_generation,
)
from tests.application import fixed_session_dependency

START = datetime(2026, 9, 16, 12, tzinfo=UTC)
END = START + timedelta(hours=24)
DATABASE = "recipe_lab_sandbox_test"


def sandbox_settings(**overrides: object) -> Settings:
    return Settings.model_validate(
        {
            "database_url": f"postgresql+psycopg://example@localhost/{DATABASE}",
            "sandbox_enabled": True,
            "sandbox_generation_id": uuid4(),
            "sandbox_started_at": START,
            "sandbox_expires_at": END,
            "sandbox_contact_url": "https://portfolio.example/contact",
            **overrides,
        }
    )


@pytest.mark.parametrize(
    "overrides",
    [
        {"sandbox_generation_id": None},
        {"sandbox_enabled": False},
        {"sandbox_started_at": START.replace(tzinfo=None)},
        {"sandbox_expires_at": END + timedelta(seconds=1)},
        {"sandbox_expires_at": START},
        {"database_url": "postgresql+psycopg://example@localhost/recipe_lab"},
        {"oidc_issuer": "https://accounts.example"},
        {"sandbox_contact_url": "http://portfolio.example/contact"},
        {"sandbox_contact_url": "https://secret@example.test/contact"},
    ],
)
def test_sandbox_requires_bounded_isolated_configuration(overrides: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        sandbox_settings(**overrides)


def _bind(session: Session, settings: Settings) -> None:
    session.add(
        SandboxGeneration(
            generation_id=settings.sandbox.generation_id,
            started_at=settings.sandbox.started_at,
            expires_at=settings.sandbox.expires_at,
        )
    )
    session.flush()


def test_expiration_and_restored_generation_fail_closed(db_session: Session) -> None:
    settings = sandbox_settings()
    _bind(db_session, settings)
    verify_active_generation(db_session, settings=settings, now=START)
    for now in (START - timedelta(microseconds=1), END, END + timedelta(days=1)):
        with pytest.raises(SandboxUnavailableError):
            verify_active_generation(db_session, settings=settings, now=now)
    for changed in (
        settings.model_copy(update={"sandbox_generation_id": uuid4()}),
        settings.model_copy(update={"sandbox_expires_at": END + timedelta(hours=1)}),
        settings.model_copy(update={"sandbox_started_at": START - timedelta(hours=1)}),
    ):
        with pytest.raises(SandboxUnavailableError):
            verify_active_generation(db_session, settings=changed, now=START)


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE sandbox_generations SET expires_at = expires_at - interval '1 hour'",
        "DELETE FROM sandbox_generations",
        "TRUNCATE sandbox_generations",
    ],
)
def test_bound_generation_cannot_be_rewritten(db_session: Session, statement: str) -> None:
    _bind(db_session, sandbox_settings())
    with pytest.raises(DBAPIError), db_session.begin_nested():
        db_session.execute(text(statement))


def test_initialization_refuses_existing_member_database(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = sandbox_settings()
    monkeypatch.setattr(sandbox_service, "database_name", lambda _session: DATABASE)
    db_session.add(User(email="synthetic@example.invalid", display_name="Synthetic Cook"))
    db_session.commit()
    with pytest.raises(SandboxUnavailableError):
        initialize_generation_workflow(
            db_session,
            settings=settings,
            expected_database_name=DATABASE,
            now=START,
        )
    assert db_session.get(SandboxGeneration, 1) is None


def test_initialization_binds_once_and_never_extends_deadline(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = sandbox_settings()
    monkeypatch.setattr(sandbox_service, "database_name", lambda _session: DATABASE)
    initialize_generation_workflow(
        db_session,
        settings=settings,
        expected_database_name=DATABASE,
        now=START,
    )
    initialize_generation_workflow(
        db_session,
        settings=settings,
        expected_database_name=DATABASE,
        now=START,
    )
    settings.sandbox_expires_at = END + timedelta(hours=1)
    with pytest.raises(SandboxUnavailableError):
        initialize_generation_workflow(
            db_session,
            settings=settings,
            expected_database_name=DATABASE,
            now=START,
        )


def test_initialization_verifies_actual_database_name(db_session: Session) -> None:
    with pytest.raises(SandboxUnavailableError):
        initialize_generation_workflow(
            db_session,
            settings=sandbox_settings(),
            expected_database_name=DATABASE,
            now=START,
        )


def test_expired_sandbox_blocks_public_reads_writes_and_readiness_but_stays_live(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = sandbox_settings()
    _bind(db_session, settings)
    application = create_app()
    application.dependency_overrides[get_settings] = lambda: settings
    application.dependency_overrides[get_session] = fixed_session_dependency(db_session)
    application.dependency_overrides[get_sandbox_admission_session] = fixed_session_dependency(
        db_session
    )
    monkeypatch.setattr(sandbox_api, "utc_now", lambda: END)
    with TestClient(application) as client:
        for method, path in (
            ("GET", "/api/recipes"),
            ("POST", "/api/recipe-drafts"),
            ("GET", "/api/readiness"),
        ):
            response = client.request(method, path)
            assert response.status_code == 503
            assert response.json()["error"]["code"] == "sandbox_unavailable"
            assert response.headers["Cache-Control"] == "no-store"
        assert client.get("/api/health").status_code == 200


def test_unbound_generation_blocks_content(db_session: Session) -> None:
    with pytest.raises(SandboxUnavailableError):
        verify_active_generation(db_session, settings=sandbox_settings(), now=START)


def test_sandbox_disables_research_recommendations_before_loading_history(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.api.routes.recommendations as recommendations

    settings = sandbox_settings()
    _bind(db_session, settings)
    application = create_app()
    application.dependency_overrides[get_settings] = lambda: settings
    application.dependency_overrides[get_session] = fixed_session_dependency(db_session)
    application.dependency_overrides[get_sandbox_admission_session] = fixed_session_dependency(
        db_session
    )
    monkeypatch.setattr(sandbox_api, "utc_now", lambda: START)

    def unexpected_history_read(*_args: object, **_kwargs: object) -> None:
        pytest.fail("Sandbox requests must not load recommendation history.")

    monkeypatch.setattr(recommendations, "recommend_recipe_versions", unexpected_history_read)
    with TestClient(application) as client:
        response = client.get("/api/recommendations")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "sandbox_research_disabled"


def test_sandbox_view_validates_visibility_without_recording_passive_history(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api.routes import interactions

    session = MagicMock(spec=Session)
    authenticated = cast(AuthenticatedSession, object())
    recipe_id, user_id = uuid4(), uuid4()
    visibility = MagicMock()
    record = MagicMock()
    monkeypatch.setattr(interactions, "lock_active_member_actor", lambda *_args: user_id)
    monkeypatch.setattr(interactions, "ensure_recipe_exists", visibility)
    monkeypatch.setattr(interactions, "_is_replay_or_error", lambda *_args: False)
    monkeypatch.setattr(interactions, "record_preference_event", record)
    result = interactions.record_recipe_view_for_current_user(
        recipe_version_id=recipe_id,
        action_id=uuid4(),
        session=session,
        authenticated=authenticated,
        settings=sandbox_settings(),
    )
    assert result.status_code == 204
    visibility.assert_called_once_with(session, recipe_id)
    record.assert_not_called()
