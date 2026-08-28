from uuid import uuid4

import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine


def test_draft_migration_repairs_early_package_constraint_shape(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    """Databases that ran the early 0009 build can take the normal next upgrade."""

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260824_0009")
        connection.execute(
            sa.text(
                """
                ALTER TABLE recipe_version_ingredients
                DROP CONSTRAINT fk_recipe_version_ingredients_package_size_ingredient_unit;
                ALTER TABLE recipe_version_ingredients
                ADD CONSTRAINT fk_recipe_version_ingredients_package_size_id_legacy
                FOREIGN KEY (package_size_id)
                REFERENCES ingredient_package_sizes (id)
                ON DELETE RESTRICT;
                ALTER TABLE ingredient_package_sizes
                DROP CONSTRAINT uq_ingredient_package_sizes_id_ingredient_unit
                """
            )
        )

        command.upgrade(alembic_config, "head")

        package_constraints = set(
            connection.scalars(
                sa.text(
                    """
                    SELECT pg_get_constraintdef(oid)
                    FROM pg_constraint
                    WHERE conrelid IN (
                        'ingredient_package_sizes'::regclass,
                        'recipe_version_ingredients'::regclass
                    )
                    """
                )
            )
        )
        assert "UNIQUE (id, ingredient_id, package_unit_id)" in package_constraints
        assert any(
            constraint.startswith(
                "FOREIGN KEY (package_size_id, ingredient_id, measurement_unit_id)"
            )
            for constraint in package_constraints
        )
        assert not any(
            constraint.startswith("FOREIGN KEY (package_size_id) ")
            for constraint in package_constraints
        )
        command.check(alembic_config)


def test_creation_idempotency_downgrade_removes_only_discarded_shells(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    """A normal rollback restores the earlier delete-on-discard contract."""

    user_id = uuid4()
    active_draft_id = uuid4()
    discarded_draft_id = uuid4()

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "head")
        metadata = sa.MetaData()
        users = sa.Table("users", metadata, autoload_with=connection)
        drafts = sa.Table("recipe_drafts", metadata, autoload_with=connection)
        connection.execute(
            users.insert().values(
                id=user_id,
                email="draft-rollback@example.test",
                handle="draft_rollback",
                display_name="Draft rollback",
                account_kind="member",
                status="active",
            )
        )
        connection.execute(
            drafts.insert(),
            [
                {
                    "id": active_draft_id,
                    "author_user_id": user_id,
                    "source_version_id": None,
                    "creation_action_id": uuid4(),
                    "creation_request_fingerprint": "a" * 64,
                    "status": "active",
                    "revision": 1,
                    "title": "Still active",
                    "description": None,
                    "servings": None,
                },
                {
                    "id": discarded_draft_id,
                    "author_user_id": user_id,
                    "source_version_id": None,
                    "creation_action_id": uuid4(),
                    "creation_request_fingerprint": "b" * 64,
                    "status": "discarded",
                    "revision": 1,
                    "title": "",
                    "description": None,
                    "servings": None,
                },
            ],
        )

        command.downgrade(alembic_config, "20260827_0019")

        assert (
            connection.scalar(
                sa.text("SELECT count(*) FROM recipe_drafts WHERE id = :id"),
                {"id": discarded_draft_id},
            )
            == 0
        )
        assert (
            connection.scalar(
                sa.text("SELECT status FROM recipe_drafts WHERE id = :id"),
                {"id": active_draft_id},
            )
            == "active"
        )
        columns = {column["name"] for column in sa.inspect(connection).get_columns("recipe_drafts")}
        assert "creation_action_id" not in columns
        assert "creation_request_fingerprint" not in columns
