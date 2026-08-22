import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import UUID

import pytest

from recipe_lab_evaluation.dataset import (
    EvaluationSnapshot,
    SnapshotEvent,
    SnapshotRecipe,
    SnapshotValidationError,
    canonical_json,
    create_snapshot,
)
from recipe_lab_evaluation.readiness import (
    DEFAULT_READINESS_THRESHOLDS,
    READINESS_LIMITATIONS,
    ReadinessThresholds,
    assess_readiness,
    readiness_report_to_document,
    readiness_report_to_json,
)

CUTOFF = datetime(2026, 7, 1, tzinfo=UTC)
RECIPE_IDS = (
    UUID("10000000-0000-4000-8000-000000000001"),
    UUID("10000000-0000-4000-8000-000000000002"),
    UUID("10000000-0000-4000-8000-000000000003"),
)
PROFILE_IDS = (
    UUID("20000000-0000-4000-8000-000000000001"),
    UUID("20000000-0000-4000-8000-000000000002"),
)


def _event(
    number: int,
    *,
    profile_id: UUID,
    recipe_id: UUID,
    occurred_at: datetime,
    event_type: str = "view",
) -> SnapshotEvent:
    event_id = UUID(f"30000000-0000-4000-8000-{number:012d}")
    if event_type == "save":
        return SnapshotEvent(
            id=event_id,
            user_id=profile_id,
            recipe_version_id=recipe_id,
            event_type="save",
            occurred_at=occurred_at,
            saved_value=True,
            rating_value=None,
            related_recipe_version_id=None,
        )
    return SnapshotEvent(
        id=event_id,
        user_id=profile_id,
        recipe_version_id=recipe_id,
        event_type="view",
        occurred_at=occurred_at,
        saved_value=None,
        rating_value=None,
        related_recipe_version_id=None,
    )


def _boundary_snapshot() -> EvaluationSnapshot:
    recipes = tuple(
        SnapshotRecipe(
            id=recipe_id,
            created_at=CUTOFF - timedelta(days=10),
            title=f"Private fixture title {index}",
            version_number=1,
            ingredient_ids=(UUID(f"40000000-0000-4000-8000-{index:012d}"),),
        )
        for index, recipe_id in enumerate(RECIPE_IDS, start=1)
    )
    events: list[SnapshotEvent] = []
    event_number = 1
    for profile_offset, profile_id in enumerate(PROFILE_IDS):
        for recipe_offset, recipe_id in enumerate(RECIPE_IDS[:2]):
            events.append(
                _event(
                    event_number,
                    profile_id=profile_id,
                    recipe_id=recipe_id,
                    occurred_at=CUTOFF - timedelta(days=3 - recipe_offset, minutes=profile_offset),
                )
            )
            event_number += 1
        events.append(
            _event(
                event_number,
                profile_id=profile_id,
                recipe_id=RECIPE_IDS[2],
                occurred_at=CUTOFF + timedelta(minutes=profile_offset),
                event_type="save",
            )
        )
        event_number += 1
    return create_snapshot(
        dataset_id="readiness-boundary-fixture-v1",
        cutoff=CUTOFF,
        limitations=("Synthetic boundary fixture; not evidence about real users.",),
        recipes=recipes,
        events=tuple(events),
    )


def _boundary_thresholds() -> ReadinessThresholds:
    return ReadinessThresholds(
        minimum_training_profiles=2,
        minimum_available_items=3,
        minimum_training_events=4,
        minimum_distinct_training_items_per_profile=2,
        minimum_supported_profiles=2,
        minimum_distinct_training_profiles_per_item=2,
        minimum_supported_items=2,
        minimum_observed_training_pairs=4,
        minimum_temporal_evaluation_profiles=2,
        minimum_temporal_relevant_items=2,
    )


