"""A bounded, non-login fixture for the release rehearsal's historical schema.

Keep these inserts at revision 0019: current ORM models and demo catalog loaders
may require columns that the upgrade under test has not created yet.
"""

import os
from collections.abc import Mapping

from sqlalchemy import Connection, create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError, SQLAlchemyError

START_REVISION = "20260827_0019"
FIXTURE_USER_ID = "00190000-0000-4000-8000-000000000001"
FIXTURE_LINEAGE_ID = "00190000-0000-4000-8000-000000000002"
FIXTURE_RECIPE_ID = "00190000-0000-4000-8000-000000000003"
FIXTURE_INGREDIENT_ID = "00190000-0000-4000-8000-000000000004"
_DATABASE_NAMES = frozenset({"recipe_lab_rcp32_acceptance", "recipe_lab_rcp33g_migration_failure"})


def validate_fixture_environment(environment: Mapping[str, str]) -> str:
    if environment.get("ACCEPTANCE_DATABASE_ISOLATED") != "1":
        raise ValueError("ACCEPTANCE_DATABASE_ISOLATED=1 is required.")
    database_url = environment.get("DATABASE_URL", "")
    try:
        parsed = make_url(database_url)
    except ArgumentError:
        raise ValueError("A disposable rehearsal database URL is required.") from None
    if parsed.get_backend_name() != "postgresql" or parsed.database not in _DATABASE_NAMES:
        raise ValueError("The historical fixture requires a disposable rehearsal PostgreSQL DB.")
    return database_url


def catalog_counts(connection: Connection) -> tuple[int, ...]:
    row = connection.execute(
        text(
            "SELECT (SELECT count(*) FROM ingredients), "
            "(SELECT count(*) FROM measurement_units), "
            "(SELECT count(*) FROM cooking_action_types), "
            "(SELECT count(*) FROM recipe_versions)"
        )
    ).one()
    return tuple(int(count) for count in row)


def seed_historical_fixture(connection: Connection) -> None:
    """Insert only into an empty 0019 schema, inside the caller's transaction."""

    revisions = connection.execute(text("SELECT version_num FROM alembic_version")).scalars().all()
    if revisions != [START_REVISION]:
        raise ValueError("The historical fixture requires exactly revision 20260827_0019.")
    occupied = connection.execute(
        text(
            "SELECT (SELECT count(*) FROM users) + (SELECT count(*) FROM recipe_lineages) "
            "+ (SELECT count(*) FROM recipe_versions) + (SELECT count(*) FROM ingredients)"
        )
    ).scalar_one()
    if occupied:
        raise ValueError(
            "The historical fixture requires empty user, recipe and ingredient tables."
        )

    parameters = {
        "user_id": FIXTURE_USER_ID,
        "lineage_id": FIXTURE_LINEAGE_ID,
        "recipe_id": FIXTURE_RECIPE_ID,
        "ingredient_id": FIXTURE_INGREDIENT_ID,
    }
    statements = (
        "INSERT INTO users (id, email, display_name, account_kind, status) "
        "VALUES (:user_id, 'migration-fixture@recipe-lab.invalid', "
        "'Migration fixture', 'system', 'active')",
        "INSERT INTO recipe_lineages (id, created_by_user_id) VALUES (:lineage_id, :user_id)",
        "INSERT INTO recipe_versions "
        "(id, lineage_id, created_by_user_id, version_number, title, servings) "
        "VALUES (:recipe_id, :lineage_id, :user_id, 1, 'Historical migration fixture', 1)",
        "INSERT INTO ingredients (id, canonical_name) "
        "VALUES (:ingredient_id, 'RCP-33G historical migration fixture ingredient')",
    )
    for statement in statements:
        connection.execute(text(statement), parameters)
    # Units and actions are already populated by the frozen 0009/0010 migrations.
    if not all(count > 0 for count in catalog_counts(connection)):
        raise ValueError("Every catalog counted by the migration rehearsal must be nonempty.")


def main() -> int:
    try:
        database_url = validate_fixture_environment(os.environ)
        engine = create_engine(database_url)
        try:
            with engine.begin() as connection:
                seed_historical_fixture(connection)
        finally:
            engine.dispose()
    except (ValueError, SQLAlchemyError):
        # Rehearsal output is publishable; do not expose connection or row details.
        print("Historical migration fixture setup failed.")
        return 1
    print("Nonempty historical migration fixture prepared.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
