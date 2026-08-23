from decimal import Decimal
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, inspect
from sqlalchemy.exc import IntegrityError

DOMAIN_TABLES = {
    "allergens",
    "dietary_flags",
    "ingredient_aliases",
    "ingredient_allergens",
    "ingredient_categories",
    "ingredient_dietary_flags",
    "ingredient_substitutions",
    "ingredients",
    "oidc_identities",
    "oidc_login_transactions",
    "preference_events",
    "recipe_lineages",
    "recipe_ratings",
    "recipe_saves",
    "recipe_version_ingredients",
    "recipe_version_instructions",
    "recipe_versions",
    "users",
    "user_sessions",
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


def test_secure_account_migration_classifies_seed_users_without_rekeying(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    catalog_author_id = UUID("16746db2-8776-5937-856c-252b72442671")
    demo_cook_id = UUID("1fc5b3b8-cf73-54ce-b5d6-ed3c30df9fd9")
    member_id = uuid4()

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260821_0004")

        legacy_users = sa.Table("users", sa.MetaData(), autoload_with=connection)
        connection.execute(
            legacy_users.insert(),
            [
                {
                    "id": catalog_author_id,
                    "email": "demo-catalog@recipe-lab.invalid",
                    "display_name": "Recipe Lab Demo Catalog",
                },
                {
                    "id": demo_cook_id,
                    "email": "demo-cook@recipe-lab.invalid",
                    "display_name": "Demo Cook",
                },
                {
                    "id": member_id,
                    "email": "member@example.com",
                    "display_name": "Existing Member",
                },
            ],
        )

        command.upgrade(alembic_config, "head")

        users = sa.Table("users", sa.MetaData(), autoload_with=connection)
        rows = {
            row.id: row
            for row in connection.execute(
                sa.select(
                    users.c.id,
                    users.c.email,
                    users.c.account_kind,
                    users.c.status,
                    users.c.created_at,
                    users.c.updated_at,
                )
            )
        }
        assert rows[catalog_author_id].account_kind == "system"
        assert rows[demo_cook_id].account_kind == "demo"
        assert rows[member_id].account_kind == "member"
        assert all(row.status == "active" for row in rows.values())
        assert all(row.updated_at == row.created_at for row in rows.values())

        connection.execute(
            users.insert().values(
                id=uuid4(),
                email=rows[member_id].email,
                display_name="Same Email, Different Identity",
            )
        )


def test_activity_migration_preserves_legacy_actor_and_scopes_action_keys(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    legacy_demo_id = UUID("1fc5b3b8-cf73-54ce-b5d6-ed3c30df9fd9")
    member_a_id = uuid4()
    member_b_id = uuid4()
    lineage_id = uuid4()
    recipe_version_id = uuid4()
    legacy_event_id = uuid4()
    shared_action_id = uuid4()

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260823_0005")

        metadata = sa.MetaData()
        users = sa.Table("users", metadata, autoload_with=connection)
        lineages = sa.Table("recipe_lineages", metadata, autoload_with=connection)
        versions = sa.Table("recipe_versions", metadata, autoload_with=connection)
        legacy_events = sa.Table("preference_events", metadata, autoload_with=connection)
        connection.execute(
            users.insert(),
            [
                {
                    "id": legacy_demo_id,
                    "email": "demo-cook@recipe-lab.invalid",
                    "display_name": "Legacy Demo Cook",
                    "account_kind": "demo",
                    "status": "active",
                },
                {
                    "id": member_a_id,
                    "email": "migration-a@example.test",
                    "display_name": "Migration Member A",
                    "handle": "migration_member_a",
                    "account_kind": "member",
                    "status": "active",
                },
                {
                    "id": member_b_id,
                    "email": "migration-b@example.test",
                    "display_name": "Migration Member B",
                    "handle": "migration_member_b",
                    "account_kind": "member",
                    "status": "active",
                },
            ],
        )
        connection.execute(
            lineages.insert().values(id=lineage_id, created_by_user_id=legacy_demo_id)
        )
        connection.execute(
            versions.insert().values(
                id=recipe_version_id,
                lineage_id=lineage_id,
                parent_version_id=None,
                created_by_user_id=legacy_demo_id,
                version_number=1,
                title="Legacy activity recipe",
                description=None,
                servings=Decimal("4.00"),
            )
        )
        connection.execute(
            legacy_events.insert().values(
                id=legacy_event_id,
                user_id=legacy_demo_id,
                recipe_version_id=recipe_version_id,
                event_type="view",
            )
        )

        command.upgrade(alembic_config, "20260823_0006")
        migrated_events = sa.Table(
            "preference_events",
            sa.MetaData(),
            autoload_with=connection,
        )
        legacy_row = connection.execute(
            sa.select(
                migrated_events.c.id,
                migrated_events.c.action_id,
                migrated_events.c.user_id,
                migrated_events.c.event_type,
            ).where(migrated_events.c.id == legacy_event_id)
        ).one()
        assert legacy_row.id == legacy_event_id
        assert legacy_row.action_id == legacy_event_id
        assert legacy_row.user_id == legacy_demo_id
        assert legacy_row.event_type == "view"
        assert (
            connection.scalar(sa.select(users.c.account_kind).where(users.c.id == legacy_demo_id))
            == "demo"
        )

        connection.execute(
            migrated_events.insert(),
            [
                {
                    "id": uuid4(),
                    "action_id": shared_action_id,
                    "user_id": member_a_id,
                    "recipe_version_id": recipe_version_id,
                    "event_type": "view",
                    "saved_value": None,
                },
                {
                    "id": uuid4(),
                    "action_id": shared_action_id,
                    "user_id": member_b_id,
                    "recipe_version_id": recipe_version_id,
                    "event_type": "view",
                    "saved_value": None,
                },
                {
                    "id": uuid4(),
                    "action_id": shared_action_id,
                    "user_id": member_a_id,
                    "recipe_version_id": recipe_version_id,
                    "event_type": "save",
                    "saved_value": True,
                },
            ],
        )
        with pytest.raises(IntegrityError):
            with connection.begin_nested():
                connection.execute(
                    migrated_events.insert().values(
                        id=uuid4(),
                        action_id=shared_action_id,
                        user_id=member_a_id,
                        recipe_version_id=recipe_version_id,
                        event_type="view",
                    )
                )

        scoped_rows = connection.scalar(
            sa.select(sa.func.count())
            .select_from(migrated_events)
            .where(migrated_events.c.action_id == shared_action_id)
        )
        assert scoped_rows == 3
