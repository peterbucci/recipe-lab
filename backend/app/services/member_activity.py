from __future__ import annotations

import base64
import binascii
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal, cast
from uuid import UUID

from app.core.domain_errors import DomainValidationError

type MemberActivityKind = Literal[
    "draft",
    "published",
    "withdrawn",
    "saved",
    "ingredient-request",
]
type MemberActivityFilter = Literal["all", "recipes", "saved", "requests"]
type MemberActivityState = Literal[
    "published",
    "author_withdrawn",
    "moderation_hidden",
    "approved",
    "rejected",
    "duplicate",
]

MEMBER_ACTIVITY_KINDS = frozenset(
    {"draft", "published", "withdrawn", "saved", "ingredient-request"}
)
MAX_ACTIVITY_CURSOR_LENGTH = 512


class InvalidMemberActivityCursorError(DomainValidationError):
    code = "invalid_activity_cursor"
    public_message = "The activity cursor is invalid or expired."


@dataclass(frozen=True, slots=True)
class MemberActivityCursor:
    occurred_at: datetime
    kind: MemberActivityKind
    entity_id: UUID


def encode_member_activity_cursor(cursor: MemberActivityCursor) -> str:
    occurred_at = cursor.occurred_at.astimezone(UTC).isoformat().replace("+00:00", "Z")
    payload = json.dumps(
        {"at": occurred_at, "id": str(cursor.entity_id), "kind": cursor.kind},
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def decode_member_activity_cursor(value: str) -> MemberActivityCursor:
    if not value or len(value) > MAX_ACTIVITY_CURSOR_LENGTH:
        raise InvalidMemberActivityCursorError("Activity cursor is invalid.")
    try:
        encoded = value.encode("ascii")
        padding = b"=" * (-len(encoded) % 4)
        payload = json.loads(
            base64.b64decode(encoded + padding, altchars=b"-_", validate=True).decode("utf-8")
        )
        if not isinstance(payload, dict) or set(payload) != {"at", "id", "kind"}:
            raise ValueError
        raw_occurred_at = payload["at"]
        raw_kind = payload["kind"]
        raw_entity_id = payload["id"]
        if not all(isinstance(item, str) for item in payload.values()):
            raise ValueError
        occurred_at = datetime.fromisoformat(cast(str, raw_occurred_at).replace("Z", "+00:00"))
        if occurred_at.tzinfo is None or occurred_at.utcoffset() is None:
            raise ValueError
        if raw_kind not in MEMBER_ACTIVITY_KINDS:
            raise ValueError
        entity_id = UUID(cast(str, raw_entity_id))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError, binascii.Error) as error:
        raise InvalidMemberActivityCursorError("Activity cursor is invalid.") from error
    return MemberActivityCursor(
        occurred_at=occurred_at.astimezone(UTC),
        kind=cast(MemberActivityKind, raw_kind),
        entity_id=entity_id,
    )
