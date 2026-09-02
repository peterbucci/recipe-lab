from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from recipe_lab_evaluation.dataset import SnapshotEvent
from recipe_lab_evaluation.metrics import calculate_metrics, prepare_metric_context, ratio_metric
from recipe_lab_evaluation.split import UserEvaluationCase

TARGET_USER = UUID("04a46aa4-dcd8-43a4-b879-7fab4034fbd0")
BACKGROUND_USER_1 = UUID("cc57ed9a-8b35-4bd8-9423-901738c710ca")
BACKGROUND_USER_2 = UUID("97400f8f-54cb-4ddd-a934-8127ee73ab4d")
ITEM_A = UUID("9981f59b-b7a8-49a5-be45-51c339d68934")
ITEM_B = UUID("1085fb43-4791-4718-883f-45d3b8768e33")
ITEM_C = UUID("42d1de81-aa73-4995-839c-bdc8d0385ba4")
ITEM_D = UUID("c45f7159-ae62-421e-9163-5750c320b08c")


def _view(event_id: str, user_id: UUID, recipe_id: UUID) -> SnapshotEvent:
    return SnapshotEvent(
        id=UUID(event_id),
        user_id=user_id,
        recipe_version_id=recipe_id,
        event_type="view",
        occurred_at=datetime(2026, 1, 1, tzinfo=UTC),
        saved_value=None,
        rating_value=None,
        related_recipe_version_id=None,
    )


def _hand_computed_case() -> UserEvaluationCase:
    return UserEvaluationCase(
        user_id=TARGET_USER,
        candidate_ids=(ITEM_A, ITEM_B, ITEM_C, ITEM_D),
        relevant_ids=frozenset({ITEM_A, ITEM_C}),
    )


def _popularity_events() -> tuple[SnapshotEvent, ...]:
    return (
        _view("9540c5ba-d5d5-4a64-be06-89cedfecd0ab", BACKGROUND_USER_1, ITEM_A),
        _view("74373745-2998-42c4-bc9c-78a2f53c256f", BACKGROUND_USER_2, ITEM_A),
        _view("b8d00ce2-87d5-42b2-b2fc-695383a0aba7", BACKGROUND_USER_1, ITEM_B),
    )


def test_all_five_metrics_match_a_hand_computed_example() -> None:
    metrics = calculate_metrics(
        k=2,
        cases=(_hand_computed_case(),),
        rankings={TARGET_USER: (ITEM_A, ITEM_B)},
        training_events=_popularity_events(),
    )

    assert metrics.evaluated_users == 1
    assert metrics.relevant_items == 2
    assert metrics.precision == Decimal("0.500000")
    assert metrics.recall == Decimal("0.500000")
    assert metrics.ndcg == Decimal("0.613147")
    assert metrics.coverage == Decimal("0.500000")
    assert metrics.mean_recommended_popularity == Decimal("0.750000")
    assert metrics.mean_candidate_popularity == Decimal("0.375000")
    assert metrics.popularity_bias == Decimal("0.375000")


def test_prepared_metric_evidence_preserves_results_across_cutoffs() -> None:
    events = _popularity_events()
    context = prepare_metric_context(events)
    cases = (_hand_computed_case(),)
    rankings = {TARGET_USER: (ITEM_A, ITEM_B)}

    assert calculate_metrics(
        k=2,
        cases=cases,
        rankings=rankings,
        training_events=events,
        context=context,
    ) == calculate_metrics(
        k=2,
        cases=cases,
        rankings=rankings,
        training_events=events,
    )


def test_shared_ratio_metric_has_fixed_precision_and_explicit_undefined_value() -> None:
    assert ratio_metric(2, 3) == Decimal("0.666667")
    assert ratio_metric(0, 0) is None


def test_ndcg_discounts_a_relevant_item_at_the_second_rank() -> None:
    metrics = calculate_metrics(
        k=2,
        cases=(_hand_computed_case(),),
        rankings={TARGET_USER: (ITEM_B, ITEM_A)},
        training_events=(),
    )

    assert metrics.precision == Decimal("0.500000")
    assert metrics.recall == Decimal("0.500000")
    assert metrics.ndcg == Decimal("0.386853")


def test_k_is_bounded_by_each_users_candidate_pool() -> None:
    case = UserEvaluationCase(
        user_id=TARGET_USER,
        candidate_ids=(ITEM_A,),
        relevant_ids=frozenset({ITEM_A}),
    )

    metrics = calculate_metrics(
        k=10,
        cases=(case,),
        rankings={TARGET_USER: (ITEM_A,)},
        training_events=(),
    )

    assert metrics.precision == Decimal("1.000000")
    assert metrics.recall == Decimal("1.000000")
    assert metrics.ndcg == Decimal("1.000000")
    assert metrics.coverage == Decimal("1.000000")


def test_zero_training_popularity_has_zero_bias_without_division_errors() -> None:
    metrics = calculate_metrics(
        k=2,
        cases=(_hand_computed_case(),),
        rankings={TARGET_USER: (ITEM_A, ITEM_B)},
        training_events=(),
    )

    assert metrics.mean_recommended_popularity == Decimal("0.000000")
    assert metrics.mean_candidate_popularity == Decimal("0.000000")
    assert metrics.popularity_bias == Decimal("0.000000")


def test_insufficient_cases_produce_explicit_null_metrics() -> None:
    metrics = calculate_metrics(
        k=5,
        cases=(),
        rankings={},
        training_events=(),
    )

    assert metrics.evaluated_users == 0
    assert metrics.relevant_items == 0
    assert metrics.precision is None
    assert metrics.recall is None
    assert metrics.ndcg is None
    assert metrics.coverage is None
    assert metrics.mean_recommended_popularity is None
    assert metrics.mean_candidate_popularity is None
    assert metrics.popularity_bias is None
