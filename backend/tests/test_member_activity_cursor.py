from datetime import UTC, datetime
from uuid import UUID

import pytest
from pydantic import ValidationError

from app.schemas.member_activity import MemberActivityItem
from app.services.member_activity import (
    InvalidMemberActivityCursorError,
    MemberActivityCursor,
    decode_member_activity_cursor,
    encode_member_activity_cursor,
)


def test_member_activity_cursor_round_trips_deterministically() -> None:
    cursor = MemberActivityCursor(
        occurred_at=datetime(2026, 9, 2, 18, 30, 45, 123456, tzinfo=UTC),
        kind="ingredient-request",
        entity_id=UUID("12345678-1234-4234-8234-1234567890ab"),
    )

    encoded = encode_member_activity_cursor(cursor)

    assert encoded == encode_member_activity_cursor(cursor)
    assert decode_member_activity_cursor(encoded) == cursor
    assert "=" not in encoded


@pytest.mark.parametrize(
    "value",
    [
        "",
        "not base64!",
        "e30",
        "eyJhdCI6IjIwMjYtMDktMDJUMTg6MzA6NDUiLCJpZCI6ImJhZCIsImtpbmQiOiJkcmFmdCJ9",
        "x" * 513,
    ],
)
def test_member_activity_cursor_rejects_malformed_or_unbounded_values(value: str) -> None:
    with pytest.raises(InvalidMemberActivityCursorError, match="Activity cursor is invalid"):
        decode_member_activity_cursor(value)


@pytest.mark.parametrize(
    ("kind", "state"),
    [
        ("draft", "approved"),
        ("saved", "published"),
        ("published", "author_withdrawn"),
        ("withdrawn", "published"),
        ("ingredient-request", None),
    ],
)
def test_member_activity_schema_rejects_impossible_kind_state_pairs(
    kind: str,
    state: str | None,
) -> None:
    with pytest.raises(ValidationError):
        MemberActivityItem.model_validate(
            {
                "id": "12345678-1234-4234-8234-1234567890ab",
                "kind": kind,
                "occurred_at": "2026-09-02T18:30:45Z",
                "state": state,
                "title": "Example",
            }
        )
