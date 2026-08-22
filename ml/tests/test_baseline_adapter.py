from dataclasses import replace
from datetime import timedelta
from uuid import UUID

from app.services.recommendation_scoring import (
    BaselineScoringInput,
    score_baseline_recommendations,
)
from test_split import (
    BETA_ID,
    COLD_USER_ID,
    ETA_ID,
    PRIMARY_USER_ID,
    ZETA_ID,
)

from recipe_lab_evaluation.dataset import EvaluationSnapshot, SnapshotEvent
from recipe_lab_evaluation.models.baseline_v1 import (
    BaselineV1Model,
    _FittedBaselineV1,
)
from recipe_lab_evaluation.protocol import ModelTrainingData
from recipe_lab_evaluation.split import split_snapshot


def _fit_fixture_baseline(snapshot: EvaluationSnapshot) -> _FittedBaselineV1:
    split = split_snapshot(snapshot)
    fitted = BaselineV1Model().fit(
        ModelTrainingData(
            cutoff=snapshot.cutoff,
            recipes=split.recipes,
            events=split.training_events,
        ),
        seed=123,
    )
    assert isinstance(fitted, _FittedBaselineV1)
    return fitted


def test_baseline_reconstructs_latest_save_and_rating_state(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    fitted = _fit_fixture_baseline(synthetic_snapshot)
    candidates = {candidate.recipe_version_id: candidate for candidate in fitted.candidates}

    assert ETA_ID not in fitted.saved_by_user.get(PRIMARY_USER_ID, frozenset())
    assert [
        (rating.recipe_version_id, rating.rating)
        for rating in fitted.ratings_by_user[PRIMARY_USER_ID]
    ] == [(ZETA_ID, 2)]
    assert candidates[ETA_ID].save_count == 0
    assert candidates[BETA_ID].save_count == 1
    assert candidates[ZETA_ID].rating_sum == 2
    assert candidates[ZETA_ID].rating_count == 1


def test_offline_adapter_ranks_with_the_shared_production_scorer(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    split = split_snapshot(synthetic_snapshot)
    fitted = _fit_fixture_baseline(synthetic_snapshot)
    cold_case = next(case for case in split.cases if case.user_id == COLD_USER_ID)

    offline_ranking = fitted.rank(
        user_id=COLD_USER_ID,
        candidate_ids=cold_case.candidate_ids,
        limit=len(cold_case.candidate_ids),
    )
    shared_result = score_baseline_recommendations(
        BaselineScoringInput(
            candidates=fitted.candidates,
            saved_recipe_version_ids=fitted.saved_by_user.get(COLD_USER_ID, frozenset()),
            ratings=fitted.ratings_by_user.get(COLD_USER_ID, ()),
            events=fitted.events_by_user.get(COLD_USER_ID, ()),
        ),
        len(cold_case.candidate_ids),
    )

    assert offline_ranking == tuple(item.recipe_version_id for item in shared_result.items)


def test_post_cutoff_activity_cannot_change_the_offline_baseline_ranking(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    split = split_snapshot(synthetic_snapshot)
    primary_case = next(case for case in split.cases if case.user_id == PRIMARY_USER_ID)
    original_fitted = _fit_fixture_baseline(synthetic_snapshot)
    original_ranking = original_fitted.rank(
        user_id=PRIMARY_USER_ID,
        candidate_ids=primary_case.candidate_ids,
        limit=len(primary_case.candidate_ids),
    )
    future_events = tuple(
        SnapshotEvent(
            id=UUID(event_id),
            user_id=UUID(user_id),
            recipe_version_id=BETA_ID,
            event_type="view",
            occurred_at=synthetic_snapshot.cutoff + timedelta(days=index),
            saved_value=None,
            rating_value=None,
            related_recipe_version_id=None,
        )
        for index, (event_id, user_id) in enumerate(
            (
                (
                    "32fa042a-3e6b-445e-95e1-3fe2577364e6",
                    "21d6caac-8cd5-42ce-8e76-1882f4848282",
                ),
                (
                    "e0924229-acb0-448f-a23c-256dc19e7b96",
                    "55048d9f-a9b8-4ed0-8bbb-f71d09b0917f",
                ),
                (
                    "bc093be9-7178-4f75-9e5b-f9a920271e39",
                    "4928e529-e7d1-4fc0-9038-d2fa7322ba26",
                ),
            ),
            start=20,
        )
    )
    augmented = replace(
        synthetic_snapshot,
        events=synthetic_snapshot.events + future_events,
    )
    augmented_fitted = _fit_fixture_baseline(augmented)

    assert augmented_fitted.training == original_fitted.training
    assert (
        augmented_fitted.rank(
            user_id=PRIMARY_USER_ID,
            candidate_ids=primary_case.candidate_ids,
            limit=len(primary_case.candidate_ids),
        )
        == original_ranking
    )
