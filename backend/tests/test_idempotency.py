import pytest

from app.core.canonical_documents import canonical_document_sha256
from app.core.idempotency import (
    IdempotencyConflictError,
    canonical_request_fingerprint,
    require_same_request,
)


class ExampleConflictError(IdempotencyConflictError):
    public_message = "This operation conflicts with its earlier request."


def test_request_fingerprint_preserves_the_versioned_canonical_document() -> None:
    fields = {"actor": "member-1", "payload": {"saved": True}}

    fingerprint = canonical_request_fingerprint(
        schema="recipe-lab.example-request",
        version=2,
        fields=fields,
    )

    assert fingerprint == canonical_document_sha256(
        {
            **fields,
            "schema": "recipe-lab.example-request",
            "version": 2,
        }
    )


@pytest.mark.parametrize(
    ("schema", "version", "fields"),
    [
        ("", 1, {}),
        ("recipe-lab.example", 0, {}),
        ("recipe-lab.example", 1, {"schema": "shadow"}),
        ("recipe-lab.example", 1, {"version": 99}),
    ],
)
def test_request_fingerprint_requires_owned_version_metadata(
    schema: str,
    version: int,
    fields: dict[str, object],
) -> None:
    with pytest.raises(ValueError):
        canonical_request_fingerprint(schema=schema, version=version, fields=fields)


def test_replay_guard_accepts_only_the_same_request_fingerprint() -> None:
    require_same_request("same", "same", conflict_error=ExampleConflictError)

    with pytest.raises(ExampleConflictError) as caught:
        require_same_request(
            "stored",
            "requested",
            conflict_error=ExampleConflictError,
            detail="private diagnostic",
        )

    assert str(caught.value) == "private diagnostic"
    assert caught.value.response_message == ExampleConflictError.public_message
