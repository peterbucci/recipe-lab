from decimal import Decimal
from uuid import UUID, uuid4

import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, inspect

DOMAIN_TABLES = {
    "allergens",
    "dietary_flags",
    "ingredient_aliases",
    "ingredient_allergens",
    "ingredient_categories",
    "ingredient_dietary_flags",
    "ingredient_substitutions",
    "ingredients",
    "preference_events",
    "recipe_lineages",
    "recipe_ratings",
    "recipe_saves",
    "recipe_version_ingredients",
    "recipe_version_instructions",
    "recipe_versions",
    "users",
}

INGREDIENT_TABLES = {
    "allergens",
    "dietary_flags",
    "ingredient_aliases",
    "ingredient_allergens",
    "ingredient_categories",
    "ingredient_dietary_flags",
    "ingredient_substitutions",
    "ingredients",
}


def test_migrations_round_trip_on_empty_postgres_schema(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    script = ScriptDirectory.from_config(alembic_config)

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "head")
        command.check(alembic_config)
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


def test_ingredient_migration_backfills_legacy_recipe_rows(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    user_id = uuid4()
    lineage_id = uuid4()
    version_id = uuid4()
    authored_names = [" Brown Sugar ", "brown sugar", "Eggs"]

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260820_0002")

        metadata = sa.MetaData()
        users = sa.Table("users", metadata, autoload_with=connection)
        lineages = sa.Table("recipe_lineages", metadata, autoload_with=connection)
        versions = sa.Table("recipe_versions", metadata, autoload_with=connection)
        recipe_ingredients = sa.Table(
            "recipe_version_ingredients",
            metadata,
            autoload_with=connection,
        )

        connection.execute(
            users.insert().values(
                id=user_id,
                email="legacy-migration@example.com",
                display_name="Legacy Migration",
            )
        )
        connection.execute(lineages.insert().values(id=lineage_id, created_by_user_id=user_id))
        connection.execute(
            versions.insert().values(
                id=version_id,
                lineage_id=lineage_id,
                parent_version_id=None,
                created_by_user_id=user_id,
                version_number=1,
                title="Legacy Recipe",
                description=None,
                servings=Decimal("4.00"),
            )
        )
        connection.execute(
            recipe_ingredients.insert(),
            [
                {
                    "id": uuid4(),
                    "recipe_version_id": version_id,
                    "name": name,
                    "quantity": None,
                    "unit": None,
                    "preparation_notes": None,
                    "display_order": display_order,
                }
                for display_order, name in enumerate(authored_names)
            ],
        )

        command.upgrade(alembic_config, "head")

        migrated_rows = connection.execute(
            sa.text(
                """
                SELECT name, ingredient_id
                FROM recipe_version_ingredients
                ORDER BY display_order
                """
            )
        ).all()
        canonical_names = connection.execute(
            sa.text("SELECT lower(btrim(canonical_name)) FROM ingredients ORDER BY 1")
        ).scalars()

        assert [row.name for row in migrated_rows] == authored_names
        assert all(isinstance(row.ingredient_id, UUID) for row in migrated_rows)
        assert migrated_rows[0].ingredient_id == migrated_rows[1].ingredient_id
        assert migrated_rows[0].ingredient_id != migrated_rows[2].ingredient_id
        assert list(canonical_names) == ["brown sugar", "eggs"]

        command.downgrade(alembic_config, "20260820_0002")

        downgraded_inspector = inspect(connection)
        assert INGREDIENT_TABLES.isdisjoint(downgraded_inspector.get_table_names())
        assert "ingredient_id" not in {
            column["name"]
            for column in downgraded_inspector.get_columns("recipe_version_ingredients")
        }
        remaining_names = connection.execute(
            sa.text(
                """
                SELECT name
                FROM recipe_version_ingredients
                ORDER BY display_order
                """
            )
        ).scalars()
        assert list(remaining_names) == authored_names

        command.upgrade(alembic_config, "head")
        reupgraded_rows = connection.execute(
            sa.text("SELECT ingredient_id FROM recipe_version_ingredients")
        ).scalars()
        assert all(isinstance(ingredient_id, UUID) for ingredient_id in reupgraded_rows)
