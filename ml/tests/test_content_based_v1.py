from dataclasses import replace
from datetime import UTC, datetime, timedelta
from fractions import Fraction
from uuid import UUID

import pytest

from recipe_lab_evaluation.dataset import (
    EvaluationSnapshot,
    EventType,
    SnapshotEvent,
    SnapshotIngredientMeasure,
    SnapshotRecipe,
)
from recipe_lab_evaluation.models import CONTENT_MODEL_ID, ContentBasedV1Model
from recipe_lab_evaluation.models.content_based_v1 import (
    PreferenceSignal,
    content_similarity,
    derive_preference_signals,
    normalize_title_tokens,
    recipe_content_features,
)
from recipe_lab_evaluation.protocol import ModelTrainingData
from recipe_lab_evaluation.runner import EvaluationConfig, evaluate
from recipe_lab_evaluation.split import split_snapshot

_CUTOFF = datetime(2026, 6, 1, tzinfo=UTC)
_EVENT_TIME = _CUTOFF - timedelta(days=1)
_USER_ID = UUID(int=900)
_UNKNOWN_USER_ID = UUID(int=901)


def _recipe(
    identifier: int,
    *,
    title: str,
    version: int = 1,
    ingredients: tuple[int, ...] = (),
) -> SnapshotRecipe:
    return SnapshotRecipe(
        id=UUID(int=identifier),
        created_at=_CUTOFF - timedelta(days=30),
        title=title,
        version_number=version,
        ingredient_measures=tuple(
            SnapshotIngredientMeasure(
                ingredient_id=UUID(int=value),
                kind="qualitative",
                quantity_min=None,
                quantity_max=None,
                measurement_unit_id=None,
                package_size_id=None,
                qualitative_value="unspecified",
            )
            for value in ingredients
        ),
    )


def _event(
    identifier: int,
    *,
    user_id: UUID,
    recipe_id: UUID,
    event_type: EventType,
    occurred_at: datetime = _EVENT_TIME,
    saved_value: bool | None = None,
    rating_value: int | None = None,
    related_recipe_id: UUID | None = None,
) -> SnapshotEvent:
    return SnapshotEvent(
        id=UUID(int=identifier),
        user_id=user_id,
        recipe_version_id=recipe_id,
        event_type=event_type,
        occurred_at=occurred_at,
        saved_value=saved_value,
        rating_value=rating_value,
        related_recipe_version_id=related_recipe_id,
    )


def _training(
    recipes: tuple[SnapshotRecipe, ...],
    events: tuple[SnapshotEvent, ...],
) -> ModelTrainingData:
    return ModelTrainingData(cutoff=_CUTOFF, recipes=recipes, events=events)


def test_content_features_use_ingredients_normalized_title_and_version_metadata() -> None:
    source = _recipe(
        1,
        title="  CITRUS_bowl! Citrus  ",
        version=2,
        ingredients=(101, 102),
    )
    ingredient_match = _recipe(
        2,
        title="Zulu",
        version=3,
        ingredients=(102, 101),
    )
    title_match = _recipe(3, title="citrus BOWL", version=3, ingredients=(103,))
    version_match = _recipe(4, title="Alpha", version=2, ingredients=(104,))

    source_features = recipe_content_features(source)

    assert source_features.ingredient_ids == frozenset({UUID(int=101), UUID(int=102)})
    assert source_features.title_tokens == frozenset({"citrus", "bowl"})
    assert normalize_title_tokens("Crème_BRÛLÉE crème!") == frozenset({"crème", "brûlée"})
    assert content_similarity(source_features, recipe_content_features(ingredient_match)) == (
        Fraction(13, 20)
    )
    assert content_similarity(source_features, recipe_content_features(title_match)) == Fraction(
        7, 20
    )
    assert content_similarity(source_features, recipe_content_features(version_match)) == Fraction(
        1, 10
    )


def test_personalized_ranking_uses_each_structured_feature_channel() -> None:
    source = _recipe(1, title="Middle", version=1, ingredients=(101, 102))
    ingredient_match = _recipe(2, title="Zulu", version=10, ingredients=(101, 102))
    title_match = _recipe(3, title="middle", version=10, ingredients=(103,))
    version_match = _recipe(4, title="Alpha", version=1, ingredients=(104,))
    training = _training(
        (version_match, title_match, ingredient_match, source),
        (
            _event(
                101,
                user_id=_USER_ID,
                recipe_id=source.id,
                event_type="save",
                saved_value=True,
            ),
        ),
    )
    fitted = ContentBasedV1Model().fit(training, seed=10)

    ranking = fitted.rank(
        user_id=_USER_ID,
        candidate_ids=(version_match.id, title_match.id, ingredient_match.id),
        limit=3,
    )

    assert ranking == (ingredient_match.id, title_match.id, version_match.id)


