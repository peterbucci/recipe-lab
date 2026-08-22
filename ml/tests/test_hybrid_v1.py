from dataclasses import replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from fractions import Fraction
from pathlib import Path
from uuid import UUID

import pytest

from recipe_lab_evaluation.dataset import (
    EvaluationSnapshot,
    EventType,
    SnapshotEvent,
    SnapshotRecipe,
    load_snapshot,
)
from recipe_lab_evaluation.models import (
    HYBRID_MODEL_ID,
    BaselineV1Model,
    CollaborativeV1Model,
    ContentBasedV1Model,
    HybridV1Model,
)
from recipe_lab_evaluation.models.hybrid_v1 import (
    CONTENT_FALLBACK_REASON,
    FALLBACK_REASON,
    HYBRID_REASON,
    combine_hybrid_scores,
    linear_rank_score,
)
from recipe_lab_evaluation.protocol import ModelTrainingData
from recipe_lab_evaluation.runner import EvaluationConfig, evaluate
from recipe_lab_evaluation.simulator import CohortSimulationConfig, simulate_preference_cohort
from recipe_lab_evaluation.split import split_snapshot

_CUTOFF = datetime(2026, 8, 1, tzinfo=UTC)
_TRAINING_TIME = _CUTOFF - timedelta(days=1)
_TARGET_PROFILE = UUID(int=900)
_UNKNOWN_PROFILE = UUID(int=901)
_READINESS_CATALOG = Path(__file__).parent / "fixtures" / "readiness_catalog_v1.json"


def _recipe(
    identifier: int,
    *,
    title: str | None = None,
    ingredients: tuple[int, ...] = (),
) -> SnapshotRecipe:
    return SnapshotRecipe(
        id=UUID(int=identifier),
        created_at=_CUTOFF - timedelta(days=30),
        title=title or f"Recipe {identifier}",
        version_number=1,
        ingredient_ids=tuple(UUID(int=value) for value in ingredients),
    )


def _event(
    identifier: int,
    *,
    profile_id: UUID,
    recipe_id: UUID,
    event_type: EventType,
    saved_value: bool | None = None,
    rating_value: int | None = None,
) -> SnapshotEvent:
    return SnapshotEvent(
        id=UUID(int=10_000 + identifier),
        user_id=profile_id,
        recipe_version_id=recipe_id,
        event_type=event_type,
        occurred_at=_TRAINING_TIME,
        saved_value=saved_value,
        rating_value=rating_value,
        related_recipe_version_id=None,
    )


def _training(
    recipes: tuple[SnapshotRecipe, ...],
    events: tuple[SnapshotEvent, ...],
) -> ModelTrainingData:
    return ModelTrainingData(cutoff=_CUTOFF, recipes=recipes, events=events)


def _supported_fixture() -> tuple[
    ModelTrainingData,
    tuple[SnapshotRecipe, ...],
    SnapshotRecipe,
    SnapshotRecipe,
]:
    anchors = tuple(_recipe(index, ingredients=(100 + index,)) for index in range(1, 6))
    supported = _recipe(6, title="Supported", ingredients=(501,))
    unsupported = _recipe(7, title="Unsupported", ingredients=(502,))
    events: list[SnapshotEvent] = []
    event_id = 1

    for anchor in anchors:
        events.append(
            _event(
                event_id,
                profile_id=_TARGET_PROFILE,
                recipe_id=anchor.id,
                event_type="save",
                saved_value=True,
            )
        )
        event_id += 1

    for neighbor_index, profile_int in enumerate(range(1_001, 1_004)):
        profile_id = UUID(int=profile_int)
        for anchor in anchors[:2]:
            events.append(
                _event(
                    event_id,
                    profile_id=profile_id,
                    recipe_id=anchor.id,
                    event_type="view",
                )
            )
            event_id += 1
        events.append(
            _event(
                event_id,
                profile_id=profile_id,
                recipe_id=supported.id,
                event_type="save",
                saved_value=True,
            )
        )
        event_id += 1
        if neighbor_index < 2:
            events.append(
                _event(
                    event_id,
                    profile_id=profile_id,
                    recipe_id=unsupported.id,
                    event_type="save",
                    saved_value=True,
                )
            )
            event_id += 1

    return (
        _training((*anchors, supported, unsupported), tuple(events)),
        anchors,
        supported,
        unsupported,
    )


