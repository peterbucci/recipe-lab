from __future__ import annotations

import re
from collections import defaultdict
from collections.abc import Mapping, Sequence, Set
from dataclasses import dataclass
from fractions import Fraction
from uuid import UUID

from ..dataset import SnapshotEvent, SnapshotRecipe
from ..protocol import ModelMetadata, ModelTrainingData

CONTENT_MODEL_ID = "content-v1"

INGREDIENT_SIMILARITY_WEIGHT = 6
TITLE_SIMILARITY_WEIGHT = 3
VERSION_SIMILARITY_WEIGHT = 1
TOTAL_SIMILARITY_WEIGHT = (
    INGREDIENT_SIMILARITY_WEIGHT + TITLE_SIMILARITY_WEIGHT + VERSION_SIMILARITY_WEIGHT
)

SAVE_TRUE_SIGNAL_WEIGHT = 3
SAVE_FALSE_SIGNAL_WEIGHT = -3
RATING_SIGNAL_UNIT = 2
FORK_SIGNAL_WEIGHT = 4
VIEW_SIGNAL_WEIGHT = 1

_TITLE_TOKEN_PATTERN = re.compile(r"[^\W_]+", flags=re.UNICODE)


@dataclass(frozen=True, slots=True)
class RecipeContentFeatures:
    """Canonical structured features for one recipe version."""

    recipe_version_id: UUID
    title: str
    version_number: int
    ingredient_ids: frozenset[UUID]
    title_tokens: frozenset[str]


@dataclass(frozen=True, slots=True)
class PreferenceSignal:
    """One user's aggregate signed preference for a recipe version."""

    recipe_version_id: UUID
    weight: int


def normalize_title_tokens(title: str) -> frozenset[str]:
    """Return deterministic Unicode-alphanumeric title tokens."""

    return frozenset(_TITLE_TOKEN_PATTERN.findall(title.casefold()))


def recipe_content_features(recipe: SnapshotRecipe) -> RecipeContentFeatures:
    """Build content features without consulting interaction or holdout data."""

    return RecipeContentFeatures(
        recipe_version_id=recipe.id,
        title=recipe.title,
        version_number=recipe.version_number,
        ingredient_ids=frozenset(recipe.ingredient_ids),
        title_tokens=normalize_title_tokens(recipe.title),
    )


def _jaccard[FeatureValue](
    left: Set[FeatureValue],
    right: Set[FeatureValue],
) -> Fraction:
    if not left or not right:
        return Fraction(0)
    return Fraction(len(left & right), len(left | right))


def content_similarity(
    left: RecipeContentFeatures,
    right: RecipeContentFeatures,
) -> Fraction:
    """Return the exact weighted content similarity between two recipe versions."""

    ingredient_similarity = _jaccard(left.ingredient_ids, right.ingredient_ids)
    title_similarity = _jaccard(left.title_tokens, right.title_tokens)
    version_similarity = Fraction(1, 1 + abs(left.version_number - right.version_number))
    return (
        INGREDIENT_SIMILARITY_WEIGHT * ingredient_similarity
        + TITLE_SIMILARITY_WEIGHT * title_similarity
        + VERSION_SIMILARITY_WEIGHT * version_similarity
    ) / TOTAL_SIMILARITY_WEIGHT


