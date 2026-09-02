"""Small, transport-neutral error hierarchy for expected domain outcomes."""

from collections.abc import Mapping
from typing import ClassVar


class DomainError(Exception):
    """An expected product outcome with a stable client-facing contract."""

    code: ClassVar[str] = "domain_error"
    public_message: ClassVar[str] = "The request could not be completed."

    def __init__(
        self,
        detail: str | None = None,
        *,
        headers: Mapping[str, str] | None = None,
        public_message: str | None = None,
    ) -> None:
        super().__init__(detail or type(self).public_message)
        self.headers = dict(headers or {})
        self.response_message = public_message or type(self).public_message


class DomainNotFoundError(DomainError, LookupError):
    """The requested domain resource is absent from the actor's scope."""


class DomainForbiddenError(DomainError, PermissionError):
    """The actor is authenticated but lacks a required domain capability."""


class DomainConflictError(DomainError, RuntimeError):
    """Current domain state conflicts with the requested transition."""


class DomainPreconditionFailedError(DomainError, ValueError):
    """A caller-supplied state precondition no longer holds."""


class DomainValidationError(DomainError, ValueError):
    """Input is structurally valid at the wire boundary but invalid for the domain."""


class DomainRateLimitedError(DomainError, RuntimeError):
    """The actor has exceeded a domain operation limit."""


class DomainUnavailableError(DomainError, RuntimeError):
    """A required domain capability is temporarily unavailable."""