def _component_scores(
    training: ModelTrainingData,
    *,
    user_id: UUID,
    candidate_ids: tuple[UUID, ...],
) -> tuple[dict[UUID, Fraction], dict[UUID, Fraction], dict[UUID, Fraction]]:
    window = min(len(candidate_ids), 50)
    fitted_models = (
        BaselineV1Model().fit(training, seed=0),
        ContentBasedV1Model().fit(training, seed=0),
        CollaborativeV1Model().fit(training, seed=0),
    )
    score_maps: list[dict[UUID, Fraction]] = []
    for fitted in fitted_models:
        ranking = fitted.rank(
            user_id=user_id,
            candidate_ids=candidate_ids,
            limit=window,
        )
        position = {recipe_id: index for index, recipe_id in enumerate(ranking, start=1)}
        score_maps.append(
            {
                recipe_id: linear_rank_score(position.get(recipe_id), window)
                for recipe_id in candidate_ids
            }
        )
    return score_maps[0], score_maps[1], score_maps[2]


def test_linear_rank_and_route_formulas_are_exact() -> None:
    assert linear_rank_score(1, 5) == Fraction(1)
    assert linear_rank_score(2, 5) == Fraction(4, 5)
    assert linear_rank_score(3, 5) == Fraction(3, 5)
    assert linear_rank_score(5, 5) == Fraction(1, 5)
    assert linear_rank_score(50, 50) == Fraction(1, 50)
    assert linear_rank_score(None, 50) == Fraction(0)

    fallback = Fraction(3, 5)
    content = Fraction(4, 5)
    collaborative = Fraction(1)
    assert combine_hybrid_scores(
        route="fallback",
        fallback_score=fallback,
        content_score=None,
        collaborative_score=None,
    ) == Fraction(3, 5)
    assert combine_hybrid_scores(
        route="content_fallback",
        fallback_score=fallback,
        content_score=content,
        collaborative_score=None,
    ) == Fraction(11, 15)
    assert combine_hybrid_scores(
        route="hybrid",
        fallback_score=fallback,
        content_score=content,
        collaborative_score=collaborative,
    ) == Fraction(21, 25)


def test_model_metadata_versions_every_component_weight_route_and_reason_policy() -> None:
    metadata = HybridV1Model.metadata

    assert metadata.model_id == HYBRID_MODEL_ID == "hybrid-v1"
    assert metadata.version == "1"
    assert metadata.parameters["fusion_window"] == 50
    assert metadata.parameters["component_rank_score"] == ("(window-rank+1)/window;unranked=0")
    assert metadata.parameters["content_weight"] == 2
    assert metadata.parameters["collaborative_weight"] == 2
    assert metadata.parameters["fallback_weight"] == 1
    assert metadata.parameters["content_fallback_content_weight"] == 2
    assert metadata.parameters["content_fallback_fallback_weight"] == 1
    assert metadata.parameters["content_model_id"] == "content-v1"
    assert metadata.parameters["collaborative_model_id"] == "collaborative-v1"
    assert metadata.parameters["fallback_model_id"] == "baseline-v1"
    assert metadata.parameters["reason_policy"] == (
        "fixed_human_readable_reason_by_candidate_route"
    )
    assert metadata.parameters["route_policy"] == (
        "hybrid_or_content_fallback_per_candidate;fallback_per_profile"
    )


def test_score_helpers_reject_impossible_positions_routes_and_components() -> None:
    for position, window in ((0, 5), (6, 5), (True, 5), (1, 0), (1, True)):
        with pytest.raises(ValueError):
            linear_rank_score(position, window)

    with pytest.raises(ValueError, match="requires content and no collaborative"):
        combine_hybrid_scores(
            route="content_fallback",
            fallback_score=Fraction(1, 2),
            content_score=Fraction(1, 2),
            collaborative_score=Fraction(1, 2),
        )
    with pytest.raises(ValueError, match="must not include personalized"):
        combine_hybrid_scores(
            route="fallback",
            fallback_score=Fraction(1, 2),
            content_score=Fraction(1, 2),
            collaborative_score=None,
        )
    with pytest.raises(ValueError, match="requires content and collaborative"):
        combine_hybrid_scores(
            route="hybrid",
            fallback_score=Fraction(1, 2),
            content_score=Fraction(1, 2),
            collaborative_score=None,
        )
    with pytest.raises(ValueError, match="between zero and one"):
        combine_hybrid_scores(
            route="fallback",
            fallback_score=Fraction(2),
            content_score=None,
            collaborative_score=None,
        )


