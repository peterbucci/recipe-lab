from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, inspect, text
from sqlalchemy.exc import DBAPIError


def test_unbound_sandbox_migration_can_downgrade_and_upgrade(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260916_0035")
        command.downgrade(alembic_config, "20260916_0034")

    assert "sandbox_generations" not in inspect(empty_postgres_engine).get_table_names()

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260916_0035")

    assert "sandbox_generations" in inspect(empty_postgres_engine).get_table_names()


def test_bound_sandbox_migration_refuses_lossy_downgrade(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    generation_id = uuid4()
    started_at = datetime(2026, 9, 16, tzinfo=UTC)
    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260916_0035")
        connection.execute(
            text(
                "INSERT INTO sandbox_generations "
                "(singleton, generation_id, started_at, expires_at) "
                "VALUES (1, :generation_id, :started_at, :expires_at)"
            ),
            {
                "generation_id": generation_id,
                "started_at": started_at,
                "expires_at": started_at + timedelta(hours=24),
            },
        )

    with pytest.raises(RuntimeError, match="cannot downgrade a bound sandbox generation"):
        with empty_postgres_engine.begin() as connection:
            alembic_config.attributes["connection"] = connection
            command.downgrade(alembic_config, "20260916_0034")

    with empty_postgres_engine.connect() as connection:
        assert connection.scalar(text("SELECT generation_id FROM sandbox_generations")) == (
            generation_id
        )
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "20260916_0035"

    with pytest.raises(DBAPIError, match="Sandbox generations cannot be changed or removed"):
        with empty_postgres_engine.begin() as connection:
            connection.execute(text("DELETE FROM sandbox_generations"))
