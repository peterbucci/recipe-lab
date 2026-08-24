from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import PreferenceEvent


def get_preference_event(
    session: Session,
    *,
    user_id: UUID,
    event_type: str,
    action_id: UUID,
) -> PreferenceEvent | None:
    """Load an immutable event from one member-and-operation action namespace."""

    return session.scalar(
        select(PreferenceEvent).where(
            PreferenceEvent.user_id == user_id,
            PreferenceEvent.event_type == event_type,
            PreferenceEvent.action_id == action_id,
        )
    )


def add_preference_event(
    session: Session,
    *,
    action_id: UUID,
    user_id: UUID,
    recipe_version_id: UUID,
    event_type: str,
    saved_value: bool | None = None,
    rating_value: int | None = None,
    related_recipe_version_id: UUID | None = None,
    request_fingerprint: str | None = None,
) -> PreferenceEvent:
    """Stage and flush one server-authored event without committing the transaction."""

    event = PreferenceEvent(
        action_id=action_id,
        user_id=user_id,
        recipe_version_id=recipe_version_id,
        event_type=event_type,
        saved_value=saved_value,
        rating_value=rating_value,
        related_recipe_version_id=related_recipe_version_id,
        request_fingerprint=request_fingerprint,
    )
    session.add(event)
    session.flush()
    return event
