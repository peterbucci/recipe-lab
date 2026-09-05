from typing import cast
from uuid import uuid4

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Connection, Engine, Index, Table, inspect, text
from sqlalchemy.schema import CreateSchema, DropSchema

from app.models import (
    PreferenceEvent,
    RecipeModerationCase,
    RecipeRating,
    RecipeVersion,
    RecipeVersionPublication,
)

_PUBLICATION_NEWEST_INDEX = "ix_recipe_version_publications_state_newest"
_MODERATION_QUEUE_INDEX = "ix_recipe_moderation_cases_status_reported"
_RECIPE_TITLE_SEARCH_INDEX = "ix_recipe_versions_title_trgm"
_RECIPE_DESCRIPTION_SEARCH_INDEX = "ix_recipe_versions_description_trgm"
_PREFERENCE_RECIPE_INDEX = "ix_preference_events_user_recipe_version"
_PREFERENCE_RELATED_INDEX = "ix_preference_events_user_related_recipe_version"
_RATING_PROFILE_INDEX = "ix_recipe_ratings_user_positive_profile"


def _model_indexes(table: Table) -> dict[str, Index]:
    return {str(index.name): index for index in table.indexes if index.name is not None}


def _database_index_names(engine: Engine, table_name: str) -> set[str]:
    return {
        str(index["name"])
        for index in inspect(engine).get_indexes(table_name)
        if index["name"] is not None
    }


def _pg_trgm_schema(connection: Connection) -> str | None:
    value = connection.scalar(
        text(
            "SELECT namespace.nspname "
            "FROM pg_extension AS extension "
            "JOIN pg_namespace AS namespace ON namespace.oid = extension.extnamespace "
            "WHERE extension.extname = 'pg_trgm'"
        )
    )
    return None if value is None else str(value)


def test_high_growth_indexes_match_orm_metadata() -> None:
    recipe_indexes = _model_indexes(cast(Table, RecipeVersion.__table__))
    publication_indexes = _model_indexes(cast(Table, RecipeVersionPublication.__table__))
    moderation_indexes = _model_indexes(cast(Table, RecipeModerationCase.__table__))
    preference_indexes = _model_indexes(cast(Table, PreferenceEvent.__table__))
    rating_indexes = _model_indexes(cast(Table, RecipeRating.__table__))

    assert (
        recipe_indexes[_RECIPE_TITLE_SEARCH_INDEX].dialect_options["postgresql"]["using"] == "gin"
    )
    assert recipe_indexes[_RECIPE_TITLE_SEARCH_INDEX].dialect_options["postgresql"]["ops"] == {
        "title": "gin_trgm_ops"
    }
    assert (
        recipe_indexes[_RECIPE_DESCRIPTION_SEARCH_INDEX].dialect_options["postgresql"]["using"]
        == "gin"
    )
    assert recipe_indexes[_RECIPE_DESCRIPTION_SEARCH_INDEX].dialect_options["postgresql"][
        "ops"
    ] == {"description": "gin_trgm_ops"}
    assert [
        str(expression) for expression in publication_indexes[_PUBLICATION_NEWEST_INDEX].expressions
    ] == [
        "recipe_version_publications.state",
        "published_at DESC",
        "recipe_version_publications.recipe_version_id",
    ]
    assert [
        str(expression) for expression in moderation_indexes[_MODERATION_QUEUE_INDEX].expressions
    ] == [
        "recipe_moderation_cases.status",
        "last_reported_at DESC",
        "recipe_moderation_cases.recipe_version_id",
    ]
    assert [
        str(expression) for expression in preference_indexes[_PREFERENCE_RECIPE_INDEX].expressions
    ] == [
        "preference_events.user_id",
        "preference_events.recipe_version_id",
    ]
    assert (
        preference_indexes[_PREFERENCE_RELATED_INDEX]
        .dialect_options["postgresql"]["where"]
        .compare(text("related_recipe_version_id IS NOT NULL"))
    )
    assert [
        str(expression) for expression in rating_indexes[_RATING_PROFILE_INDEX].expressions
    ] == [
        "recipe_ratings.user_id",
        "rating DESC",
        "created_at DESC",
        "recipe_ratings.recipe_version_id",
    ]


