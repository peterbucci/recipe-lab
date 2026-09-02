import json
from collections import Counter, defaultdict
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Any, cast
from uuid import UUID

import pytest

from recipe_lab_evaluation.dataset import (
    EvaluationSnapshot,
    SnapshotIngredientMeasure,
    SnapshotRecipe,
    create_snapshot,
    parse_snapshot_json,
    snapshot_to_json,
)
from recipe_lab_evaluation.simulator import (
    SIMULATION_ASSUMPTIONS,
    CohortSimulationConfig,
    CohortSimulationError,
    simulate_preference_cohort,
)
from recipe_lab_evaluation.split import split_snapshot

_CUTOFF = datetime(2026, 6, 1, tzinfo=UTC)


def _catalog(*, recipe_count: int = 8, future_recipes: int = 0) -> EvaluationSnapshot:
    recipes = tuple(
        SnapshotRecipe(
            id=UUID(int=100 + index),
            created_at=(
                _CUTOFF + timedelta(days=index + 1)
                if index >= recipe_count - future_recipes
                else _CUTOFF - timedelta(days=60 - index)
            ),
            title=f"Catalog Recipe {index + 1}",
            version_number=1,
            ingredient_measures=(
                SnapshotIngredientMeasure(
                    ingredient_id=UUID(int=1_000 + (index % 4)),
                    kind="qualitative",
                    quantity_min=None,
                    quantity_max=None,
                    measurement_unit_id=None,
                    package_size_id=None,
                    qualitative_value="unspecified",
                ),
                SnapshotIngredientMeasure(
                    ingredient_id=UUID(int=2_000 + ((index + 1) % 4)),
                    kind="qualitative",
                    quantity_min=None,
                    quantity_max=None,
                    measurement_unit_id=None,
                    package_size_id=None,
                    qualitative_value="unspecified",
                ),
            ),
        )
        for index in range(recipe_count)
    )
    return create_snapshot(
        dataset_id="recipe-lab-catalog-only-v1",
        cutoff=_CUTOFF,
        limitations=("This catalog is an invented test fixture.",),
        recipes=recipes,
        events=(),
    )


def _event_keys(snapshot_json: str) -> frozenset[str]:
    document = cast(dict[str, Any], json.loads(snapshot_json))
    events = cast(list[dict[str, Any]], document["events"])
    return frozenset(events[0])


def test_default_cohort_is_balanced_and_temporally_evaluable() -> None:
    catalog = _catalog()
    original_recipes = catalog.recipes

    simulated = simulate_preference_cohort(catalog, CohortSimulationConfig(seed=17))
    split = split_snapshot(simulated)

    assert catalog.recipes == original_recipes
    assert catalog.events == ()
    assert simulated.recipes == catalog.recipes
    assert len(simulated.events) == 896
    assert split.counts.training_events == 640
    assert split.counts.holdout_events == 256
    assert split.counts.available_recipes == 8
    assert split.counts.eligible_users == 64
    assert split.counts.eligible_relevant_items == 128
    assert len(split.cases) == 64
    assert all(len(case.candidate_ids) == 3 for case in split.cases)
    assert all(len(case.relevant_ids) == 2 for case in split.cases)

    training_pairs: dict[UUID, set[UUID]] = defaultdict(set)
    training_support: Counter[UUID] = Counter()
    for event in split.training_events:
        training_pairs[event.user_id].add(event.recipe_version_id)
    for recipe_ids in training_pairs.values():
        training_support.update(recipe_ids)

    assert len(training_pairs) == 64
    assert all(len(recipe_ids) == 5 for recipe_ids in training_pairs.values())
    assert set(training_support.values()) == {40}
    assert all(event.event_type in {"view", "save", "rating"} for event in simulated.events)
    assert {event.event_type for event in simulated.events} == {"view", "save", "rating"}
    assert all(event.related_recipe_version_id is None for event in simulated.events)


def test_training_exposure_stays_balanced_for_partial_catalog_cycles() -> None:
    simulated = simulate_preference_cohort(
        _catalog(recipe_count=11),
        CohortSimulationConfig(
            seed=20260822,
            profile_count=5,
            training_items_per_profile=4,
            holdout_items_per_profile=2,
        ),
    )
    split = split_snapshot(simulated)
    training_pairs = {(event.user_id, event.recipe_version_id) for event in split.training_events}
    support = Counter(recipe_id for _, recipe_id in training_pairs)

    assert len(training_pairs) == 20
    assert len(support) == 11
    assert max(support.values()) - min(support.values()) <= 1


