from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from uuid import UUID

from app.services.recommendation_scoring import (
    BASELINE_STRATEGY,
    FORK_POPULARITY_WEIGHT,
    INGREDIENT_SIMILARITY_WEIGHT,
    PERSONALIZED_GLOBAL_WEIGHT,
    QUALITY_WEIGHT,
    RATING_PRIOR_MEAN,
    RATING_PRIOR_STRENGTH,
    SAVE_POPULARITY_WEIGHT,
    SCORE_QUANTUM,
    VIEW_POPULARITY_WEIGHT,
    BaselineCandidate,
    BaselineProfileEvent,
    BaselineProfileRating,
    BaselineScoringInput,
    RecommendationIngredientMeasure,
    score_baseline_recommendations,
)

from ..dataset import SnapshotEvent, SnapshotIngredientMeasure
from ..protocol import ModelMetadata, ModelTrainingData


def _latest_state_events(
    events: tuple[SnapshotEvent, ...],
    event_type: str,
) -> dict[tuple[UUID, UUID], SnapshotEvent]:
    latest: dict[tuple[UUID, UUID], SnapshotEvent] = {}
    for event in sorted(events, key=lambda item: (item.occurred_at, item.id.int)):
        if event.event_type == event_type:
            latest[(event.user_id, event.recipe_version_id)] = event
    return latest


def _recommendation_measure(
    measure: SnapshotIngredientMeasure,
) -> RecommendationIngredientMeasure:
    return RecommendationIngredientMeasure(
        ingredient_id=measure.ingredient_id,
        kind=measure.kind,
        value=measure.quantity_min if measure.kind == "exact" else None,
        minimum=measure.quantity_min if measure.kind == "range" else None,
        maximum=measure.quantity_max if measure.kind == "range" else None,
        unit_id=measure.measurement_unit_id,
        package_size_id=measure.package_size_id,
        qualitative_value=measure.qualitative_value,
    )


@dataclass(frozen=True, slots=True)
class _FittedBaselineV1:
    metadata: ModelMetadata
    training: ModelTrainingData
    candidates: tuple[BaselineCandidate, ...]
    saved_by_user: dict[UUID, frozenset[UUID]]
    ratings_by_user: dict[UUID, tuple[BaselineProfileRating, ...]]
    events_by_user: dict[UUID, tuple[BaselineProfileEvent, ...]]

    def rank(
        self,
        *,
        user_id: UUID,
        candidate_ids: tuple[UUID, ...],
        limit: int,
    ) -> tuple[UUID, ...]:
        result = score_baseline_recommendations(
            BaselineScoringInput(
                candidates=self.candidates,
                saved_recipe_version_ids=self.saved_by_user.get(user_id, frozenset()),
                ratings=self.ratings_by_user.get(user_id, ()),
                events=self.events_by_user.get(user_id, ()),
            ),
            limit,
        )
        allowed = frozenset(candidate_ids)
        return tuple(
            item.recipe_version_id for item in result.items if item.recipe_version_id in allowed
        )


