from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import RecipeRating, RecipeSave, RecipeVersion, User


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
        session.scalar(select(RecipeVersion.id).where(RecipeVersion.id == recipe_version_id))
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
