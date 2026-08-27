import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.db.engine_options import application_engine_options


def test_database_operation_timeout_defaults_to_five_seconds() -> None:
    assert Settings().database_operation_timeout_seconds == 5


@pytest.mark.parametrize("timeout_seconds", [1, 30])
def test_database_operation_timeout_accepts_inclusive_bounds(timeout_seconds: int) -> None:
    settings = Settings(database_operation_timeout_seconds=timeout_seconds)

    assert settings.database_operation_timeout_seconds == timeout_seconds


@pytest.mark.parametrize("timeout_seconds", [0, 31])
def test_database_operation_timeout_rejects_values_outside_bounds(timeout_seconds: int) -> None:
    with pytest.raises(ValidationError, match="database_operation_timeout_seconds"):
        Settings(database_operation_timeout_seconds=timeout_seconds)


@pytest.mark.parametrize("timeout_seconds", [1, 5, 17, 30])
def test_application_engine_options_derive_every_wait_bound_from_one_setting(
    timeout_seconds: int,
) -> None:
    settings = Settings(database_operation_timeout_seconds=timeout_seconds)

    assert application_engine_options(settings) == {
        "pool_pre_ping": True,
        "pool_timeout": timeout_seconds,
        "connect_args": {
            "connect_timeout": timeout_seconds,
            "options": f"-c statement_timeout={timeout_seconds * 1_000}",
            "tcp_user_timeout": timeout_seconds * 1_000,
            "keepalives": 1,
            "keepalives_idle": timeout_seconds,
            "keepalives_interval": timeout_seconds,
            "keepalives_count": 2,
        },
    }