class BaselineV1Model:
    """Leakage-safe adapter over the same pure scorer used by the API."""

    metadata = ModelMetadata(
        model_id=BASELINE_STRATEGY,
        version="1",
        parameters={
            "fork_popularity_weight": format(FORK_POPULARITY_WEIGHT, "f"),
            "ingredient_similarity_weight": format(INGREDIENT_SIMILARITY_WEIGHT, "f"),
            "personalized_global_weight": format(PERSONALIZED_GLOBAL_WEIGHT, "f"),
            "quality_weight": format(QUALITY_WEIGHT, "f"),
            "rating_prior_mean": format(RATING_PRIOR_MEAN, "f"),
            "rating_prior_strength": format(RATING_PRIOR_STRENGTH, "f"),
            "save_popularity_weight": format(SAVE_POPULARITY_WEIGHT, "f"),
            "score_quantum": format(SCORE_QUANTUM, "f"),
            "scorer": "production-baseline-v1",
            "view_popularity_weight": format(VIEW_POPULARITY_WEIGHT, "f"),
        },
    )

    def fit(self, training: ModelTrainingData, *, seed: int) -> _FittedBaselineV1:
        del seed  # The production baseline is deterministic and has no random parameters.
        latest_saves = _latest_state_events(training.events, "save")
        latest_ratings = _latest_state_events(training.events, "rating")

        saved_by_user_mutable: dict[UUID, set[UUID]] = defaultdict(set)
        save_users_by_recipe: dict[UUID, set[UUID]] = defaultdict(set)
        for (user_id, recipe_version_id), event in latest_saves.items():
            if event.saved_value is True:
                saved_by_user_mutable[user_id].add(recipe_version_id)
                save_users_by_recipe[recipe_version_id].add(user_id)

        ratings_by_user_mutable: dict[UUID, list[BaselineProfileRating]] = defaultdict(list)
        ratings_by_recipe: dict[UUID, list[int]] = defaultdict(list)
        for (user_id, recipe_version_id), event in latest_ratings.items():
            if event.rating_value is None:
                continue
            ratings_by_user_mutable[user_id].append(
                BaselineProfileRating(
                    recipe_version_id=recipe_version_id,
                    rating=event.rating_value,
                )
            )
            ratings_by_recipe[recipe_version_id].append(event.rating_value)

        fork_users_by_recipe: dict[UUID, set[UUID]] = defaultdict(set)
        view_users_by_recipe: dict[UUID, set[UUID]] = defaultdict(set)
        profile_events_mutable: dict[UUID, set[tuple[UUID, str, UUID | None]]] = defaultdict(set)
        for event in training.events:
            profile_events_mutable[event.user_id].add(
                (
                    event.recipe_version_id,
                    event.event_type,
                    event.related_recipe_version_id,
                )
            )
            if event.event_type == "fork":
                fork_users_by_recipe[event.recipe_version_id].add(event.user_id)
            elif event.event_type == "view":
                view_users_by_recipe[event.recipe_version_id].add(event.user_id)

        candidates = tuple(
            BaselineCandidate(
                recipe_version_id=recipe.id,
                title=recipe.title,
                version_number=recipe.version_number,
                ingredient_measures=tuple(
                    _recommendation_measure(measure) for measure in recipe.ingredient_measures
                ),
                rating_sum=sum(ratings_by_recipe.get(recipe.id, ())),
                rating_count=len(ratings_by_recipe.get(recipe.id, ())),
                save_count=len(save_users_by_recipe.get(recipe.id, ())),
                fork_count=len(fork_users_by_recipe.get(recipe.id, ())),
                view_count=len(view_users_by_recipe.get(recipe.id, ())),
                legacy_ingredient_ids=(
                    frozenset(recipe.legacy_ingredient_ids)
                    if not recipe.ingredient_measures
                    else frozenset()
                ),
            )
            for recipe in training.recipes
        )
        saved_by_user = {
            user_id: frozenset(recipe_ids) for user_id, recipe_ids in saved_by_user_mutable.items()
        }
        ratings_by_user = {
            user_id: tuple(sorted(ratings, key=lambda rating: rating.recipe_version_id.int))
            for user_id, ratings in ratings_by_user_mutable.items()
        }
        events_by_user = {
            user_id: tuple(
                BaselineProfileEvent(
                    recipe_version_id=recipe_version_id,
                    event_type=event_type,
                    related_recipe_version_id=related_recipe_version_id,
                )
                for recipe_version_id, event_type, related_recipe_version_id in sorted(
                    values,
                    key=lambda value: (
                        value[0].int,
                        value[1],
                        value[2].int if value[2] is not None else -1,
                    ),
                )
            )
            for user_id, values in profile_events_mutable.items()
        }
        return _FittedBaselineV1(
            metadata=self.metadata,
            training=training,
            candidates=candidates,
            saved_by_user=saved_by_user,
            ratings_by_user=ratings_by_user,
            events_by_user=events_by_user,
        )
