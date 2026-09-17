from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from secrets import token_urlsafe
from uuid import UUID, uuid4

import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import Engine, delete, func, select
from sqlalchemy.orm import Session

from app.api.sandbox import get_sandbox_admission_session
from app.core.config import Settings, get_settings
from app.core.security import (
    AUTH_CSRF_COOKIE_NAME,
    AUTH_FORCE_LOGIN_COOKIE_NAME,
    AUTH_SESSION_COOKIE_NAME,
    token_digest,
)
from app.models import AbuseRateLimitBucket, OIDCIdentity, User, UserSession
from app.models.auth import SandboxVisitorEntry
from app.models.sandbox import SandboxGeneration
from app.services.auth import (
    DemoCapacityReachedError,
    DemoEntryExpiredError,
    DemoGenerationChangedError,
    DemoUnavailableError,
    issue_sandbox_session,
    resolve_authenticated_session,
    revoke_authenticated_session,
)
from tests.application import application_with_database, database_session_dependency
from tests.conftest import isolated_postgres_engine, make_alembic_config


def sandbox_settings(now: datetime, **overrides: object) -> Settings:
    return Settings.model_validate(
        {
            "app_environment": "test",
            "database_url": "postgresql+psycopg://test:test@localhost/recipe_lab_sandbox_auth_test",
            "auth_allowed_origins": "https://app.example.test",
            "sandbox_enabled": True,
            "sandbox_generation_id": uuid4(),
            "sandbox_started_at": now - timedelta(minutes=1),
            "sandbox_expires_at": now + timedelta(hours=1),
            "sandbox_contact_url": "https://portfolio.example.test/contact",
            "oidc_issuer": "",
            "oidc_client_id": "",
            "oidc_redirect_uri": "",
            "oidc_client_secret": None,
            **overrides,
        }
    )


def test_guest_entry_has_separate_identity_digest_only_storage_and_truthful_assurance(
    db_session: Session,
) -> None:
    now = datetime.now(UTC)
    settings = sandbox_settings(now)
    generation = settings.sandbox.generation_id
    assert generation is not None
    key = token_urlsafe(32)
    first = issue_sandbox_session(
        db_session, settings=settings, entry_key=key, generation_id=generation, now=now
    )
    retry = issue_sandbox_session(
        db_session, settings=settings, entry_key=key, generation_id=generation, now=now
    )
    second = issue_sandbox_session(
        db_session,
        settings=settings,
        entry_key=token_urlsafe(32),
        generation_id=generation,
        now=now,
    )
    assert first.user.id == retry.user.id
    assert first.session_token == retry.session_token
    assert first.csrf_token == retry.csrf_token
    assert first.user.id != second.user.id
    assert first.user.account_kind == "member"
    assert first.user.handle is not None
    assert first.user.email is not None and first.user.email.endswith(".invalid")
    assert first.expires_at == settings.sandbox.expires_at
    assert db_session.scalar(select(func.count()).select_from(OIDCIdentity)) == 0
    stored = db_session.scalar(select(UserSession).where(UserSession.user_id == first.user.id))
    assert stored is not None
    assert stored.authenticated_at is None
    assert stored.token_digest == token_digest(first.session_token)
    assert stored.csrf_token_digest == token_digest(first.csrf_token)
    entry = db_session.get(SandboxVisitorEntry, token_digest(key))
    assert entry is not None and entry.entry_digest != key
    authenticated = resolve_authenticated_session(
        db_session, settings=settings, raw_session_token=first.session_token, now=now
    )
    assert authenticated is not None and authenticated.temporary
    assert authenticated.authenticated_at is None


def test_guest_retry_never_resurrects_revoked_session(db_session: Session) -> None:
    now = datetime.now(UTC)
    settings = sandbox_settings(now)
    generation = settings.sandbox.generation_id
    assert generation is not None
    key = token_urlsafe(32)
    issued = issue_sandbox_session(
        db_session, settings=settings, entry_key=key, generation_id=generation, now=now
    )
    authenticated = resolve_authenticated_session(
        db_session, settings=settings, raw_session_token=issued.session_token, now=now
    )
    assert authenticated is not None
    revoke_authenticated_session(db_session, authenticated=authenticated, now=now)
    with pytest.raises(DemoEntryExpiredError):
        issue_sandbox_session(
            db_session, settings=settings, entry_key=key, generation_id=generation, now=now
        )