def test_preference_signals_are_signed_latest_state_and_order_independent() -> None:
    save_recipe = UUID(int=10)
    rating_recipe = UUID(int=20)
    view_recipe = UUID(int=30)
    fork_source = UUID(int=40)
    fork_child = UUID(int=50)
    events = (
        _event(
            101,
            user_id=_USER_ID,
            recipe_id=save_recipe,
            event_type="save",
            saved_value=True,
        ),
        _event(
            102,
            user_id=_USER_ID,
            recipe_id=save_recipe,
            event_type="save",
            saved_value=False,
        ),
        _event(
            103,
            user_id=_USER_ID,
            recipe_id=rating_recipe,
            event_type="rating",
            rating_value=5,
        ),
        _event(
            104,
            user_id=_USER_ID,
            recipe_id=rating_recipe,
            event_type="rating",
            rating_value=1,
        ),
        _event(105, user_id=_USER_ID, recipe_id=view_recipe, event_type="view"),
        _event(106, user_id=_USER_ID, recipe_id=view_recipe, event_type="view"),
        _event(
            107,
            user_id=_USER_ID,
            recipe_id=fork_source,
            event_type="fork",
            related_recipe_id=fork_child,
        ),
        _event(
            108,
            user_id=_USER_ID,
            recipe_id=fork_source,
            event_type="fork",
            related_recipe_id=fork_child,
        ),
    )

    expected = (
        PreferenceSignal(save_recipe, -3),
        PreferenceSignal(rating_recipe, -4),
        PreferenceSignal(view_recipe, 1),
        PreferenceSignal(fork_source, 4),
        PreferenceSignal(fork_child, 4),
    )
    assert derive_preference_signals(events)[_USER_ID] == expected
    assert derive_preference_signals(tuple(reversed(events)))[_USER_ID] == expected


def test_signed_profile_promotes_positive_and_demotes_negative_similarity() -> None:
    positive_source = _recipe(1, title="Piquant", ingredients=(101,))
    negative_source = _recipe(2, title="Bitter", ingredients=(102,))
    positive_match = _recipe(3, title="Zulu", ingredients=(101,))
    neutral = _recipe(4, title="Middle", ingredients=(103,))
    negative_match = _recipe(5, title="Alpha", ingredients=(102,))
    training = _training(
        (negative_match, neutral, positive_match, negative_source, positive_source),
        (
            _event(
                101,
                user_id=_USER_ID,
                recipe_id=positive_source.id,
                event_type="save",
                saved_value=True,
            ),
            _event(
                102,
                user_id=_USER_ID,
                recipe_id=negative_source.id,
                event_type="rating",
                rating_value=1,
            ),
        ),
    )
    fitted = ContentBasedV1Model().fit(training, seed=20)

    ranking = fitted.rank(
        user_id=_USER_ID,
        candidate_ids=(negative_match.id, neutral.id, positive_match.id),
        limit=3,
    )

    assert ranking == (positive_match.id, neutral.id, negative_match.id)


def test_zero_sum_profile_uses_the_same_cold_start_as_an_unknown_user() -> None:
    source = _recipe(1, title="Source", ingredients=(101,))
    similar = _recipe(2, title="Zulu", ingredients=(101,))
    stable_first = _recipe(3, title="Alpha", ingredients=(102,))
    events = (
        _event(
            101,
            user_id=_USER_ID,
            recipe_id=source.id,
            event_type="save",
            saved_value=True,
        ),
        _event(
            102,
            user_id=_USER_ID,
            recipe_id=source.id,
            event_type="rating",
            rating_value=1,
        ),
        _event(103, user_id=_USER_ID, recipe_id=source.id, event_type="view"),
    )
    fitted = ContentBasedV1Model().fit(
        _training((source, similar, stable_first), events),
        seed=30,
    )
    candidates = (similar.id, stable_first.id)

    assert _USER_ID not in derive_preference_signals(events)
    assert fitted.rank(user_id=_USER_ID, candidate_ids=candidates, limit=2) == fitted.rank(
        user_id=_UNKNOWN_USER_ID,
        candidate_ids=tuple(reversed(candidates)),
        limit=2,
    )
    assert fitted.rank(user_id=_USER_ID, candidate_ids=candidates, limit=2) == (
        stable_first.id,
        similar.id,
    )


