from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, inspect

DOMAIN_TABLES = {
    "recipe_lineages",
    "recipe_ratings",
    "recipe_saves",
    "recipe_version_ingredients",
    "recipe_version_instructions",
    "recipe_versions",
    "users",
}


def test_migrations_round_trip_on_empty_postgres_schema(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    script = ScriptDirectory.from_config(alembic_config)

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "head")
        current_revision = MigrationContext.configure(connection).get_current_revision()

    assert current_revision == script.get_current_head()
    assert DOMAIN_TABLES <= set(inspect(empty_postgres_engine).get_table_names())

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.downgrade(alembic_config, "base")

    assert DOMAIN_TABLES.isdisjoint(inspect(empty_postgres_engine).get_table_names())

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "head")
        current_revision = MigrationContext.configure(connection).get_current_revision()

    assert current_revision == script.get_current_head()
    assert DOMAIN_TABLES <= set(inspect(empty_postgres_engine).get_table_names())
