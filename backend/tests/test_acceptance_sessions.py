import json
import os
import stat
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import token_digest
from app.models import (
    ACCOUNT_KIND_MEMBER,
    USER_STATUS_ACTIVE,
    CatalogCurator,
    User,
    UserSession,
)
from app.testing.acceptance_sessions import (
    ACCEPTANCE_MEMBERS,
    ACCEPTANCE_SESSION_TTL,
    AcceptanceFixture,
    AcceptanceHarnessError,
    provision_acceptance_sessions,
    validate_acceptance_environment,
    validate_output_path,
    write_acceptance_fixture,
)


def guarded_environment(database_name: str) -> dict[str, str]:
    return {
        "MVP_ACCEPTANCE": "1",
        "ACCEPTANCE_DATABASE_ISOLATED": "1",
        "DATABASE_URL": (
            f"postgresql+psycopg://recipe_lab:recipe_lab@127.0.0.1:5432/{database_name}"
        ),
    }


@pytest.mark.parametrize(
    "database_name",
    ["recipe_lab_acceptance", "recipe_lab_acceptance_local"],
)
def test_acceptance_guard_accepts_only_documented_database_names(database_name: str) -> None:
    environment = guarded_environment(database_name)

    assert validate_acceptance_environment(environment) == environment["DATABASE_URL"]


@pytest.mark.parametrize(
    ("environment", "message"),
    [
        ({}, "MVP_ACCEPTANCE=1"),
        (
            {
                "MVP_ACCEPTANCE": "1",
                "DATABASE_URL": "postgresql+psycopg://localhost/recipe_lab_acceptance",
            },
            "ACCEPTANCE_DATABASE_ISOLATED=1",
        ),
        (
            {
                "MVP_ACCEPTANCE": "1",
                "ACCEPTANCE_DATABASE_ISOLATED": "1",
                "DATABASE_URL": "sqlite:///recipe_lab_acceptance.db",
            },
            "must use PostgreSQL",
        ),
        (guarded_environment("recipe_lab"), "Refusing non-acceptance database"),
        (guarded_environment("recipe_lab_acceptance_backup"), "Refusing non-acceptance database"),
    ],
)
def test_acceptance_guard_refuses_unsafe_environments(
    environment: dict[str, str],
    message: str,
) -> None:
    with pytest.raises(AcceptanceHarnessError, match=message):
        validate_acceptance_environment(environment)


def test_provisioner_creates_members_and_one_curator_with_digest_only_sessions(
    db_session: Session,
) -> None:
    issued_at = datetime(2026, 8, 23, 16, 0, tzinfo=UTC)

    fixture = provision_acceptance_sessions(db_session, now=issued_at)

    assert fixture["version"] == 2
    assert set(fixture["members"]) == {"alice", "bob", "curator"}
    assert all(
        set(member_fixture) == {"user_id", "session_token", "csrf_token"}
        for member_fixture in fixture["members"].values()
    )

    for definition in ACCEPTANCE_MEMBERS:
        member_fixture = fixture["members"][definition.key]
        user = db_session.get(User, definition.user_id)
        assert user is not None
        assert member_fixture["user_id"] == str(user.id)
        assert user.account_kind == ACCOUNT_KIND_MEMBER
        assert user.status == USER_STATUS_ACTIVE
        assert user.handle == definition.handle
        assert user.display_name == definition.display_name

        stored_session = db_session.scalar(
            select(UserSession).where(UserSession.user_id == definition.user_id)
        )
        assert stored_session is not None
        assert stored_session.token_digest == token_digest(member_fixture["session_token"])
        assert stored_session.csrf_token_digest == token_digest(member_fixture["csrf_token"])
        assert stored_session.token_digest != member_fixture["session_token"]
        assert stored_session.csrf_token_digest != member_fixture["csrf_token"]
        assert stored_session.created_at == issued_at
        assert stored_session.expires_at == issued_at + ACCEPTANCE_SESSION_TTL

        grant = db_session.get(CatalogCurator, definition.user_id)
        assert (grant is not None) is definition.catalog_curator


def test_reprovisioner_replaces_only_fixture_member_sessions(db_session: Session) -> None:
    first = provision_acceptance_sessions(db_session)
    first_digests = {token_digest(member["session_token"]) for member in first["members"].values()}

    second = provision_acceptance_sessions(db_session)
    second_digests = {
        token_digest(member["session_token"]) for member in second["members"].values()
    }
    stored_digests = set(db_session.scalars(select(UserSession.token_digest)))

    assert first_digests.isdisjoint(second_digests)
    assert stored_digests == second_digests


def test_fixture_file_is_private_exclusive_and_contains_no_identity_data(tmp_path: Path) -> None:
    fixture: AcceptanceFixture = {
        "version": 2,
        "members": {
            "alice": {
                "user_id": "alice-id",
                "session_token": "alice-session",
                "csrf_token": "alice-csrf",
            },
            "bob": {
                "user_id": "bob-id",
                "session_token": "bob-session",
                "csrf_token": "bob-csrf",
            },
            "curator": {
                "user_id": "curator-id",
                "session_token": "curator-session",
                "csrf_token": "curator-csrf",
            },
        },
    }
    output_path = tmp_path / "recipe-lab-acceptance-sessions.json"

    write_acceptance_fixture(output_path, fixture)

    assert json.loads(output_path.read_text(encoding="utf-8")) == fixture
    assert "email" not in output_path.read_text(encoding="utf-8")
    assert "provider" not in output_path.read_text(encoding="utf-8")
    if os.name != "nt":
        assert stat.S_IMODE(output_path.stat().st_mode) == stat.S_IRUSR | stat.S_IWUSR
    with pytest.raises(AcceptanceHarnessError, match="already exists"):
        write_acceptance_fixture(output_path, fixture)


def test_output_path_must_be_inside_a_configured_temp_directory(tmp_path: Path) -> None:
    environment = {"RUNNER_TEMP": str(tmp_path)}
    expected = tmp_path / "recipe-lab-acceptance-sessions.json"

    assert validate_output_path(expected, environment) == expected.resolve()
    with pytest.raises(AcceptanceHarnessError, match="temporary directory"):
        validate_output_path(Path.home() / "acceptance-secrets.json", environment)