def test_exact_threshold_boundaries_are_ready_and_report_real_counts() -> None:
    report = assess_readiness(_boundary_snapshot(), _boundary_thresholds())

    assert report.status == "ready"
    assert report.reason_codes == ()
    assert all(check.actual == check.minimum for check in report.checks)
    assert all(check.passed for check in report.checks)
    assert report.counts.profiles.total == 2
    assert report.counts.profiles.training == 2
    assert report.counts.profiles.holdout == 2
    assert report.counts.items.total == 3
    assert report.counts.items.available_at_cutoff == 3
    assert report.counts.items.observed_in_training == 2
    assert report.counts.interactions.total == 6
    assert report.counts.interactions.training == 4
    assert report.counts.interactions.holdout == 2
    assert report.counts.sparsity.possible_training_pairs == 6
    assert report.counts.sparsity.observed_training_pairs == 4
    assert report.counts.sparsity.unobserved_training_pairs == 2
    assert report.counts.temporal_evaluation.profiles_with_supported_history == 2
    assert report.counts.temporal_evaluation.relevant_items_for_supported_profiles == 2
    assert report.limitations == READINESS_LIMITATIONS

    document = readiness_report_to_document(report)
    sparsity = cast(dict[str, object], cast(dict[str, object], document["counts"])["sparsity"])
    assert sparsity["density"] == {"numerator": 4, "denominator": 6}
    assert sparsity["sparsity"] == {"numerator": 2, "denominator": 6}


def test_sparse_snapshot_returns_every_exact_failed_reason_in_stable_order() -> None:
    thresholds = ReadinessThresholds(
        minimum_training_profiles=3,
        minimum_available_items=4,
        minimum_training_events=5,
        minimum_distinct_training_items_per_profile=3,
        minimum_supported_profiles=3,
        minimum_distinct_training_profiles_per_item=3,
        minimum_supported_items=3,
        minimum_observed_training_pairs=5,
        minimum_temporal_evaluation_profiles=3,
        minimum_temporal_relevant_items=3,
    )

    report = assess_readiness(_boundary_snapshot(), thresholds)

    assert report.status == "insufficient_data"
    assert report.reason_codes == (
        "training_profiles_below_minimum",
        "available_items_below_minimum",
        "training_events_below_minimum",
        "supported_profiles_below_minimum",
        "supported_items_below_minimum",
        "observed_training_pairs_below_minimum",
        "temporal_evaluation_profiles_below_minimum",
        "temporal_relevant_items_below_minimum",
    )
    assert (
        tuple(check.failure_reason for check in report.checks if not check.passed)
        == report.reason_codes
    )
    assert report.counts.support.profiles_meeting_history_minimum == 0
    assert report.counts.support.items_meeting_profile_minimum == 0
    assert report.counts.temporal_evaluation.profiles_with_supported_history == 0


def test_empty_matrix_reports_undefined_fractions_instead_of_fake_values() -> None:
    snapshot = create_snapshot(
        dataset_id="empty-readiness-fixture-v1",
        cutoff=CUTOFF,
        limitations=("Empty structural fixture.",),
        recipes=(),
        events=(),
    )

    report = assess_readiness(snapshot)
    document = readiness_report_to_document(report)
    sparsity = cast(dict[str, object], cast(dict[str, object], document["counts"])["sparsity"])

    assert report.status == "insufficient_data"
    assert report.counts.sparsity.possible_training_pairs == 0
    assert sparsity["density"] is None
    assert sparsity["sparsity"] is None


def test_repeated_event_rows_do_not_invent_matrix_support() -> None:
    snapshot = _boundary_snapshot()
    duplicate_pair_event = _event(
        100,
        profile_id=PROFILE_IDS[0],
        recipe_id=RECIPE_IDS[0],
        occurred_at=CUTOFF - timedelta(hours=1),
    )
    augmented = create_snapshot(
        dataset_id=snapshot.dataset_id,
        cutoff=snapshot.cutoff,
        limitations=snapshot.limitations,
        recipes=snapshot.recipes,
        events=snapshot.events + (duplicate_pair_event,),
    )

    original = assess_readiness(snapshot, _boundary_thresholds())
    report = assess_readiness(augmented, _boundary_thresholds())

    assert report.counts.interactions.training == original.counts.interactions.training + 1
    assert report.counts.sparsity == original.counts.sparsity
    assert report.counts.support == original.counts.support


