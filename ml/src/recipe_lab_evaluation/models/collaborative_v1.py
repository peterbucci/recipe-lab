from __future__ import annotations

import hashlib
from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from fractions import Fraction
from uuid import UUID

from ..dataset import SnapshotEvent, SnapshotRecipe, canonical_json
from ..protocol import FittedEvaluationModel, JsonScalar, ModelMetadata, ModelTrainingData
from .content_based_v1 import (
    CONTENT_MODEL_ID,
    FORK_SIGNAL_WEIGHT,
    RATING_SIGNAL_UNIT,
    SAVE_FALSE_SIGNAL_WEIGHT,
    SAVE_TRUE_SIGNAL_WEIGHT,
    VIEW_SIGNAL_WEIGHT,
    ContentBasedV1Model,
    derive_preference_signals,
)

COLLABORATIVE_MODEL_ID = "collaborative-v1"
COLLABORATIVE_ARTIFACT_SCHEMA_VERSION = "recipe-lab-collaborative-artifact-v1"
COLLABORATIVE_ARTIFACT_VERSION = "1"

# These per-profile/item thresholds are intentionally aligned with the support
# definitions in the RCP-18A readiness gate.  The aggregate gate is applied to
# the complete snapshot before this model is evaluated; these local thresholds
# decide when a prediction has enough support to use collaborative evidence.
MIN_PROFILE_SIGNAL_ITEMS = 5
MIN_ITEM_SIGNAL_PROFILES = 3
MIN_NEIGHBOR_OVERLAP_ITEMS = 2


@dataclass(frozen=True, slots=True)
class CollaborativeArtifactMetadata:
    """Non-identifying provenance for one fitted collaborative artifact."""

    model_id: str
    model_version: str
    training_cutoff: datetime
    derived_seed: int
    training_data_sha256: str
    recipe_count: int
    event_count: int
    profile_count: int
    observed_event_pair_count: int
    nonzero_signal_pair_count: int
    supported_profile_count: int
    supported_item_count: int


def _timestamp(value: datetime) -> str:
    if value.tzinfo is None:
        raise ValueError("training timestamps must include a timezone")
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _recipe_document(recipe: SnapshotRecipe) -> dict[str, object]:
    return {
        "id": str(recipe.id),
        "created_at": _timestamp(recipe.created_at),
        "title": recipe.title,
        "version_number": recipe.version_number,
        "ingredient_ids": [
            str(ingredient_id)
            for ingredient_id in sorted(recipe.ingredient_ids, key=lambda value: value.int)
        ],
    }


def _event_document(event: SnapshotEvent) -> dict[str, object]:
    return {
        "id": str(event.id),
        "user_id": str(event.user_id),
        "recipe_version_id": str(event.recipe_version_id),
        "event_type": event.event_type,
        "occurred_at": _timestamp(event.occurred_at),
        "saved_value": event.saved_value,
        "rating_value": event.rating_value,
        "related_recipe_version_id": (
            str(event.related_recipe_version_id)
            if event.related_recipe_version_id is not None
            else None
        ),
    }


def _training_data_sha256(training: ModelTrainingData) -> str:
    """Fingerprint the complete fitted prefix without exposing identifiers."""

    document = {
        "cutoff": _timestamp(training.cutoff),
        "recipes": [
            _recipe_document(recipe)
            for recipe in sorted(training.recipes, key=lambda value: value.id.int)
        ],
        "events": [
            _event_document(event)
            for event in sorted(
                training.events,
                key=lambda value: (value.occurred_at, value.id.int),
            )
        ],
    }
    return hashlib.sha256(canonical_json(document).encode("utf-8")).hexdigest()


def _signed_similarity(
    left: Mapping[UUID, int],
    right: Mapping[UUID, int],
) -> Fraction | None:
    """Return exact signed similarity when two profiles have enough overlap."""

    overlap = left.keys() & right.keys()
    if len(overlap) < MIN_NEIGHBOR_OVERLAP_ITEMS:
        return None
    numerator = sum(left[recipe_id] * right[recipe_id] for recipe_id in overlap)
    if numerator == 0:
        return None
    denominator = sum(abs(left[recipe_id] * right[recipe_id]) for recipe_id in overlap)
    if denominator == 0:
        return None
    return Fraction(numerator, denominator)


