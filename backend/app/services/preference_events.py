from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.domain_errors import DomainConflictError
from app.models import PreferenceEvent
from app.repositories.preference_events import add_preference_event, get_preference_event

type PreferenceEventType = Literal["view", "save", "rating", "fork"]


class IdempotencyKeyConflictError(DomainConflictError):
    """Raised when an action ID has already been used for different semantics."""

    code = "idempotency_key_conflict"
    public_message = "The Idempotency-Key conflicts with an earlier action in this operation."


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

    event = get_preference_event(
        session,
        user_id=intent.user_id,
        event_type=intent.event_type,
        action_id=intent.action_id,
    )
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
