from typing import cast

import pytest
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from tests.application import application_with_session, fixed_session_dependency


def test_fixed_session_dependency_yields_the_exact_route_unit_session() -> None:
    session = cast(Session, object())

    assert list(fixed_session_dependency(session)()) == [session]


def test_application_harness_always_clears_dependency_overrides() -> None:
    session = cast(Session, object())
    application = None

    with pytest.raises(RuntimeError, match="test failure"):
        with application_with_session(session) as application:
            assert get_session in application.dependency_overrides
            raise RuntimeError("test failure")

    assert application is not None
    assert application.dependency_overrides == {}
