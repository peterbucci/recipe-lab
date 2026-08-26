from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, inspect, text
from sqlalchemy.exc import IntegrityError


def test_account_lifecycle_migration_backfills_and_enforces_private_tombstones(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    legacy_deleted_id = uuid4()
    active_user_id = uuid4()
    session_id = uuid4()
    created_at = datetime.now(UTC) - timedelta(hours=1)

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260826_0016")
        connection.execute(
            text(
                "INSERT INTO users "
                "(id, email, display_name, handle, account_kind, status) "
                "VALUES (:id, :email, :display_name, :handle, 'member', 'deleted')"
            ),
            {
                "id": legacy_deleted_id,
                "email": "legacy-deleted@example.test",
                "display_name": "Legacy Deleted Cook",
                "handle": "legacy-deleted-cook",
            },
        )
        connection.execute(
            text(
                "INSERT INTO users "
                "(id, email, display_name, handle, account_kind, status) "
                "VALUES (:id, :email, :display_name, :handle, 'member', 'active')"
            ),
            {
                "id": active_user_id,
                "email": "active@example.test",
                "display_name": "Active Cook",
                "handle": "active-cook",
            },
        )
        connection.execute(
            text(
                "INSERT INTO user_sessions "
                "(id, user_id, token_digest, csrf_token_digest, expires_at, "
                "last_seen_at, created_at) "
                "VALUES (:id, :user_id, :token, :csrf, :expires_at, "
                ":created_at, :created_at)"
            ),
            {
                "id": session_id,
                "user_id": active_user_id,
                "token": "a" * 64,
                "csrf": "b" * 64,
                "expires_at": created_at + timedelta(days=1),
                "created_at": created_at,
            },
        )

        command.upgrade(alembic_config, "20260826_0017")

        migrated_user = connection.execute(
            text("SELECT email, handle, display_name, deleted_at FROM users WHERE id = :id"),
            {"id": legacy_deleted_id},
        ).one()
        assert migrated_user.email is None
        assert migrated_user.handle is None
        assert migrated_user.display_name == "Deleted cook"
        assert migrated_user.deleted_at is not None
        authenticated_at = connection.execute(
            text("SELECT authenticated_at FROM user_sessions WHERE id = :id"),
            {"id": session_id},
        ).scalar_one()
        assert authenticated_at is None

        with pytest.raises(IntegrityError), connection.begin_nested():
            connection.execute(
                text("UPDATE users SET status = 'deleted' WHERE id = :id"),
                {"id": active_user_id},
            )

    inspector = inspect(empty_postgres_engine)
    user_columns = {column["name"]: column for column in inspector.get_columns("users")}
    session_columns = {column["name"]: column for column in inspector.get_columns("user_sessions")}
    transaction_columns = {
        column["name"]: column for column in inspector.get_columns("oidc_login_transactions")
    }
    assert user_columns["email"]["nullable"] is True
    assert user_columns["deleted_at"]["nullable"] is True
    assert session_columns["authenticated_at"]["nullable"] is True
    assert transaction_columns["purpose"]["nullable"] is False
    assert transaction_columns["bound_session_id"]["nullable"] is True
    assert any(
        str(constraint["name"]).endswith("lifecycle_shape_valid")
        for constraint in inspector.get_check_constraints("users")
    )
    assert any(
        str(constraint["name"]).endswith("purpose_binding_valid")
        for constraint in inspector.get_check_constraints("oidc_login_transactions")
    )

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.downgrade(alembic_config, "20260826_0016")
        restored_email = connection.execute(
            text("SELECT email FROM users WHERE id = :id"),
            {"id": legacy_deleted_id},
        ).scalar_one()
        assert restored_email.startswith("deleted+")
        assert restored_email.endswith("@deleted.invalid")
