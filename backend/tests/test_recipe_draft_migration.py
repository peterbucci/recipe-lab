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
