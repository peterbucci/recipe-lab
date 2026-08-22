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
    READINESS_PROTOCOL_VERSION,
    READINESS_REPORT_SCHEMA_VERSION,
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
    UUID("10000000-0000-4000-8000-000000000004"),
    UUID("10000000-0000-4000-8000-000000000005"),
    UUID("10000000-0000-4000-8000-000000000006"),
)
PROFILE_IDS = (
    UUID("20000000-0000-4000-8000-000000000001"),
    UUID("20000000-0000-4000-8000-000000000002"),
    UUID("20000000-0000-4000-8000-000000000003"),
    UUID("20000000-0000-4000-8000-000000000004"),
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
        heldout_recipe_id = RECIPE_IDS[profile_offset]
        for recipe_offset, recipe_id in enumerate(RECIPE_IDS):
            if recipe_id == heldout_recipe_id:
                continue
            events.append(
                _event(
                    event_number,
                    profile_id=profile_id,
                    recipe_id=recipe_id,
                    occurred_at=CUTOFF - timedelta(days=7 - recipe_offset, minutes=profile_offset),
                )
            )
            event_number += 1
        events.append(
            _event(
                event_number,
                profile_id=profile_id,
                recipe_id=heldout_recipe_id,
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
        minimum_training_profiles=4,
        minimum_available_items=6,
        minimum_training_events=20,
        minimum_distinct_training_items_per_profile=5,
        minimum_supported_profiles=4,
        minimum_distinct_training_profiles_per_item=3,
        minimum_supported_items=6,
        minimum_observed_training_pairs=20,
        minimum_nonzero_signal_pairs=20,
        minimum_signal_supported_profiles=4,
        minimum_signal_supported_items=6,
        minimum_temporal_evaluation_profiles=4,
        minimum_temporal_relevant_items=4,
    )


def test_exact_threshold_boundaries_are_ready_and_report_real_counts() -> None:
    report = assess_readiness(_boundary_snapshot(), _boundary_thresholds())

    assert report.status == "ready"
    assert report.schema_version == "recipe-lab-collaborative-readiness-report-v2"
    assert report.schema_version == READINESS_REPORT_SCHEMA_VERSION
    assert report.protocol_version == "fixed-cutoff-collaborative-readiness-v2"
    assert report.protocol_version == READINESS_PROTOCOL_VERSION
    assert report.reason_codes == ()
    assert all(check.actual == check.minimum for check in report.checks)
    assert all(check.passed for check in report.checks)
    assert report.counts.profiles.total == 4
    assert report.counts.profiles.training == 4
    assert report.counts.profiles.holdout == 4
    assert report.counts.items.total == 6
    assert report.counts.items.available_at_cutoff == 6
    assert report.counts.items.observed_in_training == 6
    assert report.counts.interactions.total == 24
    assert report.counts.interactions.training == 20
    assert report.counts.interactions.holdout == 4
    assert report.counts.sparsity.possible_training_pairs == 24
    assert report.counts.sparsity.observed_training_pairs == 20
    assert report.counts.sparsity.unobserved_training_pairs == 4
    assert report.counts.effective_signals.profiles_with_nonzero_signals == 4
    assert report.counts.effective_signals.items_with_nonzero_signals == 6
    assert report.counts.effective_signals.nonzero_signal_pairs == 20
    assert report.counts.effective_signals.profiles_meeting_signal_minimum == 4
    assert report.counts.effective_signals.items_meeting_signal_minimum == 6
    assert report.counts.collaborative_evidence.profiles_with_supported_targets == 4
    assert report.counts.collaborative_evidence.profiles_with_usable_candidate_evidence == 4
    assert report.counts.collaborative_evidence.candidate_items_with_usable_evidence == 4
    assert report.counts.temporal_evaluation.profiles_with_collaborative_evidence == 4
    assert report.counts.temporal_evaluation.relevant_items_for_collaborative_profiles == 4
    assert report.limitations == READINESS_LIMITATIONS

    document = readiness_report_to_document(report)
    sparsity = cast(dict[str, object], cast(dict[str, object], document["counts"])["sparsity"])
    assert sparsity["density"] == {"numerator": 20, "denominator": 24}
    assert sparsity["sparsity"] == {"numerator": 4, "denominator": 24}


def test_sparse_snapshot_returns_every_exact_failed_reason_in_stable_order() -> None:
    thresholds = ReadinessThresholds(
        minimum_training_profiles=5,
        minimum_available_items=7,
        minimum_training_events=21,
        minimum_distinct_training_items_per_profile=6,
        minimum_supported_profiles=5,
        minimum_distinct_training_profiles_per_item=5,
        minimum_supported_items=7,
        minimum_observed_training_pairs=21,
        minimum_nonzero_signal_pairs=21,
        minimum_signal_supported_profiles=5,
        minimum_signal_supported_items=7,
        minimum_temporal_evaluation_profiles=5,
        minimum_temporal_relevant_items=5,
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
        "nonzero_signal_pairs_below_minimum",
        "signal_supported_profiles_below_minimum",
        "signal_supported_items_below_minimum",
        "temporal_evaluation_profiles_below_minimum",
        "temporal_relevant_items_below_minimum",
    )
    assert (
        tuple(check.failure_reason for check in report.checks if not check.passed)
        == report.reason_codes
    )
    assert report.counts.support.profiles_meeting_history_minimum == 0
    assert report.counts.support.items_meeting_profile_minimum == 0
    assert report.counts.temporal_evaluation.profiles_with_collaborative_evidence == 0


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
        recipe_id=RECIPE_IDS[1],
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
    assert report.counts.effective_signals == original.counts.effective_signals


def test_holdout_only_profiles_and_items_cannot_inflate_training_readiness() -> None:
    snapshot = _boundary_snapshot()
    holdout_only_profile = UUID("20000000-0000-4000-8000-000000000009")
    future_recipe = SnapshotRecipe(
        id=UUID("10000000-0000-4000-8000-000000000007"),
        created_at=CUTOFF,
        title="Future private fixture title",
        version_number=1,
        ingredient_ids=(UUID("40000000-0000-4000-8000-000000000007"),),
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
    assert report.counts.effective_signals == original.counts.effective_signals
    assert report.counts.temporal_evaluation.filtered_unavailable == 1
    assert (
        report.counts.temporal_evaluation.profiles_with_collaborative_evidence
        == original.counts.temporal_evaluation.profiles_with_collaborative_evidence
    )
    assert report.status == "ready"


def test_signed_state_cancellation_cannot_pass_effective_readiness() -> None:
    recipes = tuple(
        SnapshotRecipe(
            id=UUID(int=100 + index),
            created_at=CUTOFF - timedelta(days=10),
            title=f"Cancellation fixture {index}",
            version_number=1,
            ingredient_ids=(UUID(int=200 + index),),
        )
        for index in range(8)
    )
    events: list[SnapshotEvent] = []
    event_number = 1_000_000
    for profile_index in range(64):
        profile_id = UUID(int=1_000 + profile_index)
        for item_offset in range(5):
            recipe_id = recipes[(profile_index + item_offset) % len(recipes)].id
            events.extend(
                (
                    SnapshotEvent(
                        id=UUID(int=event_number),
                        user_id=profile_id,
                        recipe_version_id=recipe_id,
                        event_type="view",
                        occurred_at=CUTOFF - timedelta(days=1),
                        saved_value=None,
                        rating_value=None,
                        related_recipe_version_id=None,
                    ),
                    SnapshotEvent(
                        id=UUID(int=event_number + 1),
                        user_id=profile_id,
                        recipe_version_id=recipe_id,
                        event_type="save",
                        occurred_at=CUTOFF - timedelta(days=1),
                        saved_value=True,
                        rating_value=None,
                        related_recipe_version_id=None,
                    ),
                    SnapshotEvent(
                        id=UUID(int=event_number + 2),
                        user_id=profile_id,
                        recipe_version_id=recipe_id,
                        event_type="rating",
                        occurred_at=CUTOFF - timedelta(days=1),
                        saved_value=None,
                        rating_value=1,
                        related_recipe_version_id=None,
                    ),
                )
            )
            event_number += 3
        events.append(
            SnapshotEvent(
                id=UUID(int=event_number),
                user_id=profile_id,
                recipe_version_id=recipes[(profile_index + 5) % len(recipes)].id,
                event_type="save",
                occurred_at=CUTOFF,
                saved_value=True,
                rating_value=None,
                related_recipe_version_id=None,
            )
        )
        event_number += 1

    report = assess_readiness(
        create_snapshot(
            dataset_id="cancelled-signal-readiness-fixture-v1",
            cutoff=CUTOFF,
            limitations=("Synthetic cancellation fixture.",),
            recipes=recipes,
            events=tuple(events),
        )
    )

    assert report.counts.profiles.training == 64
    assert report.counts.interactions.training == 960
    assert report.counts.sparsity.observed_training_pairs == 320
    assert report.counts.support.profiles_meeting_history_minimum == 64
    assert report.counts.support.items_meeting_profile_minimum == 8
    assert report.counts.effective_signals.nonzero_signal_pairs == 0
    assert report.counts.effective_signals.profiles_meeting_signal_minimum == 0
    assert report.counts.effective_signals.items_meeting_signal_minimum == 0
    assert report.status == "insufficient_data"
    assert report.reason_codes == (
        "nonzero_signal_pairs_below_minimum",
        "signal_supported_profiles_below_minimum",
        "signal_supported_items_below_minimum",
        "temporal_evaluation_profiles_below_minimum",
        "temporal_relevant_items_below_minimum",
    )


def test_dense_nonoverlapping_profiles_cannot_pass_on_content_fallback() -> None:
    field_order = 5
    projective_vectors: set[tuple[int, ...]] = set()
    for first in range(field_order):
        for second in range(field_order):
            for third in range(field_order):
                vector = (first, second, third)
                if vector == (0, 0, 0):
                    continue
                pivot = next(value for value in vector if value)
                inverse = pow(pivot, -1, field_order)
                projective_vectors.add(tuple((value * inverse) % field_order for value in vector))
    points = tuple(sorted(projective_vectors))
    lines = points
    assert len(points) == 31

    recipes: list[SnapshotRecipe] = []
    events: list[SnapshotEvent] = []
    training_pairs: list[tuple[UUID, UUID]] = []
    event_number = 40_000
    for copy_index in range(2):
        recipe_ids = tuple(UUID(int=10_000 + copy_index * 100 + index) for index in range(31))
        recipes.extend(
            SnapshotRecipe(
                id=recipe_id,
                created_at=CUTOFF - timedelta(days=10),
                title=f"Linear overlap fixture {copy_index}-{index}",
                version_number=1,
                ingredient_ids=(UUID(int=20_000 + copy_index * 100 + index),),
            )
            for index, recipe_id in enumerate(recipe_ids)
        )
        for line_index, line in enumerate(lines):
            profile_id = UUID(int=30_000 + copy_index * 100 + line_index)
            incident_indices = tuple(
                point_index
                for point_index, point in enumerate(points)
                if sum(left * right for left, right in zip(line, point, strict=True)) % field_order
                == 0
            )
            assert len(incident_indices) == 6
            for point_index in incident_indices:
                recipe_id = recipe_ids[point_index]
                training_pairs.append((profile_id, recipe_id))
                events.append(
                    _event(
                        event_number,
                        profile_id=profile_id,
                        recipe_id=recipe_id,
                        occurred_at=CUTOFF - timedelta(days=2),
                    )
                )
                event_number += 1
            holdout_index = next(index for index in range(31) if index not in incident_indices)
            events.append(
                _event(
                    event_number,
                    profile_id=profile_id,
                    recipe_id=recipe_ids[holdout_index],
                    occurred_at=CUTOFF,
                    event_type="save",
                )
            )
            event_number += 1

    for profile_id, recipe_id in training_pairs[:128]:
        events.append(
            _event(
                event_number,
                profile_id=profile_id,
                recipe_id=recipe_id,
                occurred_at=CUTOFF - timedelta(days=1),
            )
        )
        event_number += 1

    report = assess_readiness(
        create_snapshot(
            dataset_id="linear-overlap-readiness-fixture-v1",
            cutoff=CUTOFF,
            limitations=("Synthetic linear-overlap fixture.",),
            recipes=tuple(recipes),
            events=tuple(events),
        )
    )

    assert report.counts.interactions.training == 500
    assert report.counts.sparsity.observed_training_pairs == 372
    assert report.counts.effective_signals.nonzero_signal_pairs == 372
    assert report.counts.effective_signals.profiles_meeting_signal_minimum == 62
    assert report.counts.effective_signals.items_meeting_signal_minimum == 62
    assert report.counts.collaborative_evidence.profiles_with_supported_targets == 62
    assert report.counts.collaborative_evidence.profiles_with_usable_candidate_evidence == 0
    assert report.counts.collaborative_evidence.candidate_items_with_usable_evidence == 0
    assert report.status == "insufficient_data"
    assert report.reason_codes == (
        "temporal_evaluation_profiles_below_minimum",
        "temporal_relevant_items_below_minimum",
    )


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
    assert DEFAULT_READINESS_THRESHOLDS.minimum_nonzero_signal_pairs == 200
    assert DEFAULT_READINESS_THRESHOLDS.minimum_signal_supported_profiles == 40
    assert DEFAULT_READINESS_THRESHOLDS.minimum_signal_supported_items == 8
    assert any("only offline RCP-18" in limitation for limitation in READINESS_LIMITATIONS)
    assert any("not demonstrate behavior for real users" in item for item in READINESS_LIMITATIONS)
