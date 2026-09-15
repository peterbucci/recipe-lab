from decimal import Decimal
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from sqlalchemy import Connection, Engine, inspect
from sqlalchemy.exc import ProgrammingError

_PREVIOUS_REVISION = "20260911_0031"


def _table_rows(
    connection: Connection,
    table_name: str,
    *order_columns: str,
) -> list[dict[str, object]]:
    metadata = sa.MetaData()
    table = sa.Table(table_name, metadata, autoload_with=connection)
    statement = sa.select(table)
    if order_columns:
        statement = statement.order_by(*(table.c[column] for column in order_columns))
    return [dict(row) for row in connection.execute(statement).mappings()]


def test_stable_recipe_migration_preserves_legacy_rows_and_replays_deterministically(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    original_author_id = uuid4()
    adapter_id = uuid4()
    saver_id = uuid4()
    deleted_author_id = uuid4()
    lineage_id = uuid4()
    deleted_lineage_id = uuid4()
    original_version_id = uuid4()
    unpublished_parent_version_id = uuid4()
    adaptation_version_id = uuid4()
    deleted_version_id = uuid4()

    with empty_postgres_engine.connect() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, _PREVIOUS_REVISION)
        with connection.begin():
            metadata = sa.MetaData()
            users = sa.Table("users", metadata, autoload_with=connection)
            lineages = sa.Table("recipe_lineages", metadata, autoload_with=connection)
            versions = sa.Table("recipe_versions", metadata, autoload_with=connection)
            publications = sa.Table(
                "recipe_version_publications",
                metadata,
                autoload_with=connection,
            )
            saves = sa.Table("recipe_saves", metadata, autoload_with=connection)
            ratings = sa.Table("recipe_ratings", metadata, autoload_with=connection)
            preference_events = sa.Table(
                "preference_events",
                metadata,
                autoload_with=connection,
            )
            connection.execute(
                users.insert(),
                [
                    {
                        "id": original_author_id,
                        "email": "edition-original@example.test",
                        "handle": "edition_original",
                        "display_name": "Edition Original",
                        "account_kind": "member",
                        "status": "active",
                    },
                    {
                        "id": adapter_id,
                        "email": "edition-adapter@example.test",
                        "handle": "edition_adapter",
                        "display_name": "Edition Adapter",
                        "account_kind": "member",
                        "status": "active",
                    },
                    {
                        "id": saver_id,
                        "email": "edition-saver@example.test",
                        "handle": "edition_saver",
                        "display_name": "Edition Saver",
                        "account_kind": "member",
                        "status": "active",
                    },
                ],
            )
            connection.execute(
                users.insert().values(
                    id=deleted_author_id,
                    email=None,
                    handle=None,
                    display_name="Deleted cook",
                    account_kind="member",
                    status="deleted",
                    deleted_at=sa.func.now(),
                )
            )
            connection.execute(
                lineages.insert(),
                [
                    {
                        "id": lineage_id,
                        "created_by_user_id": original_author_id,
                    },
                    {
                        "id": deleted_lineage_id,
                        "created_by_user_id": deleted_author_id,
                    },
                ],
            )
            connection.execute(
                versions.insert(),
                [
                    {
                        "id": original_version_id,
                        "lineage_id": lineage_id,
                        "parent_version_id": None,
                        "created_by_user_id": original_author_id,
                        "version_number": 1,
                        "title": "Preserved original",
                        "description": "Original bytes stay untouched.",
                        "servings": Decimal("4.00"),
                        "notes": "Original notes.",
                    },
                    {
                        "id": unpublished_parent_version_id,
                        "lineage_id": lineage_id,
                        "parent_version_id": original_version_id,
                        "created_by_user_id": original_author_id,
                        "version_number": 2,
                        "title": "Unpublished exact parent",
                        "description": "This valid private snapshot has no publication receipt.",
                        "servings": Decimal("5.00"),
                        "notes": None,
                    },
                    {
                        "id": adaptation_version_id,
                        "lineage_id": lineage_id,
                        "parent_version_id": unpublished_parent_version_id,
                        "created_by_user_id": adapter_id,
                        "version_number": 3,
                        "title": "Preserved adaptation",
                        "description": "Adaptation bytes stay untouched.",
                        "servings": Decimal("6.00"),
                        "notes": "Adaptation notes.",
                    },
                    {
                        "id": deleted_version_id,
                        "lineage_id": deleted_lineage_id,
                        "parent_version_id": None,
                        "created_by_user_id": deleted_author_id,
                        "version_number": 1,
                        "title": "Deleted cook recipe",
                        "description": None,
                        "servings": Decimal("2.00"),
                        "notes": None,
                    },
                ],
            )
            connection.execute(
                publications.insert(),
                [
                    {
                        "recipe_version_id": original_version_id,
                        "actor_user_id": original_author_id,
                    },
                    {
                        "recipe_version_id": adaptation_version_id,
                        "actor_user_id": adapter_id,
                    },
                    {
                        "recipe_version_id": deleted_version_id,
                        "actor_user_id": deleted_author_id,
                    },
                ],
            )
            connection.execute(
                saves.insert().values(
                    user_id=saver_id,
                    recipe_version_id=original_version_id,
                )
            )
            connection.execute(
                ratings.insert().values(
                    user_id=saver_id,
                    recipe_version_id=original_version_id,
                    rating=5,
                )
            )
            connection.execute(
                preference_events.insert().values(
                    id=uuid4(),
                    action_id=uuid4(),
                    user_id=saver_id,
                    recipe_version_id=original_version_id,
                    event_type="view",
                    saved_value=None,
                    rating_value=None,
                    related_recipe_version_id=None,
                    request_fingerprint=None,
                )
            )

        legacy_columns = tuple(
            column["name"] for column in inspect(connection).get_columns("recipe_versions")
        )
        legacy_versions = _table_rows(connection, "recipe_versions", "id")
        legacy_publications = _table_rows(
            connection,
            "recipe_version_publications",
            "recipe_version_id",
        )
        legacy_saves = _table_rows(connection, "recipe_saves", "user_id", "recipe_version_id")
        legacy_ratings = _table_rows(
            connection,
            "recipe_ratings",
            "user_id",
            "recipe_version_id",
        )
        legacy_events = _table_rows(connection, "preference_events", "id")

        command.upgrade(alembic_config, "head")

        assert (
            tuple(column["name"] for column in inspect(connection).get_columns("recipe_versions"))
            == legacy_columns
        )
        assert _table_rows(connection, "recipe_versions", "id") == legacy_versions
        assert (
            _table_rows(connection, "recipe_version_publications", "recipe_version_id")
            == legacy_publications
        )
        assert _table_rows(connection, "recipe_saves", "user_id", "recipe_version_id") == (
            legacy_saves
        )
        assert _table_rows(connection, "recipe_ratings", "user_id", "recipe_version_id") == (
            legacy_ratings
        )
        assert _table_rows(connection, "preference_events", "id") == legacy_events
        recipes_after_upgrade = _table_rows(connection, "recipes", "id")
        editions_after_upgrade = _table_rows(
            connection,
            "recipe_editions",
            "recipe_version_id",
        )
        assert {row["id"] for row in recipes_after_upgrade} == {
            original_version_id,
            adaptation_version_id,
            deleted_version_id,
        }
        assert unpublished_parent_version_id not in {
            row["recipe_version_id"] for row in editions_after_upgrade
        }
        assert all(row["id"] == row["current_recipe_version_id"] for row in recipes_after_upgrade)
        recipes_by_id = {row["id"]: row for row in recipes_after_upgrade}
        assert recipes_by_id[deleted_version_id]["owner_user_id"] is None
        assert recipes_by_id[deleted_version_id]["attributed_author_user_id"] == deleted_author_id
        editions_by_version = {row["recipe_version_id"]: row for row in editions_after_upgrade}
        assert editions_by_version[original_version_id]["relation_kind"] == "original"
        assert editions_by_version[adaptation_version_id]["relation_kind"] == "adaptation"
        assert all(row["edition_number"] == 1 for row in editions_after_upgrade)
        assert all(row["previous_recipe_version_id"] is None for row in editions_after_upgrade)

        command.downgrade(alembic_config, _PREVIOUS_REVISION)
        assert "recipes" not in inspect(connection).get_table_names()
        assert "recipe_editions" not in inspect(connection).get_table_names()
        assert _table_rows(connection, "recipe_versions", "id") == legacy_versions
        assert (
            _table_rows(connection, "recipe_version_publications", "recipe_version_id")
            == legacy_publications
        )
        assert _table_rows(connection, "recipe_saves", "user_id", "recipe_version_id") == (
            legacy_saves
        )
        assert _table_rows(connection, "recipe_ratings", "user_id", "recipe_version_id") == (
            legacy_ratings
        )
        assert _table_rows(connection, "preference_events", "id") == legacy_events

        command.upgrade(alembic_config, "head")
        assert _table_rows(connection, "recipes", "id") == recipes_after_upgrade
        assert (
            _table_rows(
                connection,
                "recipe_editions",
                "recipe_version_id",
            )
            == editions_after_upgrade
        )


