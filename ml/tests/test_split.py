from dataclasses import replace
from datetime import timedelta
from uuid import UUID

from recipe_lab_evaluation.dataset import (
    EvaluationSnapshot,
    SnapshotEvent,
    SnapshotIngredientMeasure,
    SnapshotRecipe,
)
from recipe_lab_evaluation.split import split_snapshot

PRIMARY_USER_ID = UUID("9f2749a0-70d7-45b4-8e26-391789315145")
FORK_USER_ID = UUID("81c1157d-5d41-4c20-ac4a-fa484404ed7b")
COLD_USER_ID = UUID("15346b0e-5c39-4ffa-8447-673f355d5348")
ALPHA_ID = UUID("a77962d1-01bf-4d61-9bfe-39fee1599ef6")
BETA_ID = UUID("72699b04-54dd-43f4-866a-b4bf7ede43a5")
GAMMA_ID = UUID("bb3351d4-8e87-45c0-aba4-c89899a054cf")
DELTA_ID = UUID("742949c0-7d36-4d9f-9b73-ad894d217fdd")
EPSILON_ID = UUID("8eb9358b-b24a-4301-83ae-58517bf34472")
ZETA_ID = UUID("a16eacf5-e562-41c8-905b-b6e154dc2600")
ETA_ID = UUID("303e2dd7-2ed4-4ef4-9546-19331da01667")
FUTURE_ID = UUID("0f158620-0cd5-44d9-9aaa-2bf9f93f1efd")


def test_split_uses_one_strict_cutoff_and_excludes_future_recipes(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    split = split_snapshot(synthetic_snapshot)

    assert len(split.training_events) == 21
    assert len(split.holdout_events) == 15
    assert all(event.occurred_at < synthetic_snapshot.cutoff for event in split.training_events)
    assert all(event.occurred_at >= synthetic_snapshot.cutoff for event in split.holdout_events)
    assert any(event.occurred_at == synthetic_snapshot.cutoff for event in split.holdout_events)
    assert FUTURE_ID not in {recipe.id for recipe in split.recipes}
    assert FUTURE_ID not in {recipe_id for case in split.cases for recipe_id in case.candidate_ids}


def test_post_cutoff_events_and_recipes_cannot_change_training_data(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    original = split_snapshot(synthetic_snapshot)
    future_recipe = SnapshotRecipe(
        id=UUID("e1a6dfb9-3d9e-4c64-b61e-2e7d166de0c8"),
        created_at=synthetic_snapshot.cutoff + timedelta(seconds=1),
        title="Unseen Future Fixture",
        version_number=1,
        ingredient_measures=(
            SnapshotIngredientMeasure(
                ingredient_id=UUID("399b690a-9325-4b67-98c0-5760ff332a02"),
                kind="qualitative",
                quantity_min=None,
                quantity_max=None,
                measurement_unit_id=None,
                package_size_id=None,
                qualitative_value="unspecified",
            ),
        ),
    )
    future_event = SnapshotEvent(
        id=UUID("b7718271-2cc6-4058-bfbb-750ae3cce47a"),
        user_id=COLD_USER_ID,
        recipe_version_id=future_recipe.id,
        event_type="rating",
        occurred_at=synthetic_snapshot.cutoff + timedelta(days=30),
        saved_value=None,
        rating_value=5,
        related_recipe_version_id=None,
    )
    augmented = replace(
        synthetic_snapshot,
        recipes=synthetic_snapshot.recipes + (future_recipe,),
        events=synthetic_snapshot.events + (future_event,),
    )

    augmented_split = split_snapshot(augmented)

    assert augmented_split.recipes == original.recipes
    assert augmented_split.training_events == original.training_events
    assert all(future_recipe.id not in case.candidate_ids for case in augmented_split.cases)


def test_split_is_independent_of_in_memory_recipe_and_event_order(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    reordered = replace(
        synthetic_snapshot,
        recipes=tuple(reversed(synthetic_snapshot.recipes)),
        events=tuple(reversed(synthetic_snapshot.events)),
    )

    assert split_snapshot(reordered) == split_snapshot(synthetic_snapshot)


def test_relevance_uses_deliberate_latest_holdout_state_and_filters_unavailable_items(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    split = split_snapshot(synthetic_snapshot)
    cases_by_user = {case.user_id: case for case in split.cases}

    assert split.counts.available_recipes == 7
    assert split.counts.raw_relevant_items == 9
    assert split.counts.eligible_relevant_items == 8
    assert split.counts.eligible_users == 6
    assert split.counts.filtered_already_interacted == 0
    assert split.counts.filtered_unavailable == 1
    assert cases_by_user[PRIMARY_USER_ID].relevant_ids == frozenset({ALPHA_ID, EPSILON_ID})
    assert cases_by_user[COLD_USER_ID].relevant_ids == frozenset({BETA_ID, DELTA_ID})
    assert GAMMA_ID not in cases_by_user[PRIMARY_USER_ID].relevant_ids
    assert DELTA_ID not in cases_by_user[PRIMARY_USER_ID].relevant_ids
    assert FUTURE_ID not in {recipe_id for case in split.cases for recipe_id in case.relevant_ids}


def test_holdout_positive_for_a_previously_interacted_version_is_filtered(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    extra_event = SnapshotEvent(
        id=UUID("d9a3429a-ce8d-46c3-94fb-40f03632652f"),
        user_id=PRIMARY_USER_ID,
        recipe_version_id=ZETA_ID,
        event_type="save",
        occurred_at=synthetic_snapshot.cutoff + timedelta(days=40),
        saved_value=True,
        rating_value=None,
        related_recipe_version_id=None,
    )
    split = split_snapshot(
        replace(synthetic_snapshot, events=synthetic_snapshot.events + (extra_event,))
    )
    primary_case = next(case for case in split.cases if case.user_id == PRIMARY_USER_ID)

    assert ZETA_ID not in primary_case.relevant_ids
    assert ZETA_ID not in primary_case.candidate_ids
    assert split.counts.raw_relevant_items == 10
    assert split.counts.filtered_already_interacted == 1


def test_training_interactions_exclude_source_and_fork_child_from_candidates(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    split = split_snapshot(synthetic_snapshot)
    fork_case = next(case for case in split.cases if case.user_id == FORK_USER_ID)

    assert GAMMA_ID not in fork_case.candidate_ids
    assert ETA_ID not in fork_case.candidate_ids
    assert set(fork_case.candidate_ids) == {
        DELTA_ID,
        EPSILON_ID,
        ZETA_ID,
    }
