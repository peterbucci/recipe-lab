import json
import logging
import re
import secrets
from collections.abc import Mapping
from typing import Literal, cast
from uuid import UUID

from starlette.types import Scope

CORRELATION_ID_HEADER = "X-Correlation-ID"
CORRELATION_ID_STATE_KEY = "correlation_id"

OperationalFailureEvent = Literal[
    "authentication_failure",
    "publication_failure",
    "database_failure",
    "application_failure",
]
OPERATIONAL_FAILURE_EVENTS: frozenset[str] = frozenset(
    {
        "authentication_failure",
        "publication_failure",
        "database_failure",
        "application_failure",
    }
)

_operations_logger = logging.getLogger("recipe_lab.operations")
_PUBLICATION_PATHS = re.compile(
    r"^/api/(?:recipe-drafts/[^/]+/(?:duplicate-preflights|publish)|recipes/[^/]+/visibility)$"
)


def new_correlation_id() -> str:
    """Return an opaque UUID with 122 random bits from the OS CSPRNG."""

    return str(UUID(bytes=secrets.token_bytes(16), version=4))


def correlation_id_from_scope(scope: Scope) -> str:
    """Return the request-scoped identifier, creating one only for isolated callers."""

    raw_state = scope.setdefault("state", {})
    if isinstance(raw_state, Mapping):
        existing = raw_state.get(CORRELATION_ID_STATE_KEY)
        if isinstance(existing, str):
            return existing

    correlation_id = new_correlation_id()
    if not isinstance(raw_state, dict):
        raw_state = dict(raw_state)
        scope["state"] = raw_state
    raw_state[CORRELATION_ID_STATE_KEY] = correlation_id
    return correlation_id


def request_failure_event(scope: Scope) -> OperationalFailureEvent:
    """Classify a failed routed operation without retaining its path or request data."""

    raw_path = scope.get("path")
    if isinstance(raw_path, str):
        normalized_path = raw_path.rstrip("/") or "/"
        if normalized_path == "/api/auth" or normalized_path.startswith("/api/auth/"):
            return "authentication_failure"
        if _PUBLICATION_PATHS.fullmatch(normalized_path):
            return "publication_failure"

    route = scope.get("route")
    raw_tags = getattr(route, "tags", ())
    tags = {tag for tag in raw_tags if isinstance(tag, str)}
    if "authentication" in tags:
        return "authentication_failure"
    if "recipe publication" in tags:
        return "publication_failure"
    return "application_failure"


def emit_operational_failure(
    event: OperationalFailureEvent,
    *,
    correlation_id: str,
) -> None:
    """Emit the complete allowlisted event payload; exception details are never accepted."""

    if event not in OPERATIONAL_FAILURE_EVENTS:
        raise ValueError("Operational failure event is not allowlisted.")
    payload = json.dumps(
        {"correlation_id": correlation_id, "event": event},
        separators=(",", ":"),
        sort_keys=True,
    )
    # Alembic's process-local logging setup can disable pre-existing loggers during
    # migration tests. Operational failure evidence must remain available afterward.
    _operations_logger.disabled = False
    _operations_logger.error("%s", payload)


def operational_failure_event(value: str) -> OperationalFailureEvent:
    """Narrow an allowlisted runtime value for callers that load policy data."""

    if value not in OPERATIONAL_FAILURE_EVENTS:
        raise ValueError("Operational failure event is not allowlisted.")
    return cast(OperationalFailureEvent, value)
