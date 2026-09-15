from decimal import Decimal
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, inspect

from app.services.recipe_drafts import recipe_draft_creation_request_fingerprint

_PREVIOUS_REVISION = "20260914_0032"


def _legacy_drafts(
    connection: sa.Connection,
) -> tuple[UUID, UUID, UUID, UUID]:
    metadata = sa.MetaData()
    users = sa.Table("users", metadata, autoload_with=connection)
    lineages = sa.Table("recipe_lineages", metadata, autoload_with=connection)
    versions = sa.Table("recipe_versions", metadata, autoload_with=connection)
    drafts = sa.Table("recipe_drafts", metadata, autoload_with=connection)
    user_id = uuid4()
    lineage_id = uuid4()
    source_id = uuid4()
    original_id = uuid4()
    adaptation_id = uuid4()
    connection.execute(
        users.insert().values(
            id=user_id,
            email="draft-kind@example.test",
            handle="draft_kind",
            display_name="Draft Kind",
            account_kind="member",
            status="active",
        )
    )
    connection.execute(lineages.insert().values(id=lineage_id, created_by_user_id=user_id))
    connection.execute(
        versions.insert().values(
            id=source_id,
            lineage_id=lineage_id,
            parent_version_id=None,
            created_by_user_id=user_id,
            version_number=1,
            title="Exact source",
            servings=Decimal("1.00"),
        )
    )
    connection.execute(
        drafts.insert(),
        (
            {
                "id": original_id,
                "author_user_id": user_id,
                "source_version_id": None,
                "creation_action_id": uuid4(),
                "creation_request_fingerprint": "a" * 64,
                "status": "active",
                "revision": 1,
                "title": "Original draft",
            },
            {
                "id": adaptation_id,
                "author_user_id": user_id,
                "source_version_id": source_id,
                "creation_action_id": uuid4(),
                "creation_request_fingerprint": "b" * 64,
                "status": "active",
                "revision": 1,
                "title": "Adaptation draft",
            },
        ),
    )
    return user_id, source_id, original_id, adaptation_id


def test_draft_kind_migration_backfills_shape_and_rebinds_creation_intent(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    with empty_postgres_engine.connect() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, _PREVIOUS_REVISION)
        with connection.begin():
            _user_id, source_id, original_id, adaptation_id = _legacy_drafts(connection)

        command.upgrade(alembic_config, "head")
        rows = {
            row.id: row
            for row in connection.execute(
                sa.text(
                    "SELECT id, draft_kind, source_version_id, "
                    "creation_request_fingerprint FROM recipe_drafts ORDER BY id"
                )
            )
        }
        assert rows[original_id].draft_kind == "original"
        assert rows[adaptation_id].draft_kind == "adaptation"
        assert rows[original_id].creation_request_fingerprint == (
            recipe_draft_creation_request_fingerprint("original", None)
        )
        assert rows[adaptation_id].creation_request_fingerprint == (
            recipe_draft_creation_request_fingerprint("adaptation", source_id)
        )
        checks = {
            item["name"] for item in inspect(connection).get_check_constraints("recipe_drafts")
        }
        assert "ck_recipe_drafts_draft_kind_supported" in checks
        assert "ck_recipe_drafts_draft_kind_source_shape_valid" in checks

        command.downgrade(alembic_config, _PREVIOUS_REVISION)
        assert "draft_kind" not in {
            column["name"] for column in inspect(connection).get_columns("recipe_drafts")
        }


def test_draft_kind_downgrade_fails_closed_when_revision_intent_exists(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    with empty_postgres_engine.connect() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, _PREVIOUS_REVISION)
        with connection.begin():
            _user_id, source_id, _original_id, adaptation_id = _legacy_drafts(connection)
        command.upgrade(alembic_config, "head")
        with connection.begin():
            connection.execute(
                sa.text(
                    "UPDATE recipe_drafts SET draft_kind = 'revision', "
                    "creation_request_fingerprint = :fingerprint WHERE id = :id"
                ),
                {
                    "id": adaptation_id,
                    "fingerprint": recipe_draft_creation_request_fingerprint("revision", source_id),
                },
            )

        with pytest.raises(
            RuntimeError,
            match="cannot downgrade recipe draft kinds while revision drafts exist",
        ):
            command.downgrade(alembic_config, _PREVIOUS_REVISION)
