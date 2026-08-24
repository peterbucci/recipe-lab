from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session, raiseload, selectinload

from app.models import (
    PreferenceEvent,
    RecipeRating,
    RecipeSave,
    RecipeVersion,
)


@dataclass(frozen=True, slots=True)
class RecommendationCandidateData:
    recipe: RecipeVersion
    ingredient_ids: frozenset[UUID]
    rating_sum: int
    rating_count: int
    save_count: int
    fork_count: int
    view_count: int


@dataclass(frozen=True, slots=True)
class RecommendationUserRating:
    recipe_version_id: UUID
    rating: int


@dataclass(frozen=True, slots=True)
class RecommendationUserEvent:
    recipe_version_id: UUID
    event_type: str
    related_recipe_version_id: UUID | None


@dataclass(frozen=True, slots=True)
class RecommendationData:
    candidates: tuple[RecommendationCandidateData, ...]
    saved_recipe_version_ids: frozenset[UUID]
    ratings: tuple[RecommendationUserRating, ...]
    events: tuple[RecommendationUserEvent, ...]


def load_recommendation_data(
    session: Session,
    user_id: UUID | None,
) -> RecommendationData:
    """Load catalog signals plus only the optional signed-in member's private history."""

    rating_aggregates = (
        select(
            RecipeRating.recipe_version_id.label("recipe_version_id"),
            func.sum(RecipeRating.rating).label("rating_sum"),
            func.count(RecipeRating.user_id).label("rating_count"),
        )
        .group_by(RecipeRating.recipe_version_id)
        .subquery()
    )
    save_aggregates = (
        select(
            RecipeSave.recipe_version_id.label("recipe_version_id"),
            func.count(distinct(RecipeSave.user_id)).label("save_count"),
        )
        .group_by(RecipeSave.recipe_version_id)
        .subquery()
    )
    event_aggregates = (
        select(
            PreferenceEvent.recipe_version_id.label("recipe_version_id"),
            func.count(distinct(PreferenceEvent.user_id))
            .filter(PreferenceEvent.event_type == "fork")
            .label("fork_count"),
            func.count(distinct(PreferenceEvent.user_id))
            .filter(PreferenceEvent.event_type == "view")
            .label("view_count"),
        )
        .where(PreferenceEvent.event_type.in_(("fork", "view")))
        .group_by(PreferenceEvent.recipe_version_id)
        .subquery()
    )

    candidate_statement = (
        select(
            RecipeVersion,
            func.coalesce(rating_aggregates.c.rating_sum, 0),
            func.coalesce(rating_aggregates.c.rating_count, 0),
            func.coalesce(save_aggregates.c.save_count, 0),
            func.coalesce(event_aggregates.c.fork_count, 0),
            func.coalesce(event_aggregates.c.view_count, 0),
        )
        .outerjoin(
            rating_aggregates,
            rating_aggregates.c.recipe_version_id == RecipeVersion.id,
        )
        .outerjoin(
            save_aggregates,
            save_aggregates.c.recipe_version_id == RecipeVersion.id,
        )
        .outerjoin(
            event_aggregates,
            event_aggregates.c.recipe_version_id == RecipeVersion.id,
        )
        .options(selectinload(RecipeVersion.ingredients), raiseload("*"))
        .order_by(
            func.lower(func.btrim(RecipeVersion.title)),
            func.btrim(RecipeVersion.title),
            RecipeVersion.version_number,
            RecipeVersion.id,
        )
    )
    candidates = tuple(
        RecommendationCandidateData(
            recipe=recipe,
            ingredient_ids=frozenset(
                item.ingredient_id for item in recipe.ingredients if item.ingredient_id is not None
            ),
            rating_sum=int(rating_sum),
            rating_count=int(rating_count),
            save_count=int(save_count),
            fork_count=int(fork_count),
            view_count=int(view_count),
        )
        for recipe, rating_sum, rating_count, save_count, fork_count, view_count in session.execute(
            candidate_statement
        )
    )

    saved_recipe_version_ids: frozenset[UUID] = frozenset()
    ratings: tuple[RecommendationUserRating, ...] = ()
    events: tuple[RecommendationUserEvent, ...] = ()
    if user_id is not None:
        saved_recipe_version_ids = frozenset(
            session.scalars(
                select(RecipeSave.recipe_version_id).where(RecipeSave.user_id == user_id)
            )
        )
        ratings = tuple(
            RecommendationUserRating(recipe_version_id=recipe_version_id, rating=int(rating))
            for recipe_version_id, rating in session.execute(
                select(RecipeRating.recipe_version_id, RecipeRating.rating)
                .where(RecipeRating.user_id == user_id)
                .order_by(RecipeRating.recipe_version_id)
            )
        )
        events = tuple(
            RecommendationUserEvent(
                recipe_version_id=recipe_version_id,
                event_type=event_type,
                related_recipe_version_id=related_recipe_version_id,
            )
            for recipe_version_id, event_type, related_recipe_version_id in session.execute(
                select(
                    PreferenceEvent.recipe_version_id,
                    PreferenceEvent.event_type,
                    PreferenceEvent.related_recipe_version_id,
                )
                .where(PreferenceEvent.user_id == user_id)
                .distinct()
                .order_by(
                    PreferenceEvent.recipe_version_id,
                    PreferenceEvent.event_type,
                    PreferenceEvent.related_recipe_version_id,
                )
            )
        )
    return RecommendationData(
        candidates=candidates,
        saved_recipe_version_ids=saved_recipe_version_ids,
        ratings=ratings,
        events=events,
    )