def test_stable_recipe_migration_refuses_downgrade_after_a_revision(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    author_id = uuid4()
    lineage_id = uuid4()
    recipe_id = uuid4()
    first_version_id = uuid4()
    second_version_id = uuid4()

    with empty_postgres_engine.connect() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "head")
        with connection.begin():
            connection.execute(
                sa.text(
                    "INSERT INTO users "
                    "(id, email, handle, display_name, account_kind, status) "
                    "VALUES (:id, :email, :handle, :display_name, 'member', 'active')"
                ),
                {
                    "id": author_id,
                    "email": "edition-downgrade@example.test",
                    "handle": "edition_downgrade",
                    "display_name": "Edition Downgrade",
                },
            )
            connection.execute(
                sa.text(
                    "INSERT INTO recipe_lineages (id, created_by_user_id) "
                    "VALUES (:lineage_id, :author_id)"
                ),
                {"lineage_id": lineage_id, "author_id": author_id},
            )
            connection.execute(
                sa.text(
                    "INSERT INTO recipe_versions "
                    "(id, lineage_id, parent_version_id, created_by_user_id, version_number, "
                    "title, servings) VALUES "
                    "(:first_id, :lineage_id, NULL, :author_id, 1, 'First edition', 2.00), "
                    "(:second_id, :lineage_id, NULL, :author_id, 2, 'Second edition', 2.00)"
                ),
                {
                    "first_id": first_version_id,
                    "second_id": second_version_id,
                    "lineage_id": lineage_id,
                    "author_id": author_id,
                },
            )
            connection.execute(
                sa.text(
                    "INSERT INTO recipes "
                    "(id, lineage_id, attributed_author_user_id, owner_user_id, "
                    "current_recipe_version_id) VALUES "
                    "(:recipe_id, :lineage_id, :author_id, :author_id, :second_id)"
                ),
                {
                    "recipe_id": recipe_id,
                    "lineage_id": lineage_id,
                    "author_id": author_id,
                    "second_id": second_version_id,
                },
            )
            connection.execute(
                sa.text(
                    "INSERT INTO recipe_version_publications (recipe_version_id, actor_user_id) "
                    "VALUES (:first_id, :author_id), (:second_id, :author_id)"
                ),
                {
                    "first_id": first_version_id,
                    "second_id": second_version_id,
                    "author_id": author_id,
                },
            )
            connection.execute(
                sa.text(
                    "INSERT INTO recipe_editions "
                    "(recipe_version_id, recipe_id, lineage_id, attributed_author_user_id, "
                    "edition_number, relation_kind, previous_recipe_version_id, "
                    "declared_change_reason) VALUES "
                    "(:first_id, :recipe_id, :lineage_id, :author_id, 1, 'original', NULL, NULL), "
                    "(:second_id, :recipe_id, :lineage_id, :author_id, 2, 'revision', "
                    ":first_id, 'update')"
                ),
                {
                    "first_id": first_version_id,
                    "second_id": second_version_id,
                    "recipe_id": recipe_id,
                    "lineage_id": lineage_id,
                    "author_id": author_id,
                },
            )
            connection.execute(sa.text("SET CONSTRAINTS ALL IMMEDIATE"))

        with pytest.raises(
            ProgrammingError,
            match=(
                "cannot downgrade stable recipe editions with multiple "
                "parent-null versions in one lineage"
            ),
        ):
            command.downgrade(alembic_config, _PREVIOUS_REVISION)