def derive_preference_signals(
    events: Sequence[SnapshotEvent],
) -> dict[UUID, tuple[PreferenceSignal, ...]]:
    """Collapse a training prefix into deterministic signed user preferences."""

    ordered_events = tuple(sorted(events, key=lambda event: (event.occurred_at, event.id.int)))
    latest_saves: dict[tuple[UUID, UUID], SnapshotEvent] = {}
    latest_ratings: dict[tuple[UUID, UUID], SnapshotEvent] = {}
    views: set[tuple[UUID, UUID]] = set()
    forks: set[tuple[UUID, UUID, UUID]] = set()
    for event in ordered_events:
        key = (event.user_id, event.recipe_version_id)
        if event.event_type == "save":
            latest_saves[key] = event
        elif event.event_type == "rating":
            latest_ratings[key] = event
        elif event.event_type == "view":
            views.add(key)
        elif event.event_type == "fork" and event.related_recipe_version_id is not None:
            forks.add((event.user_id, event.recipe_version_id, event.related_recipe_version_id))

    weights: dict[UUID, dict[UUID, int]] = defaultdict(lambda: defaultdict(int))
    for (user_id, recipe_version_id), event in sorted(
        latest_saves.items(),
        key=lambda item: (item[0][0].int, item[0][1].int),
    ):
        if event.saved_value is not None:
            weights[user_id][recipe_version_id] += (
                SAVE_TRUE_SIGNAL_WEIGHT if event.saved_value else SAVE_FALSE_SIGNAL_WEIGHT
            )
    for (user_id, recipe_version_id), event in sorted(
        latest_ratings.items(),
        key=lambda item: (item[0][0].int, item[0][1].int),
    ):
        if event.rating_value is not None:
            weights[user_id][recipe_version_id] += (event.rating_value - 3) * RATING_SIGNAL_UNIT
    for user_id, recipe_version_id in sorted(views, key=lambda item: (item[0].int, item[1].int)):
        weights[user_id][recipe_version_id] += VIEW_SIGNAL_WEIGHT
    for user_id, source_id, child_id in sorted(
        forks,
        key=lambda item: (item[0].int, item[1].int, item[2].int),
    ):
        weights[user_id][source_id] += FORK_SIGNAL_WEIGHT
        weights[user_id][child_id] += FORK_SIGNAL_WEIGHT

    return {
        user_id: tuple(
            PreferenceSignal(recipe_version_id=recipe_version_id, weight=weight)
            for recipe_version_id, weight in sorted(
                recipe_weights.items(),
                key=lambda item: item[0].int,
            )
            if weight != 0
        )
        for user_id, recipe_weights in sorted(weights.items(), key=lambda item: item[0].int)
        if any(weight != 0 for weight in recipe_weights.values())
    }


def _content_affinity(
    candidate: RecipeContentFeatures,
    profile: tuple[PreferenceSignal, ...],
    features_by_recipe: Mapping[UUID, RecipeContentFeatures],
) -> Fraction:
    if not profile:
        return Fraction(0)
    numerator = sum(
        (
            signal.weight
            * content_similarity(candidate, features_by_recipe[signal.recipe_version_id])
            for signal in profile
        ),
        start=Fraction(0),
    )
    denominator = sum(abs(signal.weight) for signal in profile)
    if numerator == 0 or denominator == 0:
        return Fraction(0)
    return numerator / denominator


@dataclass(frozen=True, slots=True)
class _FittedContentBasedV1:
    metadata: ModelMetadata
    features_by_recipe: Mapping[UUID, RecipeContentFeatures]
    signals_by_user: Mapping[UUID, tuple[PreferenceSignal, ...]]
    global_prior_by_recipe: Mapping[UUID, int]

    def rank(
        self,
        *,
        user_id: UUID,
        candidate_ids: tuple[UUID, ...],
        limit: int,
    ) -> tuple[UUID, ...]:
        if (
            isinstance(limit, bool)
            or not isinstance(limit, int)
            or not 0 <= limit <= len(candidate_ids)
        ):
            raise ValueError("limit must be between zero and the candidate count")
        if len(candidate_ids) != len(set(candidate_ids)):
            raise ValueError("candidate_ids must not contain duplicates")
        unknown = frozenset(candidate_ids) - self.features_by_recipe.keys()
        if unknown:
            raise ValueError("candidate_ids contains a recipe outside the fitted catalog")

        profile = self.signals_by_user.get(user_id, ())
        scored = [
            (
                recipe_id,
                _content_affinity(
                    self.features_by_recipe[recipe_id],
                    profile,
                    self.features_by_recipe,
                ),
            )
            for recipe_id in candidate_ids
        ]
        scored.sort(
            key=lambda item: (
                -item[1],
                -self.global_prior_by_recipe.get(item[0], 0),
                self.features_by_recipe[item[0]].title.strip().casefold(),
                self.features_by_recipe[item[0]].title.strip(),
                self.features_by_recipe[item[0]].version_number,
                item[0].int,
            )
        )
        return tuple(recipe_id for recipe_id, _ in scored[:limit])