def test_same_catalog_config_and_seed_are_byte_identical() -> None:
    catalog = _catalog()
    config = CohortSimulationConfig(seed=20260822)

    first = simulate_preference_cohort(catalog, config)
    second = simulate_preference_cohort(catalog, config)

    serialized = snapshot_to_json(first)
    assert serialized == snapshot_to_json(second)
    assert first.sha256 == second.sha256
    assert first.sha256 == "a4b2dcc24d95b67ec44220d67b9f6979846ffe6c951a491eae3b37560e75cc3d"
    assert sha256(serialized.encode("utf-8")).hexdigest() == (
        "659d41828cdd11ca3f4494ea09145d6d85ab78dba21b2e0db4df16b5424677bd"
    )


def test_equivalent_input_order_and_stale_dataclass_fingerprint_are_normalized() -> None:
    catalog = _catalog()
    direct_dataclass = replace(
        catalog,
        recipes=tuple(reversed(catalog.recipes)),
        sha256="stale-direct-caller-fingerprint",
    )
    config = CohortSimulationConfig(seed=20260822)

    canonical_output = simulate_preference_cohort(catalog, config)
    direct_output = simulate_preference_cohort(direct_dataclass, config)

    assert snapshot_to_json(direct_output) == snapshot_to_json(canonical_output)


def test_changed_seed_produces_a_distinct_valid_cohort() -> None:
    catalog = _catalog()

    first = simulate_preference_cohort(catalog, CohortSimulationConfig(seed=1))
    second = simulate_preference_cohort(catalog, CohortSimulationConfig(seed=2))
    reparsed = parse_snapshot_json(snapshot_to_json(second))

    assert first.dataset_id != second.dataset_id
    assert first.sha256 != second.sha256
    assert {event.user_id for event in first.events}.isdisjoint(
        {event.user_id for event in second.events}
    )
    assert reparsed.sha256 == second.sha256


def test_generated_rows_are_opaque_and_add_no_personal_or_free_form_fields() -> None:
    simulated = simulate_preference_cohort(_catalog(), CohortSimulationConfig(seed=5))
    raw = snapshot_to_json(simulated)

    assert all(event.id.version == 5 and event.user_id.version == 5 for event in simulated.events)
    assert _event_keys(raw) == {
        "id",
        "user_id",
        "recipe_version_id",
        "event_type",
        "occurred_at",
        "saved_value",
        "rating_value",
        "related_recipe_version_id",
    }
    assert "@" not in raw
    for forbidden_key in (
        "name",
        "email",
        "ip_address",
        "user_agent",
        "device_id",
        "search_query",
        "free_text",
    ):
        assert f'"{forbidden_key}"' not in raw.casefold()


def test_simulation_uses_only_available_recipes_and_keeps_future_catalog_rows() -> None:
    catalog = _catalog(recipe_count=9, future_recipes=1)
    future_recipe = max(catalog.recipes, key=lambda recipe: recipe.created_at)

    simulated = simulate_preference_cohort(catalog, CohortSimulationConfig(seed=8))

    assert future_recipe in simulated.recipes
    assert future_recipe.id not in {event.recipe_version_id for event in simulated.events}
    assert all(
        next(
            recipe for recipe in simulated.recipes if recipe.id == event.recipe_version_id
        ).created_at
        <= event.occurred_at
        for event in simulated.events
    )
    assert all(
        event.occurred_at < simulated.cutoff
        for event in simulated.events
        if event.occurred_at < simulated.cutoff
    )
    assert (
        min(
            event.occurred_at for event in simulated.events if event.occurred_at >= simulated.cutoff
        )
        == simulated.cutoff
    )


def test_future_catalog_rows_cannot_change_the_generated_cohort() -> None:
    config = CohortSimulationConfig(seed=20260822)
    base = simulate_preference_cohort(_catalog(), config)
    with_future_recipe = simulate_preference_cohort(
        _catalog(recipe_count=9, future_recipes=1),
        config,
    )

    assert with_future_recipe.events == base.events
    assert with_future_recipe.dataset_id == base.dataset_id
    assert with_future_recipe.sha256 != base.sha256
    future_recipe = max(with_future_recipe.recipes, key=lambda recipe: recipe.created_at)
    assert future_recipe.created_at >= with_future_recipe.cutoff
    assert future_recipe.id not in {event.recipe_version_id for event in with_future_recipe.events}


