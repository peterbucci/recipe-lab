from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from fractions import Fraction
from typing import Literal, Protocol
from uuid import UUID

from ..dataset import SnapshotRecipe
from ..protocol import (
    FittedRankingModel,
    ModelMetadata,
    ModelTrainingData,
    derive_model_seed,
)
from ._ranking import validate_ranking_request
from .baseline_v1 import BaselineV1Model
from .collaborative_v1 import (
    MIN_ITEM_SIGNAL_PROFILES,
    MIN_NEIGHBOR_OVERLAP_ITEMS,
    MIN_PROFILE_SIGNAL_ITEMS,
    CollaborativeCandidateScore,
    CollaborativeV1Model,
    score_collaborative_candidate_detail,
)
from .content_based_v1 import ContentBasedV1Model

HYBRID_MODEL_ID = "hybrid-v1"
HYBRID_MODEL_VERSION = "1"
HYBRID_FUSION_WINDOW = 50

HYBRID_CONTENT_WEIGHT = 2
HYBRID_COLLABORATIVE_WEIGHT = 2
HYBRID_FALLBACK_WEIGHT = 1
CONTENT_FALLBACK_CONTENT_WEIGHT = 2
CONTENT_FALLBACK_BASELINE_WEIGHT = 1

HYBRID_REASON = (
    "Recipe similarity and interaction patterns from similar profiles shaped this recommendation."
)
CONTENT_FALLBACK_REASON = (
    "Recipe similarity supports this recommendation; collaborative evidence was unavailable."
)
FALLBACK_REASON = (
    "Catalog quality and activity support this recommendation because this profile has no "
    "usable signed preference signal for hybrid ranking."
)
NO_COLLABORATIVE_EVIDENCE_REASON = CONTENT_FALLBACK_REASON
NO_PROFILE_REASON = FALLBACK_REASON

type HybridRoute = Literal["hybrid", "content_fallback", "fallback"]


@dataclass(frozen=True, slots=True)
class HybridRecommendation:
    """One explainable hybrid recommendation with exact normalized components."""

    recipe_version_id: UUID
    score: Fraction
    content_score: Fraction | None
    collaborative_score: Fraction | None
    fallback_score: Fraction
    route: HybridRoute
    reason: str


def linear_rank_score(position: int | None, window: int) -> Fraction:
    """Map a one-based component rank to an exact score inside a bounded window."""

    if isinstance(window, bool) or not isinstance(window, int) or window < 1:
        raise ValueError("window must be a positive integer")
    if position is None:
        return Fraction(0)
    if isinstance(position, bool) or not isinstance(position, int) or not 1 <= position <= window:
        raise ValueError("position must be between one and the window size")
    return Fraction(window - position + 1, window)


def _validate_component_score(name: str, value: Fraction | None) -> None:
    if value is not None and not Fraction(0) <= value <= Fraction(1):
        raise ValueError(f"{name} must be between zero and one")


def combine_hybrid_scores(
    *,
    route: HybridRoute,
    content_score: Fraction | None,
    collaborative_score: Fraction | None,
    fallback_score: Fraction,
) -> Fraction:
    """Combine normalized component scores under one documented cold-start route."""

    _validate_component_score("content_score", content_score)
    _validate_component_score("collaborative_score", collaborative_score)
    _validate_component_score("fallback_score", fallback_score)
    if route == "fallback":
        if content_score is not None or collaborative_score is not None:
            raise ValueError("fallback route must not include personalized component scores")
        return fallback_score
    if route == "content_fallback":
        if content_score is None or collaborative_score is not None:
            raise ValueError("content_fallback route requires content and no collaborative score")
        return (
            CONTENT_FALLBACK_CONTENT_WEIGHT * content_score
            + CONTENT_FALLBACK_BASELINE_WEIGHT * fallback_score
        ) / (CONTENT_FALLBACK_CONTENT_WEIGHT + CONTENT_FALLBACK_BASELINE_WEIGHT)
    if route == "hybrid":
        if content_score is None or collaborative_score is None:
            raise ValueError("hybrid route requires content and collaborative scores")
        return (
            HYBRID_CONTENT_WEIGHT * content_score
            + HYBRID_COLLABORATIVE_WEIGHT * collaborative_score
            + HYBRID_FALLBACK_WEIGHT * fallback_score
        ) / (HYBRID_CONTENT_WEIGHT + HYBRID_COLLABORATIVE_WEIGHT + HYBRID_FALLBACK_WEIGHT)
    raise ValueError("route must be hybrid, content_fallback, or fallback")


