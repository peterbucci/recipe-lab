import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateSchema, DropSchema

from app.seeds import load_bundled_catalog, seed_catalog

BACKEND_ROOT = Path(__file__).resolve().parents[1]
TEST_DATABASE_ENV_VAR = "TEST_DATABASE_URL"


def make_alembic_config() -> Config:
    return Config(str(BACKEND_ROOT / "alembic.ini"))


@contextmanager
def isolated_postgres_engine(database_url: str) -> Iterator[Engine]:
    schema_name = f"recipe_lab_test_{uuid4().hex}"
    admin_engine = create_engine(
        database_url,
        isolation_level="AUTOCOMMIT",
        pool_pre_ping=True,
    )
    test_engine: Engine | None = None

    try:
        with admin_engine.connect() as connection:
            connection.execute(CreateSchema(schema_name))

        test_engine = create_engine(
            database_url,
            connect_args={"options": f"-csearch_path={schema_name}"},
            pool_pre_ping=True,
        )
        yield test_engine
    finally:
        if test_engine is not None:
            test_engine.dispose()
        with admin_engine.connect() as connection:
            connection.execute(DropSchema(schema_name, cascade=True, if_exists=True))
        admin_engine.dispose()


@pytest.fixture(scope="session")
def postgres_url() -> str:
    database_url = os.getenv(TEST_DATABASE_ENV_VAR)
    if database_url:
        return database_url

    message = (
        f"{TEST_DATABASE_ENV_VAR} is required for PostgreSQL schema tests. "
        "Start the Compose database and set the test URL."
    )
    if os.getenv("CI"):
        pytest.fail(message)
    pytest.skip(message)


@pytest.fixture
def alembic_config() -> Config:
    return make_alembic_config()


@pytest.fixture(scope="session")
def migrated_engine(postgres_url: str) -> Iterator[Engine]:
    with isolated_postgres_engine(postgres_url) as engine:
        config = make_alembic_config()
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
        yield engine


@pytest.fixture(scope="session")
def seeded_api_engine(postgres_url: str) -> Iterator[Engine]:
    with isolated_postgres_engine(postgres_url) as engine:
        config = make_alembic_config()
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
        with Session(bind=engine) as session, session.begin():
            seed_catalog(session, load_bundled_catalog())
        yield engine


@pytest.fixture
def empty_postgres_engine(postgres_url: str) -> Iterator[Engine]:
    with isolated_postgres_engine(postgres_url) as engine:
        yield engine


@pytest.fixture
def db_session(migrated_engine: Engine) -> Iterator[Session]:
    with migrated_engine.connect() as connection:
        transaction = connection.begin()
        session = Session(bind=connection, expire_on_commit=False)
        try:
            yield session
        finally:
            session.close()
            if transaction.is_active:
                transaction.rollback()