def test_breakdowns_reconstruct_scores_and_rank_projection() -> None:
    training, _, supported, unsupported = _supported_fixture()
    candidates = (unsupported.id, supported.id)
    fitted = HybridV1Model().fit(training, seed=123)

    recommendations = fitted.recommend(
        user_id=_TARGET_PROFILE,
        candidate_ids=candidates,
        limit=2,
    )
    fallback_scores, content_scores, collaborative_scores = _component_scores(
        training,
        user_id=_TARGET_PROFILE,
        candidate_ids=candidates,
    )

    assert tuple(item.recipe_version_id for item in recommendations) == fitted.rank(
        user_id=_TARGET_PROFILE,
        candidate_ids=tuple(reversed(candidates)),
        limit=2,
    )
    by_id = {item.recipe_version_id: item for item in recommendations}
    supported_detail = by_id[supported.id]
    unsupported_detail = by_id[unsupported.id]

    assert supported_detail.route == "hybrid"
    assert supported_detail.fallback_score == fallback_scores[supported.id]
    assert supported_detail.content_score == content_scores[supported.id]
    assert supported_detail.collaborative_score == collaborative_scores[supported.id]
    assert (
        supported_detail.score
        == (
            2 * supported_detail.content_score
            + 2 * supported_detail.collaborative_score
            + supported_detail.fallback_score
        )
        / 5
    )
    assert supported_detail.reason == HYBRID_REASON
    assert 1 <= len(supported_detail.reason) <= 200
    assert str(supported_detail.recipe_version_id) not in supported_detail.reason

    assert unsupported_detail.route == "content_fallback"
    assert unsupported_detail.fallback_score == fallback_scores[unsupported.id]
    assert unsupported_detail.content_score == content_scores[unsupported.id]
    assert unsupported_detail.collaborative_score is None
    assert (
        unsupported_detail.score
        == (2 * unsupported_detail.content_score + unsupported_detail.fallback_score) / 3
    )
    assert unsupported_detail.reason == CONTENT_FALLBACK_REASON
    assert 1 <= len(unsupported_detail.reason) <= 200
    assert str(unsupported_detail.recipe_version_id) not in unsupported_detail.reason


def test_zero_signal_profile_uses_only_the_baseline_with_a_truthful_reason() -> None:
    training, _, supported, unsupported = _supported_fixture()
    cancelling_recipe = training.recipes[0]
    zero_sum_events = (
        _event(
            900,
            profile_id=_UNKNOWN_PROFILE,
            recipe_id=cancelling_recipe.id,
            event_type="save",
            saved_value=True,
        ),
        _event(
            901,
            profile_id=_UNKNOWN_PROFILE,
            recipe_id=cancelling_recipe.id,
            event_type="rating",
            rating_value=1,
        ),
        _event(
            902,
            profile_id=_UNKNOWN_PROFILE,
            recipe_id=cancelling_recipe.id,
            event_type="view",
        ),
    )
    fitted = HybridV1Model().fit(
        replace(training, events=training.events + zero_sum_events),
        seed=456,
    )
    cancelled_training = replace(training, events=training.events + zero_sum_events)
    candidates = (unsupported.id, supported.id)

    unknown = fitted.recommend(
        user_id=UUID(int=99_999),
        candidate_ids=candidates,
        limit=2,
    )
    cancelled = fitted.recommend(
        user_id=_UNKNOWN_PROFILE,
        candidate_ids=tuple(reversed(candidates)),
        limit=2,
    )

    baseline = BaselineV1Model().fit(cancelled_training, seed=456)
    for user_id, details in (
        (UUID(int=99_999), unknown),
        (_UNKNOWN_PROFILE, cancelled),
    ):
        assert tuple(detail.recipe_version_id for detail in details) == baseline.rank(
            user_id=user_id,
            candidate_ids=candidates,
            limit=len(cancelled_training.recipes),
        )
        for detail in details:
            assert detail.route == "fallback"
            assert detail.score == detail.fallback_score
            assert detail.content_score is None
            assert detail.collaborative_score is None
            assert detail.reason == FALLBACK_REASON
            assert str(_UNKNOWN_PROFILE) not in detail.reason
            assert str(detail.recipe_version_id) not in detail.reason


