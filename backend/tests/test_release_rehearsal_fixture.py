from collections.abc import Mapping

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Connection, Engine, inspect, text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from app.seeds import load_bundled_catalog, seed_catalog
from app.testing.community_release_gate import stage_demo_activity
from tests.release_rehearsal_fixture import (
    FIXTURE_INGREDIENT_ID,
    FIXTURE_RECIPE_ID,
    FIXTURE_USER_ID,
    START_REVISION,
    catalog_counts,
    seed_historical_fixture,
    validate_fixture_environment,
)


@pytest.mark.parametrize(
    "database", ["recipe_lab_rcp32_acceptance", "recipe_lab_rcp33g_migration_failure"]
)
def test_historical_fixture_allows_only_named_disposable_targets(database: str) -> None:
    url = f"postgresql+psycopg://localhost/{database}"
    assert (
        validate_fixture_environment({"ACCEPTANCE_DATABASE_ISOLATED": "1", "DATABASE_URL": url})
        == url
    )


@pytest.mark.parametrize(
    "environment",
    [
        {},
        {"DATABASE_URL": "postgresql://localhost/recipe_lab_rcp32_acceptance"},
        {"ACCEPTANCE_DATABASE_ISOLATED": "1"},
        {"ACCEPTANCE_DATABASE_ISOLATED": "1", "DATABASE_URL": "not-a-url"},
        {"ACCEPTANCE_DATABASE_ISOLATED": "1", "DATABASE_URL": "sqlite://"},
        {"ACCEPTANCE_DATABASE_ISOLATED": "1", "DATABASE_URL": "postgresql://localhost/recipe_lab"},
    ],
)
def test_historical_fixture_refuses_unguarded_targets(environment: Mapping[str, str]) -> None:
    with pytest.raises(ValueError):
        validate_fixture_environment(environment)


def _fixture_rows(connection: Connection) -> list[tuple[object, ...]]:
    return [
        tuple(
            connection.execute(
                text(
                    "SELECT id, email, display_name, account_kind, status FROM users WHERE id = :id"
                ),
                {"id": FIXTURE_USER_ID},
            ).one()
        ),
        tuple(
            connection.execute(
                text(
                    "SELECT id, lineage_id, created_by_user_id, version_number, title, servings "
                    "FROM recipe_versions WHERE id = :id"
                ),
                {"id": FIXTURE_RECIPE_ID},
            ).one()
        ),
        tuple(
            connection.execute(
                text("SELECT id, canonical_name FROM ingredients WHERE id = :id"),
                {"id": FIXTURE_INGREDIENT_ID},
            ).one()
        ),
    ]


@pytest.mark.parametrize(
    "conflicted_migration", [False, True], ids=["upgrade", "failed-then-retry"]
)
def test_historical_fixture_survives_real_migrations(
    empty_postgres_engine: Engine, alembic_config: Config, conflicted_migration: bool
) -> None:
    with empty_postgres_engine.connect() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, START_REVISION)
        with connection.begin():
            assert "profile_description" not in {
                column["name"] for column in inspect(connection).get_columns("users")
            }
            seed_historical_fixture(connection)
            before_counts = catalog_counts(connection)
            assert before_counts[0] == before_counts[3] == 1
            assert all(count > 0 for count in before_counts)
            before_rows = _fixture_rows(connection)
            with pytest.raises(ValueError, match="empty user, recipe and ingredient"):
                seed_historical_fixture(connection)

        if conflicted_migration:
            with connection.begin():
                connection.execute(
                    text("ALTER TABLE recipe_drafts ADD COLUMN creation_action_id uuid")
                )
            with pytest.raises(ProgrammingError, match="creation_action_id.*already exists"):
                command.upgrade(alembic_config, "head")
            with connection.begin():
                assert (
                    connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
                    == START_REVISION
                )
                assert catalog_counts(connection) == before_counts
                assert _fixture_rows(connection) == before_rows
                connection.execute(text("ALTER TABLE recipe_drafts DROP COLUMN creation_action_id"))

        command.upgrade(alembic_config, "head")
        command.check(alembic_config)
        with connection.begin():
            assert (
                connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
                == ScriptDirectory.from_config(alembic_config).get_current_head()
            )
            assert catalog_counts(connection) == before_counts
            assert _fixture_rows(connection) == before_rows
            assert (
                connection.execute(
                    text("SELECT profile_description FROM users WHERE id = :id"),
                    {"id": FIXTURE_USER_ID},
                ).scalar_one()
                is None
            )
            with pytest.raises(ValueError, match="exactly revision"):
                seed_historical_fixture(connection)

    # The later browser journey still gets the full current demo data, without
    # using that loader to populate the historical-schema preservation fixture.
    with Session(bind=empty_postgres_engine) as session, session.begin():
        seed_catalog(session, load_bundled_catalog())
        stage_demo_activity(session)
    with empty_postgres_engine.connect() as connection:
        assert _fixture_rows(connection) == before_rows
