from typing import Any, cast
from uuid import UUID

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from app.repositories import recommendations as repository


def _literal_sql(statement: Any) -> str:
    return str(
        statement.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )


class _CandidateOverflowSession:
    statement: Any = None

    def execute(self, statement: Any) -> tuple[tuple[object, int, int, int, int, int], ...]:
        self.statement = statement
        row = (object(), 0, 0, 0, 0, 0)
        return (row, row)


def test_candidate_adapter_detects_overflow_with_one_bounded_probe(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _CandidateOverflowSession()
    monkeypatch.setattr(repository, "MAX_RECOMMENDATION_CANDIDATES", 1)

    with pytest.raises(repository.RecommendationDataCapacityError, match="candidate catalog"):
        repository.load_recommendation_data(cast(Session, session), None)

    assert "LIMIT 2" in _literal_sql(session.statement)


class _ProfileOverflowSession:
    saved_statement: Any = None

    def execute(self, statement: Any) -> tuple[object, ...]:
        return ()

    def scalars(self, statement: Any) -> tuple[UUID, UUID]:
        self.saved_statement = statement
        return (
            UUID("10000000-0000-4000-8000-000000000001"),
            UUID("10000000-0000-4000-8000-000000000002"),
        )


def test_profile_adapter_detects_overflow_before_loading_later_signal_types(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _ProfileOverflowSession()
    monkeypatch.setattr(repository, "MAX_RECOMMENDATION_PROFILE_RECORDS", 1)

    with pytest.raises(repository.RecommendationDataCapacityError, match="member profile"):
        repository.load_recommendation_data(
            cast(Session, session),
            UUID("20000000-0000-4000-8000-000000000001"),
        )

    assert "LIMIT 2" in _literal_sql(session.saved_statement)