def test_cold_start_uses_global_signed_prior_then_stable_metadata() -> None:
    positive = _recipe(1, title="Zulu", ingredients=(101,))
    neutral_beta = _recipe(2, title="beta", ingredients=(102,))
    neutral_alpha = _recipe(3, title="Alpha", ingredients=(103,))
    negative = _recipe(4, title="Aardvark", ingredients=(104,))
    training = _training(
        (negative, neutral_alpha, neutral_beta, positive),
        (
            _event(
                101,
                user_id=UUID(int=910),
                recipe_id=positive.id,
                event_type="save",
                saved_value=True,
            ),
            _event(
                102,
                user_id=UUID(int=911),
                recipe_id=negative.id,
                event_type="rating",
                rating_value=1,
            ),
        ),
    )
    fitted = ContentBasedV1Model().fit(training, seed=40)
    candidates = (negative.id, neutral_beta.id, positive.id, neutral_alpha.id)

    assert fitted.rank(
        user_id=_UNKNOWN_USER_ID,
        candidate_ids=candidates,
        limit=4,
    ) == (positive.id, neutral_alpha.id, neutral_beta.id, negative.id)
    assert fitted.rank(
        user_id=_UNKNOWN_USER_ID,
        candidate_ids=tuple(reversed(candidates)),
        limit=2,
    ) == (positive.id, neutral_alpha.id)


def test_fit_and_inference_are_reproducible_across_input_order_and_seed() -> None:
    source = _recipe(1, title="Source", ingredients=(101,))
    first = _recipe(2, title="Zulu", ingredients=(101,))
    second = _recipe(3, title="Alpha", ingredients=(102,))
    events = (
        _event(101, user_id=_USER_ID, recipe_id=source.id, event_type="view"),
        _event(
            102,
            user_id=_USER_ID,
            recipe_id=source.id,
            event_type="save",
            saved_value=True,
        ),
    )
    ordered = ContentBasedV1Model().fit(
        _training((source, first, second), events),
        seed=1,
    )
    reversed_input = ContentBasedV1Model().fit(
        _training((second, first, source), tuple(reversed(events))),
        seed=999_999,
    )

    assert ordered.metadata.model_id == CONTENT_MODEL_ID
    assert ordered.metadata == reversed_input.metadata
    assert ordered.rank(
        user_id=_USER_ID,
        candidate_ids=(second.id, first.id),
        limit=2,
    ) == reversed_input.rank(
        user_id=_USER_ID,
        candidate_ids=(first.id, second.id),
        limit=2,
    )


def test_rank_honors_candidate_subset_and_rejects_invalid_requests() -> None:
    first = _recipe(1, title="Alpha")
    second = _recipe(2, title="Beta")
    fitted = ContentBasedV1Model().fit(_training((first, second), ()), seed=50)

    assert fitted.rank(
        user_id=_UNKNOWN_USER_ID,
        candidate_ids=(second.id,),
        limit=1,
    ) == (second.id,)
    with pytest.raises(ValueError, match="duplicates"):
        fitted.rank(
            user_id=_UNKNOWN_USER_ID,
            candidate_ids=(first.id, first.id),
            limit=1,
        )
    with pytest.raises(ValueError, match="outside the fitted catalog"):
        fitted.rank(
            user_id=_UNKNOWN_USER_ID,
            candidate_ids=(UUID(int=999),),
            limit=1,
        )
    with pytest.raises(ValueError, match="candidate count"):
        fitted.rank(
            user_id=_UNKNOWN_USER_ID,
            candidate_ids=(first.id,),
            limit=2,
        )


def test_post_cutoff_events_cannot_change_content_ranking(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    original_split = split_snapshot(synthetic_snapshot)
    case = original_split.cases[0]
    original = ContentBasedV1Model().fit(
        ModelTrainingData(
            cutoff=original_split.cutoff,
            recipes=original_split.recipes,
            events=original_split.training_events,
        ),
        seed=60,
    )
    future_event = SnapshotEvent(
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
        replace(
            synthetic_snapshot,
            events=synthetic_snapshot.events + (future_event,),
        )
    )
    augmented = ContentBasedV1Model().fit(
        ModelTrainingData(
            cutoff=augmented_split.cutoff,
            recipes=augmented_split.recipes,
            events=augmented_split.training_events,
        ),
        seed=60,
    )

    assert augmented_split.training_events == original_split.training_events
    assert augmented.rank(
        user_id=case.user_id,
        candidate_ids=case.candidate_ids,
        limit=len(case.candidate_ids),
    ) == original.rank(
        user_id=case.user_id,
        candidate_ids=case.candidate_ids,
        limit=len(case.candidate_ids),
    )


def test_evaluation_reports_content_model_metrics_and_baseline_deltas(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    report = evaluate(
        synthetic_snapshot,
        models=(ContentBasedV1Model(),),
        config=EvaluationConfig(seed=20260822, ks=(1, 3)),
    )

    assert report.status == "complete"
    assert [model.model_id for model in report.models] == ["baseline-v1", CONTENT_MODEL_ID]
    content = report.models[1]
    assert [metrics.k for metrics in content.metrics] == [1, 3]
    assert [delta.k for delta in content.deltas_vs_baseline] == [1, 3]
    assert all(delta.precision is not None for delta in content.deltas_vs_baseline)
    assert all(delta.recall is not None for delta in content.deltas_vs_baseline)
    assert all(delta.ndcg is not None for delta in content.deltas_vs_baseline)
    assert all(delta.coverage is not None for delta in content.deltas_vs_baseline)
