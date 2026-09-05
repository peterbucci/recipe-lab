from typing import TypedDict

from app.core.config import Settings


class PsycopgConnectOptions(TypedDict):
    connect_timeout: int
    options: str
    tcp_user_timeout: int
    keepalives: int
    keepalives_idle: int
    keepalives_interval: int
    keepalives_count: int


class ApplicationEngineOptions(TypedDict):
    pool_pre_ping: bool
    pool_timeout: int
    connect_args: PsycopgConnectOptions


def application_engine_options(settings: Settings) -> ApplicationEngineOptions:
    """Derive every application database wait bound from one reviewed setting."""

    timeout_seconds = settings.database.operation_timeout_seconds
    timeout_milliseconds = timeout_seconds * 1_000
    return {
        "pool_pre_ping": True,
        "pool_timeout": timeout_seconds,
        "connect_args": {
            "connect_timeout": timeout_seconds,
            "options": f"-c statement_timeout={timeout_milliseconds}",
            "tcp_user_timeout": timeout_milliseconds,
            "keepalives": 1,
            "keepalives_idle": timeout_seconds,
            "keepalives_interval": timeout_seconds,
            "keepalives_count": 2,
        },
    }