def score_collaborative_candidate(
    *,
    candidate_id: UUID,
    user_id: UUID,
    target: Mapping[UUID, int],
    signals_by_user: Mapping[UUID, Mapping[UUID, int]],
    profiles_by_recipe: Mapping[UUID, tuple[UUID, ...]],
    similarity_cache: dict[UUID, Fraction | None],
    minimum_item_signal_profiles: int = MIN_ITEM_SIGNAL_PROFILES,
) -> Fraction:
    candidate_profiles = profiles_by_recipe.get(candidate_id, ())
    if len(candidate_profiles) < minimum_item_signal_profiles:
        return Fraction(0)

    numerator = Fraction(0)
    denominator = Fraction(0)
    for neighbor_id in candidate_profiles:
        if neighbor_id == user_id:
            continue
        if neighbor_id not in similarity_cache:
            similarity_cache[neighbor_id] = _signed_similarity(
                target,
                signals_by_user[neighbor_id],
            )
        similarity = similarity_cache[neighbor_id]
        if similarity is None:
            continue
        numerator += similarity * signals_by_user[neighbor_id][candidate_id]
        denominator += abs(similarity)
    if numerator == 0 or denominator == 0:
        return Fraction(0)
    return numerator / denominator


@dataclass(frozen=True, slots=True)
class _FittedCollaborativeV1:
    metadata: ModelMetadata
    artifact_metadata: CollaborativeArtifactMetadata
    signals_by_user: Mapping[UUID, Mapping[UUID, int]]
    profiles_by_recipe: Mapping[UUID, tuple[UUID, ...]]
    fallback: FittedEvaluationModel

    @property
    def collaborative_artifact_document(self) -> Mapping[str, JsonScalar]:
        """Return stable aggregate-only artifact provenance for evaluation reports."""

        artifact = self.artifact_metadata
        return {
            "artifact_schema_version": COLLABORATIVE_ARTIFACT_SCHEMA_VERSION,
            "artifact_version": COLLABORATIVE_ARTIFACT_VERSION,
            "model_id": artifact.model_id,
            "model_version": artifact.model_version,
            "training_cutoff": _timestamp(artifact.training_cutoff),
            "derived_seed": artifact.derived_seed,
            "training_data_sha256": artifact.training_data_sha256,
            "recipe_count": artifact.recipe_count,
            "event_count": artifact.event_count,
            "profile_count": artifact.profile_count,
            "observed_event_pair_count": artifact.observed_event_pair_count,
            "nonzero_signal_pair_count": artifact.nonzero_signal_pair_count,
            "supported_profile_count": artifact.supported_profile_count,
            "supported_item_count": artifact.supported_item_count,
        }

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
        # The content model owns the common candidate/limit validation and gives
        # every candidate a deterministic fallback position.
        fallback_ranking = tuple(
            self.fallback.rank(
                user_id=user_id,
                candidate_ids=candidate_ids,
                limit=len(candidate_ids),
            )
        )
        if limit == 0:
            return ()

        target = self.signals_by_user.get(user_id, {})
        if len(target) < MIN_PROFILE_SIGNAL_ITEMS:
            return fallback_ranking[:limit]

        fallback_position = {
            recipe_id: position for position, recipe_id in enumerate(fallback_ranking)
        }
        similarity_cache: dict[UUID, Fraction | None] = {}
        scored = [
            (
                recipe_id,
                score_collaborative_candidate(
                    candidate_id=recipe_id,
                    user_id=user_id,
                    target=target,
                    signals_by_user=self.signals_by_user,
                    profiles_by_recipe=self.profiles_by_recipe,
                    similarity_cache=similarity_cache,
                ),
            )
            for recipe_id in candidate_ids
        ]
        scored.sort(
            key=lambda item: (
                -item[1],
                fallback_position[item[0]],
            )
        )
        return tuple(recipe_id for recipe_id, _ in scored[:limit])