class ContentBasedV1Model:
    """Deterministic signed-profile content recommender for offline evaluation."""

    metadata = ModelMetadata(
        model_id=CONTENT_MODEL_ID,
        version="1",
        parameters={
            "candidate_tie_break": (
                "content_affinity_desc,global_signed_prior_desc,"
                "trimmed_title_casefold_asc,trimmed_title_asc,version_asc,uuid_asc"
            ),
            "cold_start": (
                "no_nonzero_profile_or_zero_affinity_uses_"
                "global_signed_prior_then_stable_recipe_metadata"
            ),
            "fork_signal_targets": "source_and_child",
            "fork_signal_weight": str(FORK_SIGNAL_WEIGHT),
            "global_prior": "sum_of_nonzero_aggregate_user_recipe_signals",
            "ingredient_similarity_weight": str(INGREDIENT_SIMILARITY_WEIGHT),
            "jaccard_empty_policy": "zero_if_either_feature_set_is_empty",
            "profile_normalization": "sum_absolute_aggregate_signal_weights",
            "profile_signal_aggregation": "sum_by_user_recipe_then_drop_zero",
            "rating_signal_formula": f"(rating-3)*{RATING_SIGNAL_UNIT}",
            "repeated_fork_policy": "deduplicate_user_source_child",
            "repeated_view_policy": "deduplicate_user_recipe",
            "save_false_signal_weight": str(SAVE_FALSE_SIGNAL_WEIGHT),
            "save_state_policy": "latest_by_occurred_at_then_event_uuid",
            "save_true_signal_weight": str(SAVE_TRUE_SIGNAL_WEIGHT),
            "seed_policy": "accepted_but_unused_closed_form_model",
            "similarity": "weighted_ingredient_title_jaccard_plus_version_proximity",
            "similarity_normalization": f"divide_by_{TOTAL_SIMILARITY_WEIGHT}",
            "title_similarity_weight": str(TITLE_SIMILARITY_WEIGHT),
            "title_tokenization": "unicode_alphanumeric_casefold_unique",
            "rating_state_policy": "latest_by_occurred_at_then_event_uuid",
            "version_similarity": "1/(1+absolute_version_difference)",
            "version_similarity_weight": str(VERSION_SIMILARITY_WEIGHT),
            "view_signal_weight": str(VIEW_SIGNAL_WEIGHT),
        },
    )

    def fit(self, training: ModelTrainingData, *, seed: int) -> _FittedContentBasedV1:
        del seed  # This closed-form model is deterministic without random sampling.
        ordered_recipes = tuple(sorted(training.recipes, key=lambda recipe: recipe.id.int))
        features_by_recipe = {
            recipe.id: recipe_content_features(recipe) for recipe in ordered_recipes
        }
        if len(features_by_recipe) != len(ordered_recipes):
            raise ValueError("training recipes must have unique IDs")

        referenced_recipe_ids = {
            recipe_id
            for event in training.events
            for recipe_id in (event.recipe_version_id, event.related_recipe_version_id)
            if recipe_id is not None
        }
        if not referenced_recipe_ids <= features_by_recipe.keys():
            raise ValueError("training events reference a recipe outside the fitted catalog")

        signals_by_user = derive_preference_signals(training.events)

        global_prior: dict[UUID, int] = defaultdict(int)
        for user_id in sorted(signals_by_user, key=lambda value: value.int):
            for signal in signals_by_user[user_id]:
                global_prior[signal.recipe_version_id] += signal.weight

        return _FittedContentBasedV1(
            metadata=self.metadata,
            features_by_recipe=features_by_recipe,
            signals_by_user=signals_by_user,
            global_prior_by_recipe=dict(sorted(global_prior.items(), key=lambda item: item[0].int)),
        )


__all__ = [
    "CONTENT_MODEL_ID",
    "FORK_SIGNAL_WEIGHT",
    "INGREDIENT_SIMILARITY_WEIGHT",
    "RATING_SIGNAL_UNIT",
    "SAVE_FALSE_SIGNAL_WEIGHT",
    "SAVE_TRUE_SIGNAL_WEIGHT",
    "TITLE_SIMILARITY_WEIGHT",
    "TOTAL_SIMILARITY_WEIGHT",
    "VERSION_SIMILARITY_WEIGHT",
    "VIEW_SIGNAL_WEIGHT",
    "ContentBasedV1Model",
    "PreferenceSignal",
    "RecipeContentFeatures",
    "content_similarity",
    "derive_preference_signals",
    "normalize_title_tokens",
    "recipe_content_features",
]