def test_cancelled_signed_profile_reason_does_not_claim_there_is_no_history() -> None:
    anchor = _recipe(801, title="M Anchor", ingredients=(990,))
    similar = _recipe(802, title="Z Similar", ingredients=(990,))
    other = _recipe(803, title="A Other", ingredients=(991,))
    events = (
        _event(
            920,
            profile_id=_TARGET_PROFILE,
            recipe_id=anchor.id,
            event_type="save",
            saved_value=True,
        ),
        _event(
            921,
            profile_id=_TARGET_PROFILE,
            recipe_id=anchor.id,
            event_type="rating",
            rating_value=1,
        ),
        _event(
            922,
            profile_id=_TARGET_PROFILE,
            recipe_id=anchor.id,
            event_type="view",
        ),
    )
    fitted = HybridV1Model().fit(_training((anchor, similar, other), events), seed=4)
    candidates = (other.id, similar.id)

    cancelled = fitted.recommend(
        user_id=_TARGET_PROFILE,
        candidate_ids=candidates,
        limit=2,
    )
    unknown = fitted.recommend(
        user_id=_UNKNOWN_PROFILE,
        candidate_ids=candidates,
        limit=2,
    )

    assert [item.recipe_version_id for item in cancelled] == [similar.id, other.id]
    assert [item.recipe_version_id for item in unknown] == [other.id, similar.id]
    assert {item.route for item in cancelled} == {"fallback"}
    assert all(item.reason == FALLBACK_REASON for item in cancelled)
    assert "no usable history" not in FALLBACK_REASON
    assert "signed preference signal" in FALLBACK_REASON


@pytest.mark.parametrize("signal_count", [1, 4])
def test_one_to_four_profile_signals_use_content_fallback(signal_count: int) -> None:
    training, anchors, supported, unsupported = _supported_fixture()
    retained_anchor_ids = {anchor.id for anchor in anchors[:signal_count]}
    sparse_events = tuple(
        event
        for event in training.events
        if event.user_id != _TARGET_PROFILE or event.recipe_version_id in retained_anchor_ids
    )
    sparse_training = replace(training, events=sparse_events)
    fitted = HybridV1Model().fit(sparse_training, seed=789)

    details = fitted.recommend(
        user_id=_TARGET_PROFILE,
        candidate_ids=(unsupported.id, supported.id),
        limit=2,
    )

    assert {detail.route for detail in details} == {"content_fallback"}
    for detail in details:
        assert detail.content_score is not None
        assert detail.collaborative_score is None
        assert detail.score == (2 * detail.content_score + detail.fallback_score) / 3
        assert detail.reason == CONTENT_FALLBACK_REASON


def test_exact_profile_item_and_overlap_thresholds_enable_hybrid() -> None:
    training, _, supported, _ = _supported_fixture()
    fitted = HybridV1Model().fit(training, seed=321)

    detail = fitted.recommend(
        user_id=_TARGET_PROFILE,
        candidate_ids=(supported.id,),
        limit=1,
    )[0]

    assert detail.route == "hybrid"
    assert detail.score == Fraction(1)
    assert detail.content_score == Fraction(1)
    assert detail.collaborative_score == Fraction(1)
    assert detail.fallback_score == Fraction(1)


def test_one_overlap_is_not_misrepresented_as_collaborative_evidence() -> None:
    training, anchors, supported, _ = _supported_fixture()
    one_overlap = replace(
        training,
        events=tuple(
            event
            for event in training.events
            if not (
                1_001 <= event.user_id.int <= 1_003 and event.recipe_version_id == anchors[1].id
            )
        ),
    )
    detail = (
        HybridV1Model()
        .fit(one_overlap, seed=654)
        .recommend(
            user_id=_TARGET_PROFILE,
            candidate_ids=(supported.id,),
            limit=1,
        )[0]
    )

    assert detail.route == "content_fallback"
    assert detail.collaborative_score is None
    assert detail.reason == CONTENT_FALLBACK_REASON


