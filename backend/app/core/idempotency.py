"""Typed, transport-neutral primitives for durable idempotent operations."""

from __future__ import annotations

from collections.abc import Mapping
from typing import NewType

from app.core.canonical_documents import canonical_document_sha256
from app.core.domain_errors import DomainConflictError

RequestFingerprint = NewType("RequestFingerprint", str)


class IdempotencyConflictError(DomainConflictError):
    """Base outcome for reuse of one action identifier with a different intent."""

    code = "idempotency_key_conflict"
    public_message = "The Idempotency-Key conflicts with an earlier request."


def canonical_request_fingerprint(
    *,
    schema: str,
    version: int,
    fields: Mapping[str, object],
) -> RequestFingerprint:
    """Hash one explicitly versioned request without changing its byte contract."""

    if not schema.strip():
        raise ValueError("An idempotency fingerprint schema must not be blank.")
    if version < 1:
        raise ValueError("An idempotency fingerprint version must be positive.")
    reserved = {"schema", "version"}.intersection(fields)
    if reserved:
        raise ValueError(
            "Idempotency fingerprint fields must not replace reserved metadata: "
            + ", ".join(sorted(reserved))
            + "."
        )
    document = {**fields, "schema": schema, "version": version}
    return RequestFingerprint(canonical_document_sha256(document))


def require_same_request(
    stored_fingerprint: str | None,
    requested_fingerprint: str | None,
    *,
    conflict_error: type[IdempotencyConflictError] = IdempotencyConflictError,
    detail: str = "The action identifier is already bound to another request.",
) -> None:
    """Reject a replay unless its canonical request intent exactly matches."""

    if stored_fingerprint != requested_fingerprint:
        raise conflict_error(detail)
