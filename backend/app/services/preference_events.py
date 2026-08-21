import hashlib
import json
from dataclasses import dataclass
from decimal import Decimal
from typing import Literal
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import PreferenceEvent
from app.repositories.preference_events import add_preference_event, get_preference_event
from app.schemas.recipe_forks import RecipeForkRequest

type PreferenceEventType = Literal["view", "save", "rating", "fork"]


class IdempotencyKeyConflictError(ValueError):
    """Raised when an action ID has already been used for different semantics."""


@dataclass(frozen=True, slots=True)
class PreferenceEventIntent:
    action_id: UUID
    user_id: UUID
    recipe_version_id: UUID
    event_type: PreferenceEventType
    saved_value: bool | None = None
    rating_value: int | None = None
    request_fingerprint: str | None = None


def _matches_intent(event: PreferenceEvent, intent: PreferenceEventIntent) -> bool:
    same_base_fields = (
        event.user_id == intent.user_id
        and event.recipe_version_id == intent.recipe_version_id
        and event.event_type == intent.event_type
        and event.saved_value == intent.saved_value
        and event.rating_value == intent.rating_value
        and event.request_fingerprint == intent.request_fingerprint
    )
    if not same_base_fields:
        return False

    if intent.event_type == "fork":
        return event.related_recipe_version_id is not None
    return event.related_recipe_version_id is None


def find_preference_event_replay(
    session: Session,
    intent: PreferenceEventIntent,
) -> PreferenceEvent | None:
    """Return an exact prior action or reject conflicting action-ID reuse."""

    event = get_preference_event(session, intent.action_id)
    if event is None:
        return None
    if not _matches_intent(event, intent):
        raise IdempotencyKeyConflictError
    return event


def record_preference_event(
    session: Session,
    intent: PreferenceEventIntent,
    *,
    related_recipe_version_id: UUID | None = None,
) -> PreferenceEvent:
    """Write one validated event as part of the caller-owned product transaction."""

    return add_preference_event(
        session,
        action_id=intent.action_id,
        user_id=intent.user_id,
        recipe_version_id=intent.recipe_version_id,
        event_type=intent.event_type,
        saved_value=intent.saved_value,
        rating_value=intent.rating_value,
        related_recipe_version_id=related_recipe_version_id,
        request_fingerprint=intent.request_fingerprint,
    )


def _canonical_value(value: object) -> object:
    if isinstance(value, Decimal):
        return format(value.normalize(), "f")
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _canonical_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_canonical_value(item) for item in value]
    return value


def recipe_fork_request_fingerprint(
    source_recipe_version_id: UUID,
    payload: RecipeForkRequest,
) -> str:
    """Hash a normalized, validated fork request without retaining its free-form content."""

    canonical_request = {
        "payload": _canonical_value(payload.model_dump(mode="python")),
        "source_recipe_version_id": str(source_recipe_version_id),
    }
    encoded = json.dumps(
        canonical_request,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
