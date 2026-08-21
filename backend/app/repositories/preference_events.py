from uuid import UUID

from sqlalchemy.orm import Session

from app.models import PreferenceEvent


def get_preference_event(
    session: Session,
    action_id: UUID,
) -> PreferenceEvent | None:
    """Load the immutable event associated with a caller-provided action ID."""

    return session.get(PreferenceEvent, action_id)


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
        id=action_id,
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