def test_cancelled_similarity_falls_back_but_negative_evidence_still_blends() -> None:
    anchors = tuple(_recipe(index, ingredients=(100 + index,)) for index in range(1, 6))
    cancelled_candidate = _recipe(6, ingredients=(501,))
    negative_candidate = _recipe(7, ingredients=(502,))
    events: list[SnapshotEvent] = []
    event_id = 1
    for anchor in anchors:
        events.append(
            _event(
                event_id,
                profile_id=_TARGET_PROFILE,
                recipe_id=anchor.id,
                event_type="view",
            )
        )
        event_id += 1
    for profile_int in range(1_001, 1_004):
        profile_id = UUID(int=profile_int)
        events.extend(
            (
                _event(
                    event_id,
                    profile_id=profile_id,
                    recipe_id=anchors[0].id,
                    event_type="view",
                ),
                _event(
                    event_id + 1,
                    profile_id=profile_id,
                    recipe_id=anchors[1].id,
                    event_type="save",
                    saved_value=False,
                ),
                _event(
                    event_id + 2,
                    profile_id=profile_id,
                    recipe_id=anchors[1].id,
                    event_type="rating",
                    rating_value=4,
                ),
                _event(
                    event_id + 3,
                    profile_id=profile_id,
                    recipe_id=cancelled_candidate.id,
                    event_type="save",
                    saved_value=True,
                ),
            )
        )
        event_id += 4
    for profile_int in range(2_001, 2_004):
        profile_id = UUID(int=profile_int)
        events.extend(
            (
                _event(
                    event_id,
                    profile_id=profile_id,
                    recipe_id=anchors[0].id,
                    event_type="view",
                ),
                _event(
                    event_id + 1,
                    profile_id=profile_id,
                    recipe_id=anchors[1].id,
                    event_type="view",
                ),
                _event(
                    event_id + 2,
                    profile_id=profile_id,
                    recipe_id=negative_candidate.id,
                    event_type="save",
                    saved_value=False,
                ),
            )
        )
        event_id += 3
    fitted = HybridV1Model().fit(
        _training((*anchors, cancelled_candidate, negative_candidate), tuple(events)),
        seed=852,
    )

    by_id = {
        detail.recipe_version_id: detail
        for detail in fitted.recommend(
            user_id=_TARGET_PROFILE,
            candidate_ids=(negative_candidate.id, cancelled_candidate.id),
            limit=2,
        )
    }

    assert by_id[cancelled_candidate.id].route == "content_fallback"
    assert by_id[cancelled_candidate.id].collaborative_score is None
    assert by_id[cancelled_candidate.id].reason == CONTENT_FALLBACK_REASON
    assert by_id[negative_candidate.id].route == "hybrid"
    assert by_id[negative_candidate.id].collaborative_score is not None
    assert by_id[negative_candidate.id].reason == HYBRID_REASON


def test_fixed_window_scores_unranked_candidates_zero_and_empty_requests_are_safe() -> None:
    recipes = tuple(_recipe(index, title=f"Recipe {index:02}") for index in range(1, 52))
    training = _training(recipes, ())
    fitted = HybridV1Model().fit(training, seed=111)
    candidates = tuple(recipe.id for recipe in reversed(recipes))

    details = fitted.recommend(
        user_id=_UNKNOWN_PROFILE,
        candidate_ids=candidates,
        limit=len(candidates),
    )

    assert len(details) == 51
    assert details[0].score == Fraction(1)
    assert details[49].score == Fraction(1, 50)
    assert details[50].score == Fraction(0)
    assert all(detail.route == "fallback" for detail in details)
    assert fitted.recommend(user_id=_UNKNOWN_PROFILE, candidate_ids=(), limit=0) == ()
    assert fitted.rank(user_id=_UNKNOWN_PROFILE, candidate_ids=(), limit=0) == ()


