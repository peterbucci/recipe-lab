from typing import cast

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, Table, inspect

from app.models import RecipeIngredient

_TABLE_NAME = "recipe_version_ingredients"
_LEGACY_INDEX = "ix_recipe_version_ingredients_ingredient_id"
_COVERING_INDEX = "ix_recipe_version_ingredients_ingredient_version"


def _index_columns(engine: Engine) -> dict[str, list[str | None]]:
    result: dict[str, list[str | None]] = {}
    for index in inspect(engine).get_indexes(_TABLE_NAME):
        name = index["name"]
        assert name is not None
        result[name] = index["column_names"]
    return result


def test_duplicate_shortlist_covering_index_matches_orm_metadata() -> None:
    table = cast(Table, RecipeIngredient.__table__)
    indexes = {str(index.name): index for index in table.indexes if index.name is not None}

    assert _LEGACY_INDEX not in indexes
    assert list(indexes[_COVERING_INDEX].columns.keys()) == [
        "ingredient_id",
        "recipe_version_id",
    ]
    assert indexes[_COVERING_INDEX].unique is False


def test_duplicate_shortlist_index_migration_remains_in_the_linear_history(
    alembic_config: Config,
) -> None:
    script = ScriptDirectory.from_config(alembic_config)
    revision = script.get_revision("20260902_0029")

    assert revision.down_revision == "20260902_0028"
    assert script.get_revision("20260902_0030").down_revision == "20260902_0029"


def test_duplicate_shortlist_index_migration_upgrades_and_downgrades(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260902_0028")

    before_upgrade = _index_columns(empty_postgres_engine)
    assert before_upgrade[_LEGACY_INDEX] == ["ingredient_id"]
    assert _COVERING_INDEX not in before_upgrade

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260902_0029")

    after_upgrade = _index_columns(empty_postgres_engine)
    assert _LEGACY_INDEX not in after_upgrade
    assert after_upgrade[_COVERING_INDEX] == ["ingredient_id", "recipe_version_id"]

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.downgrade(alembic_config, "20260902_0028")

    after_downgrade = _index_columns(empty_postgres_engine)
    assert after_downgrade[_LEGACY_INDEX] == ["ingredient_id"]
    assert _COVERING_INDEX not in after_downgrade