def test_holdout_only_profiles_and_items_cannot_inflate_training_readiness() -> None:
    snapshot = _boundary_snapshot()
    holdout_only_profile = UUID("20000000-0000-4000-8000-000000000003")
    future_recipe = SnapshotRecipe(
        id=UUID("10000000-0000-4000-8000-000000000004"),
        created_at=CUTOFF,
        title="Future private fixture title",
        version_number=1,
        ingredient_ids=(UUID("40000000-0000-4000-8000-000000000004"),),
    )
    holdout_event = _event(
        101,
        profile_id=holdout_only_profile,
        recipe_id=future_recipe.id,
        occurred_at=CUTOFF,
        event_type="save",
    )
    augmented = create_snapshot(
        dataset_id=snapshot.dataset_id,
        cutoff=snapshot.cutoff,
        limitations=snapshot.limitations,
        recipes=snapshot.recipes + (future_recipe,),
        events=snapshot.events + (holdout_event,),
    )

    original = assess_readiness(snapshot, _boundary_thresholds())
    report = assess_readiness(augmented, _boundary_thresholds())

    assert report.counts.profiles.total == original.counts.profiles.total + 1
    assert report.counts.profiles.training == original.counts.profiles.training
    assert report.counts.items.total == original.counts.items.total + 1
    assert report.counts.items.available_at_cutoff == original.counts.items.available_at_cutoff
    assert report.counts.interactions.training == original.counts.interactions.training
    assert report.counts.support == original.counts.support
    assert report.counts.temporal_evaluation.filtered_unavailable == 1
    assert (
        report.counts.temporal_evaluation.profiles_with_supported_history
        == original.counts.temporal_evaluation.profiles_with_supported_history
    )
    assert report.status == "ready"


def test_assessment_revalidates_impossible_event_timeline() -> None:
    snapshot = _boundary_snapshot()
    first_event = snapshot.events[0]
    impossible_event = replace(
        first_event,
        occurred_at=snapshot.recipes[0].created_at - timedelta(seconds=1),
    )
    invalid_snapshot = replace(
        snapshot,
        events=(impossible_event, *snapshot.events[1:]),
    )

    with pytest.raises(SnapshotValidationError, match="before its source recipe"):
        assess_readiness(invalid_snapshot, _boundary_thresholds())


def test_report_is_canonical_deterministic_and_aggregate_only() -> None:
    snapshot = _boundary_snapshot()
    reordered = replace(
        snapshot,
        recipes=tuple(reversed(snapshot.recipes)),
        events=tuple(reversed(snapshot.events)),
    )

    first = readiness_report_to_json(assess_readiness(snapshot, _boundary_thresholds()))
    second = readiness_report_to_json(assess_readiness(snapshot, _boundary_thresholds()))
    reordered_json = readiness_report_to_json(assess_readiness(reordered, _boundary_thresholds()))

    assert first == second == reordered_json
    assert first == canonical_json(json.loads(first)) + "\n"
    assert "generated_at" not in first
    assert "host" not in first
    assert "path" not in first
    for recipe in snapshot.recipes:
        assert str(recipe.id) not in first
        assert recipe.title not in first
    for event in snapshot.events:
        assert str(event.id) not in first
        assert str(event.user_id) not in first

    private_metadata_snapshot = create_snapshot(
        dataset_id="private-source-label-do-not-echo",
        cutoff=snapshot.cutoff,
        limitations=("Private source note must not enter the aggregate report.",),
        recipes=snapshot.recipes,
        events=snapshot.events,
    )
    private_metadata_report = readiness_report_to_json(
        assess_readiness(private_metadata_snapshot, _boundary_thresholds())
    )
    assert "private-source-label-do-not-echo" not in private_metadata_report
    assert "Private source note" not in private_metadata_report
    private_document = cast(dict[str, object], json.loads(private_metadata_report))
    snapshot_document = cast(dict[str, object], private_document["snapshot"])
    assert set(snapshot_document) == {"schema_version", "sha256", "cutoff"}


@pytest.mark.parametrize("invalid", [0, -1, True, 1.5, "5"])
def test_thresholds_reject_non_positive_and_non_integer_values(invalid: object) -> None:
    with pytest.raises(ValueError, match="minimum_training_profiles"):
        replace(
            DEFAULT_READINESS_THRESHOLDS,
            minimum_training_profiles=cast(int, invalid),
        )


def test_every_threshold_field_is_validated() -> None:
    with pytest.raises(ValueError, match="minimum_supported_items"):
        replace(DEFAULT_READINESS_THRESHOLDS, minimum_supported_items=0)


def test_defaults_are_explicitly_engineering_only() -> None:
    assert DEFAULT_READINESS_THRESHOLDS.minimum_available_items == 8
    assert DEFAULT_READINESS_THRESHOLDS.minimum_distinct_training_items_per_profile == 5
    assert DEFAULT_READINESS_THRESHOLDS.minimum_observed_training_pairs == 200
    assert any("only offline RCP-18" in limitation for limitation in READINESS_LIMITATIONS)
    assert any("not demonstrate behavior for real users" in item for item in READINESS_LIMITATIONS)