def _positions(ranking: tuple[UUID, ...]) -> dict[UUID, int]:
    return {recipe_id: position for position, recipe_id in enumerate(ranking, start=1)}


class _FittedCollaborativeComponent(FittedRankingModel, Protocol):
    @property
    def signals_by_user(self) -> Mapping[UUID, Mapping[UUID, int]]: ...

    @property
    def profiles_by_recipe(self) -> Mapping[UUID, tuple[UUID, ...]]: ...


@dataclass(frozen=True, slots=True)
class _FittedHybridV1:
    metadata: ModelMetadata
    recipes_by_id: Mapping[UUID, SnapshotRecipe]
    content: FittedRankingModel
    collaborative: _FittedCollaborativeComponent
    fallback: FittedRankingModel

    def _collaborative_detail(
        self,
        *,
        candidate_id: UUID,
        user_id: UUID,
        target: Mapping[UUID, int],
        similarity_cache: dict[UUID, Fraction | None],
    ) -> CollaborativeCandidateScore:
        if len(target) < MIN_PROFILE_SIGNAL_ITEMS:
            return CollaborativeCandidateScore(Fraction(0), False)
        return score_collaborative_candidate_detail(
            candidate_id=candidate_id,
            user_id=user_id,
            target=target,
            signals_by_user=self.collaborative.signals_by_user,
            profiles_by_recipe=self.collaborative.profiles_by_recipe,
            similarity_cache=similarity_cache,
        )

    def recommend(
        self,
        *,
        user_id: UUID,
        candidate_ids: tuple[UUID, ...],
        limit: int,
    ) -> tuple[HybridRecommendation, ...]:
        validate_ranking_request(
            candidate_ids=candidate_ids,
            limit=limit,
            fitted_recipe_ids=self.recipes_by_id.keys(),
        )
        if limit == 0:
            return ()

        window = min(len(candidate_ids), HYBRID_FUSION_WINDOW)
        content_ranking = tuple(
            self.content.rank(
                user_id=user_id,
                candidate_ids=candidate_ids,
                limit=window,
            )
        )
        collaborative_ranking = tuple(
            self.collaborative.rank(
                user_id=user_id,
                candidate_ids=candidate_ids,
                limit=window,
            )
        )
        fallback_ranking = tuple(
            self.fallback.rank(
                user_id=user_id,
                candidate_ids=candidate_ids,
                limit=window,
            )
        )
        content_positions = _positions(content_ranking)
        collaborative_positions = _positions(collaborative_ranking)
        fallback_positions = _positions(fallback_ranking)

        target = self.collaborative.signals_by_user.get(user_id, {})
        has_profile = bool(target)
        similarity_cache: dict[UUID, Fraction | None] = {}
        scored: list[HybridRecommendation] = []
        for recipe_id in candidate_ids:
            fallback_score = linear_rank_score(
                fallback_positions.get(recipe_id),
                window,
            )
            if not has_profile:
                route: HybridRoute = "fallback"
                content_score: Fraction | None = None
                collaborative_score: Fraction | None = None
                reason = FALLBACK_REASON
            else:
                content_score = linear_rank_score(
                    content_positions.get(recipe_id),
                    window,
                )
                detail = self._collaborative_detail(
                    candidate_id=recipe_id,
                    user_id=user_id,
                    target=target,
                    similarity_cache=similarity_cache,
                )
                if detail.has_usable_evidence:
                    route = "hybrid"
                    collaborative_score = linear_rank_score(
                        collaborative_positions.get(recipe_id),
                        window,
                    )
                    reason = HYBRID_REASON
                else:
                    route = "content_fallback"
                    collaborative_score = None
                    reason = CONTENT_FALLBACK_REASON
            scored.append(
                HybridRecommendation(
                    recipe_version_id=recipe_id,
                    score=combine_hybrid_scores(
                        route=route,
                        content_score=content_score,
                        collaborative_score=collaborative_score,
                        fallback_score=fallback_score,
                    ),
                    content_score=content_score,
                    collaborative_score=collaborative_score,
                    fallback_score=fallback_score,
                    route=route,
                    reason=reason,
                )
            )

        scored.sort(
            key=lambda item: (
                -item.score,
                content_positions.get(item.recipe_version_id, window + 1),
                fallback_positions.get(item.recipe_version_id, window + 1),
                self.recipes_by_id[item.recipe_version_id].title.strip().casefold(),
                self.recipes_by_id[item.recipe_version_id].title.strip(),
                self.recipes_by_id[item.recipe_version_id].version_number,
                item.recipe_version_id.int,
            )
        )
        return tuple(scored[:limit])

    def rank(
        self,
        *,
        user_id: UUID,
        candidate_ids: tuple[UUID, ...],
        limit: int,
    ) -> tuple[UUID, ...]:
        return tuple(
            item.recipe_version_id
            for item in self.recommend(
                user_id=user_id,
                candidate_ids=candidate_ids,
                limit=limit,
            )
        )