def test_high_growth_index_migration_is_the_single_linear_head(
    alembic_config: Config,
) -> None:
    script = ScriptDirectory.from_config(alembic_config)
    revision = script.get_revision("20260902_0030")

    assert script.get_heads() == ["20260902_0030"]
    assert revision.down_revision == "20260902_0029"


def test_high_growth_index_migration_upgrades_and_downgrades(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    created_extension_schema: str | None = None
    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260902_0029")
        current_schema = connection.scalar(text("SELECT current_schema()"))
        extension_schema = _pg_trgm_schema(connection)
        if extension_schema is None:
            extension_schema = f"recipe_lab_extension_{uuid4().hex}"
            connection.execute(CreateSchema(extension_schema))
            quoted_schema = connection.dialect.identifier_preparer.quote(extension_schema)
            connection.execute(text(f"CREATE EXTENSION pg_trgm WITH SCHEMA {quoted_schema}"))
            created_extension_schema = extension_schema

        # A cluster-scoped extension can live outside this fixture's isolated
        # search path. The migration must resolve its operator class there.
        assert extension_schema != current_schema

    try:
        assert _RECIPE_TITLE_SEARCH_INDEX not in _database_index_names(
            empty_postgres_engine, "recipe_versions"
        )

        with empty_postgres_engine.begin() as connection:
            alembic_config.attributes["connection"] = connection
            command.upgrade(alembic_config, "20260902_0030")
            assert _pg_trgm_schema(connection) == extension_schema

        assert {
            _RECIPE_TITLE_SEARCH_INDEX,
            _RECIPE_DESCRIPTION_SEARCH_INDEX,
        } <= _database_index_names(empty_postgres_engine, "recipe_versions")
        assert _PUBLICATION_NEWEST_INDEX in _database_index_names(
            empty_postgres_engine, "recipe_version_publications"
        )
        assert _MODERATION_QUEUE_INDEX in _database_index_names(
            empty_postgres_engine, "recipe_moderation_cases"
        )
        assert {
            _PREFERENCE_RECIPE_INDEX,
            _PREFERENCE_RELATED_INDEX,
        } <= _database_index_names(empty_postgres_engine, "preference_events")
        assert _RATING_PROFILE_INDEX in _database_index_names(
            empty_postgres_engine, "recipe_ratings"
        )

        with empty_postgres_engine.begin() as connection:
            alembic_config.attributes["connection"] = connection
            command.downgrade(alembic_config, "20260902_0029")

        assert _RECIPE_TITLE_SEARCH_INDEX not in _database_index_names(
            empty_postgres_engine, "recipe_versions"
        )
        assert _PUBLICATION_NEWEST_INDEX not in _database_index_names(
            empty_postgres_engine, "recipe_version_publications"
        )
        assert _MODERATION_QUEUE_INDEX not in _database_index_names(
            empty_postgres_engine, "recipe_moderation_cases"
        )
        assert _PREFERENCE_RECIPE_INDEX not in _database_index_names(
            empty_postgres_engine, "preference_events"
        )
        assert _PREFERENCE_RELATED_INDEX not in _database_index_names(
            empty_postgres_engine, "preference_events"
        )
        assert _RATING_PROFILE_INDEX not in _database_index_names(
            empty_postgres_engine, "recipe_ratings"
        )
    finally:
        if created_extension_schema is not None:
            with empty_postgres_engine.begin() as connection:
                connection.execute(text("DROP EXTENSION IF EXISTS pg_trgm CASCADE"))
                connection.execute(
                    DropSchema(
                        created_extension_schema,
                        cascade=True,
                        if_exists=True,
                    )
                )
