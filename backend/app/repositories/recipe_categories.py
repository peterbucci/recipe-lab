from collections.abc import Collection
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import RecipeCategory


def list_active_recipe_categories(session: Session) -> list[RecipeCategory]:
    """Return the authorable public vocabulary in reviewed display order."""

    return list(
        session.scalars(
            select(RecipeCategory)
            .where(RecipeCategory.active.is_(True))
            .order_by(RecipeCategory.display_order, RecipeCategory.id)
        )
    )


def resolve_active_recipe_categories(
    session: Session,
    category_ids: Collection[UUID],
) -> list[RecipeCategory] | None:
    """Resolve an exact active selection, ordered by the governed vocabulary."""

    if not category_ids:
        return []
    unique_ids = set(category_ids)
    categories = list(
        session.scalars(
            select(RecipeCategory)
            .where(
                RecipeCategory.id.in_(unique_ids),
                RecipeCategory.active.is_(True),
            )
            .order_by(RecipeCategory.display_order, RecipeCategory.id)
        )
    )
    return categories if len(categories) == len(unique_ids) else None