class HybridV1Model:
    """Deterministic explainable fusion of content, collaborative, and baseline ranks."""

    metadata = ModelMetadata(
        model_id=HYBRID_MODEL_ID,
        version=HYBRID_MODEL_VERSION,
        parameters={
            "candidate_score": (
                "hybrid=(2*content+2*collaborative+fallback)/5;"
                "content_fallback=(2*content+fallback)/3;fallback=fallback"
            ),
            "candidate_tie_break": (
                "hybrid_score_desc,content_rank_asc,fallback_rank_asc,"
                "trimmed_title_casefold_asc,trimmed_title_asc,version_asc,uuid_asc"
            ),
            "collaborative_evidence": (
                "target_and_item_thresholds_met_and_final_signed_candidate_score_nonzero"
            ),
            "collaborative_model_id": CollaborativeV1Model.metadata.model_id,
            "collaborative_model_version": CollaborativeV1Model.metadata.version,
            "collaborative_weight": HYBRID_COLLABORATIVE_WEIGHT,
            "component_rank_score": "(window-rank+1)/window;unranked=0",
            "content_fallback_content_weight": CONTENT_FALLBACK_CONTENT_WEIGHT,
            "content_fallback_fallback_weight": CONTENT_FALLBACK_BASELINE_WEIGHT,
            "content_model_id": ContentBasedV1Model.metadata.model_id,
            "content_model_version": ContentBasedV1Model.metadata.version,
            "content_weight": HYBRID_CONTENT_WEIGHT,
            "cold_start": (
                "no_nonzero_profile_uses_fallback;missing_collaborative_evidence_uses_"
                "content_fallback"
            ),
            "fallback_model_id": BaselineV1Model.metadata.model_id,
            "fallback_model_version": BaselineV1Model.metadata.version,
            "fallback_weight": HYBRID_FALLBACK_WEIGHT,
            "fusion_window": HYBRID_FUSION_WINDOW,
            "minimum_item_signal_profiles": MIN_ITEM_SIGNAL_PROFILES,
            "minimum_neighbor_overlap_items": MIN_NEIGHBOR_OVERLAP_ITEMS,
            "minimum_profile_signal_items": MIN_PROFILE_SIGNAL_ITEMS,
            "reason_policy": "fixed_human_readable_reason_by_candidate_route",
            "route_policy": "hybrid_or_content_fallback_per_candidate;fallback_per_profile",
            "seed_policy": "derive_isolated_component_seeds_from_hybrid_seed_and_model_id",
        },
    )

    def fit(self, training: ModelTrainingData, *, seed: int) -> _FittedHybridV1:
        if isinstance(seed, bool) or not isinstance(seed, int) or seed < 0:
            raise ValueError("seed must be a non-negative integer")

        content_model = ContentBasedV1Model()
        collaborative_model = CollaborativeV1Model()
        fallback_model = BaselineV1Model()
        content = content_model.fit(
            training,
            seed=derive_model_seed(seed, content_model.metadata.model_id),
        )
        collaborative = collaborative_model.fit(
            training,
            seed=derive_model_seed(seed, collaborative_model.metadata.model_id),
        )
        fallback = fallback_model.fit(
            training,
            seed=derive_model_seed(seed, fallback_model.metadata.model_id),
        )
        return _FittedHybridV1(
            metadata=self.metadata,
            recipes_by_id={recipe.id: recipe for recipe in training.recipes},
            content=content,
            collaborative=collaborative,
            fallback=fallback,
        )


__all__ = [
    "CONTENT_FALLBACK_BASELINE_WEIGHT",
    "CONTENT_FALLBACK_CONTENT_WEIGHT",
    "CONTENT_FALLBACK_REASON",
    "FALLBACK_REASON",
    "HYBRID_COLLABORATIVE_WEIGHT",
    "HYBRID_CONTENT_WEIGHT",
    "HYBRID_FALLBACK_WEIGHT",
    "HYBRID_FUSION_WINDOW",
    "HYBRID_MODEL_ID",
    "HYBRID_MODEL_VERSION",
    "HYBRID_REASON",
    "NO_COLLABORATIVE_EVIDENCE_REASON",
    "NO_PROFILE_REASON",
    "HybridRecommendation",
    "HybridRoute",
    "HybridV1Model",
    "combine_hybrid_scores",
    "linear_rank_score",
]
