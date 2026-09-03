"""Narrow database lifecycle helpers shared by backend tests."""

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Engine
from sqlalchemy.orm import Session


@contextmanager
def session_with_outer_rollback(engine: Engine) -> Iterator[Session]:
    """Yield one non-expiring session whose enclosing transaction is always rolled back.

    This helper is for tests that deliberately allow the session to flush or
    commit while keeping all writes inside one connection-owned transaction.
    Tests that assert savepoint behavior should keep those boundaries visible.
    """

    with engine.connect() as connection:
        transaction = connection.begin()
        session = Session(bind=connection, expire_on_commit=False)
        try:
            yield session
        finally:
            session.close()
            if transaction.is_active:
                transaction.rollback()
