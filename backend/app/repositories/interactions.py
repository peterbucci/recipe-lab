from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import RecipeRating, RecipeSave, RecipeVersion, User
from app.policies.recipe_visibility import publicly_readable_recipe_version_filter


@dataclass(frozen=True, slots=True)
class RecipeViewerState:
    saved: bool
    rating: int | None


def get_user(
    session: Session,
    user_id: UUID,
    *,
    for_update: bool = False,
) -> User | None:
    if not for_update:
        return session.get(User, user_id)
    return session.scalar(select(User).where(User.id == user_id).with_for_update())


def recipe_version_exists(session: Session, recipe_version_id: UUID) -> bool:
    return (
        session.scalar(
            select(RecipeVersion.id).where(
                RecipeVersion.id == recipe_version_id,
                publicly_readable_recipe_version_filter(),
            )
        )
        is not None
    )


def get_recipe_viewer_state(
    session: Session,
    *,
    user_id: UUID,
    recipe_version_id: UUID,
) -> RecipeViewerState:
    saved = (
        session.get(
            RecipeSave,
            {
                "user_id": user_id,
                "recipe_version_id": recipe_version_id,
            },
        )
        is not None
    )
    rating = session.scalar(
        select(RecipeRating.rating).where(
            RecipeRating.user_id == user_id,
            RecipeRating.recipe_version_id == recipe_version_id,
        )
    )
    return RecipeViewerState(saved=saved, rating=rating)


def get_recipe_viewer_states(
    session: Session,
    *,
    user_id: UUID,
    recipe_version_ids: list[UUID],
) -> dict[UUID, RecipeViewerState]:
    """Load one member's private state for a bounded set of public recipe cards."""

    if not recipe_version_ids:
        return {}

    unique_ids = tuple(dict.fromkeys(recipe_version_ids))
    saved_ids = set(
        session.scalars(
            select(RecipeSave.recipe_version_id)
            .join(RecipeVersion, RecipeVersion.id == RecipeSave.recipe_version_id)
            .where(
                RecipeSave.user_id == user_id,
                RecipeSave.recipe_version_id.in_(unique_ids),
                publicly_readable_recipe_version_filter(),
            )
        )
    )
    ratings = {
        recipe_version_id: rating
        for recipe_version_id, rating in session.execute(
            select(RecipeRating.recipe_version_id, RecipeRating.rating)
            .join(RecipeVersion, RecipeVersion.id == RecipeRating.recipe_version_id)
            .where(
                RecipeRating.user_id == user_id,
                RecipeRating.recipe_version_id.in_(unique_ids),
                publicly_readable_recipe_version_filter(),
            )
        )
    }
    return {
        recipe_version_id: RecipeViewerState(
            saved=recipe_version_id in saved_ids,
            rating=ratings.get(recipe_version_id),
        )
        for recipe_version_id in unique_ids
    }


def save_recipe(
    session: Session,
    *,
    user_id: UUID,
    recipe_version_id: UUID,
) -> None:
    statement = (
        insert(RecipeSave)
        .values(user_id=user_id, recipe_version_id=recipe_version_id)
        .on_conflict_do_nothing(index_elements=[RecipeSave.user_id, RecipeSave.recipe_version_id])
    )
    session.execute(statement)


def unsave_recipe(
    session: Session,
    *,
    user_id: UUID,
    recipe_version_id: UUID,
) -> None:
    session.execute(
        delete(RecipeSave).where(
            RecipeSave.user_id == user_id,
            RecipeSave.recipe_version_id == recipe_version_id,
        )
    )


def rate_recipe(
    session: Session,
    *,
    user_id: UUID,
    recipe_version_id: UUID,
    rating: int,
) -> None:
    statement = (
        insert(RecipeRating)
        .values(
            user_id=user_id,
            recipe_version_id=recipe_version_id,
            rating=rating,
        )
        .on_conflict_do_update(
            index_elements=[RecipeRating.user_id, RecipeRating.recipe_version_id],
            set_={"rating": rating},
        )
    )
    session.execute(statement)


def unrate_recipe(
    session: Session,
    *,
    user_id: UUID,
    recipe_version_id: UUID,
) -> None:
    session.execute(
        delete(RecipeRating).where(
            RecipeRating.user_id == user_id,
            RecipeRating.recipe_version_id == recipe_version_id,
        )
    )
