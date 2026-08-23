import logging
from typing import Any

_CALLBACK_PATH = "/api/auth/callback"


class RedactAuthCallbackQueryFilter(logging.Filter):
    """Remove authorization codes and state from Uvicorn access-log records."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if not isinstance(args, tuple) or len(args) < 3:
            return True
        request_target = args[2]
        if not isinstance(request_target, str):
            return True
        request_path, separator, _query = request_target.partition("?")
        if not separator or request_path.rstrip("/") != _CALLBACK_PATH:
            return True
        sanitized: tuple[Any, ...] = (*args[:2], request_path, *args[3:])
        record.args = sanitized
        return True


def install_sensitive_query_redaction() -> None:
    access_logger = logging.getLogger("uvicorn.access")
    if any(isinstance(item, RedactAuthCallbackQueryFilter) for item in access_logger.filters):
        return
    access_logger.addFilter(RedactAuthCallbackQueryFilter())
