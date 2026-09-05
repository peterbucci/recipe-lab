"""Small, explicit application harnesses shared by backend API tests."""

from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, contextmanager

from fastapi import FastAPI
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.main import create_app

type SessionDependency = Callable[[], Iterator[Session]]


def database_session_dependency(
    engine: Engine,
    *,
    expire_on_commit: bool = True,
) -> SessionDependency:
    """Return the production-shaped request-session dependency for a test engine."""

    def dependency() -> Iterator[Session]:
        with Session(bind=engine, expire_on_commit=expire_on_commit) as session:
            yield session

    return dependency


def fixed_session_dependency(session: Session) -> SessionDependency:
    """Return a dependency for route-unit tests whose repository calls are mocked."""

    def dependency() -> Iterator[Session]:
        yield session

    return dependency


@contextmanager
def application_with_session_dependency(
    dependency: SessionDependency,
) -> Iterator[FastAPI]:
    """Create an isolated app and always remove its dependency overrides."""

    application = create_app()
    application.dependency_overrides[get_session] = dependency
    try:
        yield application
    finally:
        application.dependency_overrides.clear()


def application_with_database(
    engine: Engine,
    *,
    expire_on_commit: bool = True,
) -> AbstractContextManager[FastAPI]:
    """Create an isolated test app backed by one explicit database engine."""

    return application_with_session_dependency(
        database_session_dependency(engine, expire_on_commit=expire_on_commit)
    )


def application_with_session(session: Session) -> AbstractContextManager[FastAPI]:
    """Create an isolated route-unit-test app backed by one fixed session."""

    return application_with_session_dependency(fixed_session_dependency(session))
