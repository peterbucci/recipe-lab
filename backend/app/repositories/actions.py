from collections.abc import Collection
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import CookingActionType


def list_active_cooking_action_types(
    session: Session,
    *,
    limit: int,
) -> list[CookingActionType]:
    """Return a bounded active catalog in stable human-facing order."""

    statement = (
        select(CookingActionType)
        .where(CookingActionType.active.is_(True))
        .order_by(
            func.lower(func.btrim(CookingActionType.canonical_verb)),
            CookingActionType.id,
        )
        .limit(limit)
    )
    return list(session.scalars(statement))


def get_cooking_action_types(
    session: Session,
    action_type_ids: Collection[UUID],
) -> dict[UUID, CookingActionType]:
    if not action_type_ids:
        return {}
    statement = (
        select(CookingActionType)
        .where(CookingActionType.id.in_(action_type_ids))
        .order_by(CookingActionType.id)
    )
    return {action_type.id: action_type for action_type in session.scalars(statement)}
