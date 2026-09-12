from typing import cast

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, Table, inspect

from app.models import UserFollow

_FOLLOWING_READ_INDEX = "ix_user_follows_follower_created_followed"


def _database_index_names(engine: Engine) -> set[str]:
    return {
        str(index["name"])
        for index in inspect(engine).get_indexes("user_follows")
        if index["name"] is not None
    }


def test_following_read_index_matches_orm_metadata() -> None:
    table = cast(Table, UserFollow.__table__)
    indexes = {str(index.name): index for index in table.indexes if index.name is not None}
    following_index = indexes[_FOLLOWING_READ_INDEX]

    assert [str(expression) for expression in following_index.expressions] == [
        "user_follows.follower_user_id",
        "created_at DESC",
        "user_follows.followed_user_id",
    ]


def test_following_read_index_migration_is_the_single_linear_head(
    alembic_config: Config,
) -> None:
    script = ScriptDirectory.from_config(alembic_config)
    revision = script.get_revision("20260911_0031")

    assert script.get_heads() == ["20260911_0031"]
    assert revision.down_revision == "20260902_0030"


def test_following_read_index_migration_upgrades_and_downgrades(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260902_0030")

    assert _FOLLOWING_READ_INDEX not in _database_index_names(empty_postgres_engine)

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260911_0031")

    assert _FOLLOWING_READ_INDEX in _database_index_names(empty_postgres_engine)

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.downgrade(alembic_config, "20260902_0030")

    assert _FOLLOWING_READ_INDEX not in _database_index_names(empty_postgres_engine)