class CollaborativeV1Model:
    """Deterministic user-neighborhood recommender for offline evaluation only."""

    metadata = ModelMetadata(
        model_id=COLLABORATIVE_MODEL_ID,
        version="1",
        parameters={
            "artifact_metadata": (
                "model_id,model_version,training_cutoff,derived_seed,training_data_sha256,"
                "recipe_count,event_count,profile_count,observed_event_pair_count,"
                "nonzero_signal_pair_count,"
                "supported_profile_count,supported_item_count"
            ),
            "artifact_schema_version": COLLABORATIVE_ARTIFACT_SCHEMA_VERSION,
            "artifact_version": COLLABORATIVE_ARTIFACT_VERSION,
            "candidate_score": (
                "sum(neighbor_similarity*neighbor_candidate_signal)/sum(abs(neighbor_similarity))"
            ),
            "candidate_tie_break": "collaborative_score_desc,content-v1_fallback_rank_asc",
            "cold_start": (
                "profile_below_signal_minimum_or_item_below_profile_minimum_or_"
                "zero_collaborative_evidence_uses_content-v1_order"
            ),
            "fallback_model_id": CONTENT_MODEL_ID,
            "fork_signal_targets": "source_and_child",
            "fork_signal_weight": str(FORK_SIGNAL_WEIGHT),
            "item_support_definition": "distinct_profiles_with_nonzero_aggregate_signal",
            "minimum_item_signal_profiles": MIN_ITEM_SIGNAL_PROFILES,
            "minimum_neighbor_overlap_items": MIN_NEIGHBOR_OVERLAP_ITEMS,
            "minimum_profile_signal_items": MIN_PROFILE_SIGNAL_ITEMS,
            "neighbor_similarity": (
                "sum(target_signal*neighbor_signal)/"
                "sum(abs(target_signal*neighbor_signal))_over_overlap"
            ),
            "profile_signal_aggregation": "sum_by_user_recipe_then_drop_zero",
            "rating_signal_formula": f"(rating-3)*{RATING_SIGNAL_UNIT}",
            "rating_state_policy": "latest_by_occurred_at_then_event_uuid",
            "readiness_gate": "full_snapshot_rcp-18a_gate_required_before_evaluation",
            "repeated_fork_policy": "deduplicate_user_source_child",
            "repeated_view_policy": "deduplicate_user_recipe",
            "save_false_signal_weight": str(SAVE_FALSE_SIGNAL_WEIGHT),
            "save_state_policy": "latest_by_occurred_at_then_event_uuid",
            "save_true_signal_weight": str(SAVE_TRUE_SIGNAL_WEIGHT),
            "seed_policy": "recorded_in_artifact_but_unused_closed_form_model",
            "training_data_fingerprint": ("sha256_of_canonical_cutoff_catalog_and_training_events"),
            "view_signal_weight": str(VIEW_SIGNAL_WEIGHT),
            "zero_similarity_policy": "ignore_neighbor_then_use_content-v1_if_score_is_zero",
        },
    )

    def fit(self, training: ModelTrainingData, *, seed: int) -> _FittedCollaborativeV1:
        if isinstance(seed, bool) or not isinstance(seed, int) or seed < 0:
            raise ValueError("seed must be a non-negative integer")
        fallback = ContentBasedV1Model().fit(training, seed=seed)
        derived_signals = derive_preference_signals(training.events)
        signals_by_user: dict[UUID, dict[UUID, int]] = {
            user_id: {signal.recipe_version_id: signal.weight for signal in signals}
            for user_id, signals in sorted(
                derived_signals.items(),
                key=lambda item: item[0].int,
            )
        }

        profiles_by_recipe_mutable: dict[UUID, list[UUID]] = defaultdict(list)
        for user_id, signals in signals_by_user.items():
            for recipe_id in signals:
                profiles_by_recipe_mutable[recipe_id].append(user_id)
        profiles_by_recipe = {
            recipe_id: tuple(sorted(profile_ids, key=lambda value: value.int))
            for recipe_id, profile_ids in sorted(
                profiles_by_recipe_mutable.items(),
                key=lambda item: item[0].int,
            )
        }

        artifact_metadata = CollaborativeArtifactMetadata(
            model_id=self.metadata.model_id,
            model_version=self.metadata.version,
            training_cutoff=training.cutoff,
            derived_seed=seed,
            training_data_sha256=_training_data_sha256(training),
            recipe_count=len(training.recipes),
            event_count=len(training.events),
            profile_count=len({event.user_id for event in training.events}),
            observed_event_pair_count=len(
                {(event.user_id, event.recipe_version_id) for event in training.events}
            ),
            nonzero_signal_pair_count=sum(len(signals) for signals in signals_by_user.values()),
            supported_profile_count=sum(
                len(signals) >= MIN_PROFILE_SIGNAL_ITEMS for signals in signals_by_user.values()
            ),
            supported_item_count=sum(
                len(profile_ids) >= MIN_ITEM_SIGNAL_PROFILES
                for profile_ids in profiles_by_recipe.values()
            ),
        )
        return _FittedCollaborativeV1(
            metadata=self.metadata,
            artifact_metadata=artifact_metadata,
            signals_by_user=signals_by_user,
            profiles_by_recipe=profiles_by_recipe,
            fallback=fallback,
        )


__all__ = [
    "COLLABORATIVE_ARTIFACT_SCHEMA_VERSION",
    "COLLABORATIVE_ARTIFACT_VERSION",
    "COLLABORATIVE_MODEL_ID",
    "MIN_ITEM_SIGNAL_PROFILES",
    "MIN_NEIGHBOR_OVERLAP_ITEMS",
    "MIN_PROFILE_SIGNAL_ITEMS",
    "CollaborativeArtifactMetadata",
    "CollaborativeV1Model",
    "score_collaborative_candidate",
]
