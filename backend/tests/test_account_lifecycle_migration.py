from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    RecipeLineage,
    RecipeModerationAuditEvent,
    RecipeModerationCase,
    RecipeVersion,
    RecipeVersionPublication,
    User,
)
from app.repositories.account_lifecycle import DELETED_MODERATION_FINGERPRINT


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


def test_deleted_moderator_audit_scrub_migration_preserves_append_only_evidence(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    now = datetime.now(UTC)
    actor_id = uuid4()
    already_deleted_actor_id = uuid4()
    version_id = uuid4()

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260826_0018")

    with Session(bind=empty_postgres_engine) as setup, setup.begin():
        setup.add(
            User(
                id=actor_id,
                email="moderator@example.test",
                display_name="Moderator",
                handle="moderator",
            )
        )
        setup.add(
            User(
                id=already_deleted_actor_id,
                email=None,
                display_name="Deleted cook",
                handle=None,
                status="deleted",
                deleted_at=now,
            )
        )
        setup.flush()
        lineage = RecipeLineage(created_by_user_id=actor_id)
        setup.add(lineage)
        setup.flush()
        setup.add(
            RecipeVersion(
                id=version_id,
                lineage_id=lineage.id,
                parent_version_id=None,
                created_by_user_id=actor_id,
                version_number=1,
                title="Moderated recipe",
                description=None,
                servings=Decimal("1.00"),
            )
        )
        setup.flush()
        setup.add(
            RecipeVersionPublication(
                recipe_version_id=version_id,
                actor_user_id=actor_id,
                state_changed_by_user_id=actor_id,
            )
        )
        setup.flush()
        setup.add(
            RecipeModerationCase(
                recipe_version_id=version_id,
                status="open",
                opened_at=now,
                reporter_count=1,
                last_reported_at=now,
                updated_at=now,
            )
        )
        setup.flush()
        event = RecipeModerationAuditEvent(
            recipe_version_id=version_id,
            actor_user_id=actor_id,
            action="hide",
            previous_status="open",
            status="open",
            visibility_state="moderation_hidden",
            private_note="Private deletion migration note.",
            action_id=uuid4(),
            request_fingerprint="c" * 64,
            occurred_at=now,
        )
        setup.add(event)
        already_deleted_event = RecipeModerationAuditEvent(
            recipe_version_id=version_id,
            actor_user_id=already_deleted_actor_id,
            action="resolve",
            previous_status="open",
            status="resolved",
            visibility_state="published",
            private_note="Legacy private note must be backfilled away.",
            action_id=uuid4(),
            request_fingerprint="d" * 64,
            occurred_at=now,
        )
        setup.add(already_deleted_event)
        setup.flush()
        event_id = event.id
        already_deleted_event_id = already_deleted_event.id

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        with pytest.raises(IntegrityError, match="append-only"), connection.begin_nested():
            connection.execute(
                text(
                    "UPDATE recipe_moderation_audit_events "
                    "SET private_note = NULL WHERE id = :event_id"
                ),
                {"event_id": event_id},
            )

        command.upgrade(alembic_config, "20260827_0019")
        backfilled = connection.execute(
            text(
                "SELECT private_note, request_fingerprint "
                "FROM recipe_moderation_audit_events WHERE id = :event_id"
            ),
            {"event_id": already_deleted_event_id},
        ).one()
        assert backfilled.private_note is None
        assert backfilled.request_fingerprint == DELETED_MODERATION_FINGERPRINT
        with pytest.raises(IntegrityError, match="append-only"), connection.begin_nested():
            connection.execute(
                text(
                    "UPDATE recipe_moderation_audit_events "
                    "SET private_note = NULL, request_fingerprint = :fingerprint "
                    "WHERE id = :event_id"
                ),
                {
                    "event_id": event_id,
                    "fingerprint": DELETED_MODERATION_FINGERPRINT,
                },
            )
        connection.execute(
            text(
                "UPDATE users SET status = 'deleted', deleted_at = :deleted_at, "
                "email = NULL, handle = NULL, display_name = 'Deleted cook' "
                "WHERE id = :actor_id"
            ),
            {"actor_id": actor_id, "deleted_at": now},
        )
        connection.execute(
            text(
                "UPDATE recipe_moderation_audit_events "
                "SET private_note = NULL, request_fingerprint = :fingerprint "
                "WHERE id = :event_id"
            ),
            {
                "event_id": event_id,
                "fingerprint": DELETED_MODERATION_FINGERPRINT,
            },
        )
        scrubbed = connection.execute(
            text(
                "SELECT actor_user_id, action, private_note, request_fingerprint "
                "FROM recipe_moderation_audit_events WHERE id = :event_id"
            ),
            {"event_id": event_id},
        ).one()
        assert scrubbed.actor_user_id == actor_id
        assert scrubbed.action == "hide"
        assert scrubbed.private_note is None
        assert scrubbed.request_fingerprint == DELETED_MODERATION_FINGERPRINT

        with pytest.raises(IntegrityError, match="append-only"), connection.begin_nested():
            connection.execute(
                text(
                    "UPDATE recipe_moderation_audit_events "
                    "SET action = 'restore' WHERE id = :event_id"
                ),
                {"event_id": event_id},
            )
        with pytest.raises(IntegrityError, match="append-only"), connection.begin_nested():
            connection.execute(
                text("DELETE FROM recipe_moderation_audit_events WHERE id = :event_id"),
                {"event_id": event_id},
            )

        command.downgrade(alembic_config, "20260826_0018")
        with pytest.raises(IntegrityError, match="append-only"), connection.begin_nested():
            connection.execute(
                text(
                    "UPDATE recipe_moderation_audit_events "
                    "SET request_fingerprint = :fingerprint WHERE id = :event_id"
                ),
                {
                    "event_id": event_id,
                    "fingerprint": DELETED_MODERATION_FINGERPRINT,
                },
            )