def test_guest_session_expires_when_mode_or_generation_changes(db_session: Session) -> None:
    now = datetime.now(UTC)
    settings = sandbox_settings(now)
    generation = settings.sandbox.generation_id
    assert generation is not None
    issued = issue_sandbox_session(
        db_session,
        settings=settings,
        entry_key=token_urlsafe(32),
        generation_id=generation,
        now=now,
    )
    disabled = settings.model_copy(update={"sandbox_enabled": False})
    replacement = settings.model_copy(update={"sandbox_generation_id": uuid4()})
    for invalid_settings, invalid_time in (
        (disabled, now),
        (replacement, now),
        (settings, now + timedelta(hours=1)),
    ):
        assert (
            resolve_authenticated_session(
                db_session,
                settings=invalid_settings,
                raw_session_token=issued.session_token,
                now=invalid_time,
            )
            is None
        )
    with pytest.raises(DemoUnavailableError):
        issue_sandbox_session(
            db_session,
            settings=disabled,
            entry_key=token_urlsafe(32),
            generation_id=generation,
            now=now,
        )
    with pytest.raises(DemoGenerationChangedError):
        issue_sandbox_session(
            db_session,
            settings=replacement,
            entry_key=token_urlsafe(32),
            generation_id=generation,
            now=now,
        )


@dataclass(frozen=True)
class SandboxApi:
    client: TestClient
    engine: Engine
    settings: Settings


@pytest.fixture(scope="module")
def sandbox_database(postgres_url: str) -> Iterator[tuple[Engine, Settings]]:
    with isolated_postgres_engine(postgres_url) as engine:
        config = make_alembic_config()
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
        settings = sandbox_settings(datetime.now(UTC))
        with Session(engine) as session, session.begin():
            session.add(
                SandboxGeneration(
                    generation_id=settings.sandbox.generation_id,
                    started_at=settings.sandbox.started_at,
                    expires_at=settings.sandbox.expires_at,
                )
            )
        yield engine, settings


@pytest.fixture
def sandbox_api(sandbox_database: tuple[Engine, Settings]) -> Iterator[SandboxApi]:
    engine, original_settings = sandbox_database
    settings = original_settings.model_copy()
    with Session(engine) as session, session.begin():
        session.execute(delete(AbuseRateLimitBucket))
        session.execute(delete(UserSession))
        session.execute(delete(User))
    with application_with_database(engine, expire_on_commit=False) as application:
        application.dependency_overrides[get_settings] = lambda: settings
        application.dependency_overrides[get_sandbox_admission_session] = (
            database_session_dependency(engine)
        )
        with TestClient(application, base_url="https://app.example.test") as client:
            yield SandboxApi(client, engine, settings)


def entry_payload(settings: Settings, entry_key: str | None = None) -> dict[str, str]:
    return {
        "entry_key": entry_key or token_urlsafe(32),
        "generation_id": str(settings.sandbox.generation_id),
    }


def test_entry_status_and_cookies_no_staff_and_no_active_identity_replacement(
    sandbox_api: SandboxApi,
) -> None:
    client = sandbox_api.client
    status = client.get("/api/auth/demo")
    assert status.status_code == 200
    assert status.json()["generation_id"] == str(sandbox_api.settings.sandbox.generation_id)
    assert status.headers["cache-control"] == "no-store"
    headers = {"Origin": "https://app.example.test"}
    first = client.post("/api/auth/demo", json=entry_payload(sandbox_api.settings), headers=headers)
    assert first.status_code == 200
    assert first.json()["status"] == "authenticated"
    assert first.json()["temporary"] is True
    assert first.json()["expires_at"] is not None
    assert first.json()["capabilities"] == {
        "review_ingredient_requests": False,
        "moderate_recipe_reports": False,
    }
    assert first.headers["cache-control"] == "no-store"
    cookies = first.headers.get_list("set-cookie")
    assert any("HttpOnly" in cookie and "Secure" in cookie for cookie in cookies)
    assert all("SameSite=lax" in cookie for cookie in cookies)
    original_cookie = client.cookies.get(AUTH_SESSION_COOKIE_NAME)
    second = client.post(
        "/api/auth/demo", json=entry_payload(sandbox_api.settings), headers=headers
    )
    assert second.status_code == 200
    assert second.json()["user"]["id"] == first.json()["user"]["id"]
    assert "set-cookie" not in second.headers
    assert client.cookies.get(AUTH_SESSION_COOKIE_NAME) == original_cookie
    restored = client.get("/api/auth/session").json()
    assert restored["user"] == first.json()["user"]
    assert restored["temporary"] is True
    assert datetime.fromisoformat(restored["expires_at"]) == datetime.fromisoformat(
        first.json()["expires_at"]
    )
    with Session(sandbox_api.engine) as session:
        assert session.scalar(select(func.count()).select_from(User)) == 1
        assert session.scalar(select(func.count()).select_from(OIDCIdentity)) == 0


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Origin": "https://other.example.test"},
        {"Origin": "https://app.example.test", "Sec-Fetch-Site": "cross-site"},
    ],
)
def test_anonymous_entry_rejects_missing_or_cross_origin_evidence(
    sandbox_api: SandboxApi,
    headers: dict[str, str],
) -> None:
    response = sandbox_api.client.post(
        "/api/auth/demo",
        json=entry_payload(sandbox_api.settings),
        headers=headers,
    )
    assert response.status_code == 403
    with Session(sandbox_api.engine) as session:
        assert session.scalar(select(func.count()).select_from(User)) == 0