def test_recommend_rejects_duplicate_unknown_and_invalid_limit_requests() -> None:
    training, _, supported, unsupported = _supported_fixture()
    fitted = HybridV1Model().fit(training, seed=333)

    with pytest.raises(ValueError, match="duplicates"):
        fitted.recommend(
            user_id=_TARGET_PROFILE,
            candidate_ids=(supported.id, supported.id),
            limit=1,
        )
    with pytest.raises(ValueError, match="outside the fitted catalog"):
        fitted.recommend(
            user_id=_TARGET_PROFILE,
            candidate_ids=(UUID(int=99_999),),
            limit=1,
        )
    for invalid_limit in (-1, 3, True):
        with pytest.raises(ValueError, match="candidate count"):
            fitted.recommend(
                user_id=_TARGET_PROFILE,
                candidate_ids=(supported.id, unsupported.id),
                limit=invalid_limit,
            )


def test_fit_candidate_order_and_seed_do_not_change_scores_reasons_or_order() -> None:
    training, _, supported, unsupported = _supported_fixture()
    candidates = (unsupported.id, supported.id)
    ordered = HybridV1Model().fit(training, seed=1)
    reordered = HybridV1Model().fit(
        replace(
            training,
            recipes=tuple(reversed(training.recipes)),
            events=tuple(reversed(training.events)),
        ),
        seed=999_999,
    )

    assert ordered.recommend(
        user_id=_TARGET_PROFILE,
        candidate_ids=candidates,
        limit=2,
    ) == reordered.recommend(
        user_id=_TARGET_PROFILE,
        candidate_ids=tuple(reversed(candidates)),
        limit=2,
    )


def test_post_cutoff_events_cannot_change_hybrid_scores_or_reasons(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    original_split = split_snapshot(synthetic_snapshot)
    case = original_split.cases[0]
    original = HybridV1Model().fit(
        ModelTrainingData(
            cutoff=original_split.cutoff,
            recipes=original_split.recipes,
            events=original_split.training_events,
        ),
        seed=222,
    )
    future = SnapshotEvent(
        id=UUID("c8e5feb4-0c08-42d4-b8c2-e442783b9e9d"),
        user_id=case.user_id,
        recipe_version_id=case.candidate_ids[0],
        event_type="save",
        occurred_at=synthetic_snapshot.cutoff + timedelta(days=90),
        saved_value=True,
        rating_value=None,
        related_recipe_version_id=None,
    )
    augmented_split = split_snapshot(
        replace(synthetic_snapshot, events=synthetic_snapshot.events + (future,))
    )
    augmented = HybridV1Model().fit(
        ModelTrainingData(
            cutoff=augmented_split.cutoff,
            recipes=augmented_split.recipes,
            events=augmented_split.training_events,
        ),
        seed=222,
    )

    assert augmented_split.training_events == original_split.training_events
    assert augmented.recommend(
        user_id=case.user_id,
        candidate_ids=case.candidate_ids,
        limit=len(case.candidate_ids),
    ) == original.recommend(
        user_id=case.user_id,
        candidate_ids=case.candidate_ids,
        limit=len(case.candidate_ids),
    )


def test_ready_cohort_reports_exact_hybrid_metrics() -> None:
    snapshot = simulate_preference_cohort(
        load_snapshot(_READINESS_CATALOG),
        CohortSimulationConfig(seed=20260822, profile_count=64),
    )

    report = evaluate(
        snapshot,
        models=(ContentBasedV1Model(), CollaborativeV1Model(), HybridV1Model()),
        config=EvaluationConfig(seed=20260822, ks=(1, 3)),
    )

    assert report.status == "complete"
    assert [model.model_id for model in report.models] == [
        "baseline-v1",
        "collaborative-v1",
        "content-v1",
        HYBRID_MODEL_ID,
    ]
    hybrid = report.models[3]
    first, third = hybrid.metrics
    assert (
        first.precision,
        first.recall,
        first.ndcg,
        first.coverage,
    ) == (
        Decimal("0.625000"),
        Decimal("0.312500"),
        Decimal("0.625000"),
        Decimal("0.750000"),
    )
    assert (
        third.precision,
        third.recall,
        third.ndcg,
        third.coverage,
    ) == (
        Decimal("0.666667"),
        Decimal("1.000000"),
        Decimal("0.866219"),
        Decimal("1.000000"),
    )