def test_simulation_rejects_catalogs_with_recorded_activity() -> None:
    catalog = _catalog()
    generated = simulate_preference_cohort(
        catalog,
        CohortSimulationConfig(seed=11, profile_count=2),
    )
    mixed_catalog = create_snapshot(
        dataset_id=catalog.dataset_id,
        cutoff=catalog.cutoff,
        limitations=catalog.limitations,
        recipes=catalog.recipes,
        events=(generated.events[0],),
    )

    with pytest.raises(CohortSimulationError, match="must not contain events"):
        simulate_preference_cohort(mixed_catalog, CohortSimulationConfig(seed=11))


def test_simulation_rejects_a_catalog_without_enough_available_items() -> None:
    catalog = _catalog(recipe_count=8, future_recipes=2)

    with pytest.raises(CohortSimulationError, match="available before the cutoff"):
        simulate_preference_cohort(catalog, CohortSimulationConfig(seed=13))


@pytest.mark.parametrize(
    ("cutoff", "created_at"),
    [
        (datetime(1, 1, 2, tzinfo=UTC), datetime(1, 1, 1, tzinfo=UTC)),
        (datetime(9999, 12, 31, tzinfo=UTC), datetime(9999, 12, 1, tzinfo=UTC)),
    ],
)
def test_simulation_rejects_cutoffs_that_cannot_fit_the_configured_windows(
    cutoff: datetime,
    created_at: datetime,
) -> None:
    catalog = create_snapshot(
        dataset_id="datetime-boundary-catalog",
        cutoff=cutoff,
        limitations=("Invented datetime boundary fixture.",),
        recipes=tuple(
            SnapshotRecipe(
                id=UUID(int=500 + index),
                created_at=created_at,
                title=f"Boundary Recipe {index}",
                version_number=1,
                ingredient_measures=(
                    SnapshotIngredientMeasure(
                        ingredient_id=UUID(int=5_000 + index),
                        kind="qualitative",
                        quantity_min=None,
                        quantity_max=None,
                        measurement_unit_id=None,
                        package_size_id=None,
                        qualitative_value="unspecified",
                    ),
                ),
            )
            for index in range(7)
        ),
        events=(),
    )

    with pytest.raises(CohortSimulationError, match="cannot accommodate"):
        simulate_preference_cohort(catalog, CohortSimulationConfig(seed=13))


@pytest.mark.parametrize(
    ("values", "message"),
    [
        ({"seed": True}, "seed must be an integer"),
        ({"seed": -1}, "seed must be between"),
        ({"seed": 1, "profile_count": 1}, "profile_count"),
        ({"seed": 1, "training_items_per_profile": 1}, "training_items_per_profile"),
        ({"seed": 1, "holdout_items_per_profile": 0}, "holdout_items_per_profile"),
        ({"seed": 1, "training_window_days": 0}, "training_window_days"),
        ({"seed": 1, "holdout_window_days": 0}, "holdout_window_days"),
        ({"seed": 1, "dataset_id": 123}, "dataset_id"),
        ({"seed": 1, "dataset_id": "contains/private path"}, "dataset_id"),
        (
            {"seed": 1, "profile_count": 100_000},
            "safety limit",
        ),
    ],
)
def test_configuration_rejects_ambiguous_or_pathological_values(
    values: dict[str, object],
    message: str,
) -> None:
    with pytest.raises(CohortSimulationError, match=message):
        CohortSimulationConfig(**values)  # type: ignore[arg-type]


def test_restricted_dataset_id_and_fixed_assumptions_are_preserved() -> None:
    simulated = simulate_preference_cohort(
        _catalog(),
        CohortSimulationConfig(seed=99, dataset_id="recipe-lab:cohort_2026.08-v1"),
    )

    assert simulated.dataset_id == "recipe-lab:cohort_2026.08-v1"
    assert set(SIMULATION_ASSUMPTIONS).issubset(simulated.limitations)


def test_generated_event_memory_boundary_is_explicit_and_inclusive() -> None:
    boundary = CohortSimulationConfig(
        seed=1,
        profile_count=50,
        training_items_per_profile=9_999,
        holdout_items_per_profile=1,
    )

    assert boundary.generated_event_count == 1_000_000
    with pytest.raises(
        CohortSimulationError,
        match="configuration would generate 1000100 events; the safety limit is 1000000",
    ):
        CohortSimulationConfig(
            seed=1,
            profile_count=50,
            training_items_per_profile=10_000,
            holdout_items_per_profile=1,
        )