def test_guest_sensitive_operations_remain_truthful_and_logout_prevents_retry(
    sandbox_api: SandboxApi,
) -> None:
    client = sandbox_api.client
    payload = entry_payload(sandbox_api.settings)
    headers = {"Origin": "https://app.example.test"}
    entered = client.post("/api/auth/demo", json=payload, headers=headers)
    assert entered.status_code == 200
    assert client.get("/api/auth/reauthenticate").status_code == 403
    csrf = client.cookies.get(AUTH_CSRF_COOKIE_NAME)
    assert csrf is not None
    mutation_headers = {**headers, "X-CSRF-Token": csrf}
    deletion = client.request(
        "DELETE",
        "/api/auth/account",
        headers=mutation_headers,
        json={"confirmation": entered.json()["user"]["handle"]},
    )
    assert deletion.status_code == 403
    assert deletion.json()["error"]["code"] == "demo_sensitive_operation_unavailable"
    assert client.post("/api/auth/logout", headers=headers).status_code == 403
    assert client.post("/api/auth/logout", headers=mutation_headers).status_code == 204
    assert client.cookies.get(AUTH_FORCE_LOGIN_COOKIE_NAME) is None
    assert client.get("/api/auth/session").json() == {"status": "anonymous"}
    replay = client.post("/api/auth/demo", json=payload, headers=headers)
    assert replay.status_code == 409
    assert replay.json()["error"]["code"] == "demo_entry_expired"
    with Session(sandbox_api.engine) as session:
        assert session.scalar(select(func.count()).select_from(User)) == 1


def test_new_identity_does_not_bypass_network_entry_limits(sandbox_api: SandboxApi) -> None:
    sandbox_api.settings.abuse_rate_limit_auth_network = 1
    headers = {"Origin": "https://app.example.test"}
    first = sandbox_api.client.post(
        "/api/auth/demo",
        json=entry_payload(sandbox_api.settings),
        headers=headers,
    )
    assert first.status_code == 200
    sandbox_api.client.cookies.clear()
    limited = sandbox_api.client.post(
        "/api/auth/demo",
        json=entry_payload(sandbox_api.settings),
        headers=headers,
    )
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "rate_limit_exceeded"
    with Session(sandbox_api.engine) as session:
        assert session.scalar(select(func.count()).select_from(User)) == 1


def test_disabled_demo_hides_configuration_and_cannot_issue_a_session(
    sandbox_api: SandboxApi,
) -> None:
    disabled = sandbox_api.settings.model_copy(update={"sandbox_enabled": False})
    with application_with_database(sandbox_api.engine) as application:
        application.dependency_overrides[get_settings] = lambda: disabled
        with TestClient(application, base_url="https://app.example.test") as client:
            response = client.get("/api/auth/demo")
            assert response.status_code == 200
            assert response.json() == {
                "enabled": False,
                "generation_id": None,
                "expires_at": None,
                "contact_url": None,
            }
            denied = client.post(
                "/api/auth/demo",
                json=entry_payload(disabled),
                headers={"Origin": "https://app.example.test"},
            )
            assert denied.status_code == 404
    with Session(sandbox_api.engine) as session:
        assert session.scalar(select(func.count()).select_from(User)) == 0


def test_entry_rejects_previous_generation_before_any_identity_is_created(
    sandbox_api: SandboxApi,
) -> None:
    payload = {**entry_payload(sandbox_api.settings), "generation_id": str(uuid4())}
    response = sandbox_api.client.post(
        "/api/auth/demo",
        json=payload,
        headers={"Origin": "https://app.example.test"},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "demo_generation_changed"
    with Session(sandbox_api.engine) as session:
        assert session.scalar(select(func.count()).select_from(User)) == 0


def test_concurrent_entries_coalesce_retries_and_enforce_generation_capacity(
    sandbox_api: SandboxApi,
) -> None:
    settings = sandbox_api.settings
    settings.sandbox_entry_global_limit = 2
    generation = settings.sandbox.generation_id
    assert generation is not None
    key = token_urlsafe(32)

    def enter(entry_key: str) -> UUID | None:
        with Session(sandbox_api.engine) as session, session.begin():
            try:
                return issue_sandbox_session(
                    session,
                    settings=settings,
                    entry_key=entry_key,
                    generation_id=generation,
                    now=datetime.now(UTC),
                ).user.id
            except DemoCapacityReachedError:
                return None

    with ThreadPoolExecutor(max_workers=4) as pool:
        same = list(pool.map(enter, [key] * 4))
        others = list(pool.map(enter, [token_urlsafe(32) for _ in range(4)]))
    assert same[0] is not None and len(set(same)) == 1
    assert sum(value is not None for value in others) == 1
    with Session(sandbox_api.engine) as session:
        assert session.scalar(select(func.count()).select_from(User)) == 2
        assert session.scalar(select(func.count()).select_from(SandboxVisitorEntry)) == 2
