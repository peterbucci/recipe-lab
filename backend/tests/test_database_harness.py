from typing import cast
from unittest.mock import MagicMock

import pytest
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session

import tests.database as database_helpers
from tests.database import session_with_outer_rollback


def _database_mocks() -> tuple[Engine, MagicMock, MagicMock, MagicMock]:
    engine = MagicMock(spec=Engine)
    connection_context = MagicMock()
    connection = MagicMock()
    transaction = MagicMock()
    transaction.is_active = True
    connection_context.__enter__.return_value = connection
    engine.connect.return_value = connection_context
    connection.begin.return_value = transaction
    return cast(Engine, engine), connection, transaction, connection_context


def test_outer_rollback_helper_closes_and_rolls_back_after_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine, connection, transaction, connection_context = _database_mocks()
    session = MagicMock(spec=Session)
    session_factory = MagicMock(return_value=session)
    monkeypatch.setattr(database_helpers, "Session", session_factory)

    with pytest.raises(RuntimeError, match="injected failure"):
        with session_with_outer_rollback(engine) as actual:
            assert actual is session
            raise RuntimeError("injected failure")

    session_factory.assert_called_once_with(bind=connection, expire_on_commit=False)
    session.close.assert_called_once_with()
    transaction.rollback.assert_called_once_with()
    connection_context.__exit__.assert_called_once()


def test_outer_rollback_helper_contains_a_session_commit() -> None:
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE helper_rows (value INTEGER NOT NULL)"))

        with session_with_outer_rollback(engine) as session:
            session.execute(text("INSERT INTO helper_rows (value) VALUES (1)"))
            session.commit()
            assert session.scalar(text("SELECT count(*) FROM helper_rows")) == 1

        with Session(bind=engine) as verification:
            assert verification.scalar(text("SELECT count(*) FROM helper_rows")) == 0
    finally:
        engine.dispose()


def test_outer_rollback_helper_does_not_rollback_an_inactive_transaction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine, _, transaction, _ = _database_mocks()
    transaction.is_active = False
    session = MagicMock(spec=Session)
    monkeypatch.setattr(database_helpers, "Session", MagicMock(return_value=session))

    with session_with_outer_rollback(engine) as actual:
        assert actual is session

    session.close.assert_called_once_with()
    transaction.rollback.assert_not_called()
