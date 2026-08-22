import json
import os
import subprocess
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import cast
from uuid import UUID

import pytest

from recipe_lab_evaluation.cli import STRICT_INSUFFICIENT_DATA_EXIT_CODE, main
from recipe_lab_evaluation.dataset import (
    EvaluationSnapshot,
    EventType,
    SnapshotEvent,
    SnapshotRecipe,
    create_snapshot,
    load_snapshot,
    snapshot_to_json,
)
from recipe_lab_evaluation.models import (
    COLLABORATIVE_MODEL_ID,
    CollaborativeV1Model,
    ContentBasedV1Model,
)
from recipe_lab_evaluation.models.collaborative_v1 import (
    MIN_ITEM_SIGNAL_PROFILES,
    MIN_NEIGHBOR_OVERLAP_ITEMS,
    MIN_PROFILE_SIGNAL_ITEMS,
)
from recipe_lab_evaluation.protocol import (
    JsonScalar,
    ModelMetadata,
    ModelTrainingData,
    derive_model_seed,
)
from recipe_lab_evaluation.readiness import assess_readiness
from recipe_lab_evaluation.runner import EvaluationConfig, EvaluationError, evaluate
from recipe_lab_evaluation.simulator import CohortSimulationConfig, simulate_preference_cohort
from recipe_lab_evaluation.split import split_snapshot

_CUTOFF = datetime(2026, 8, 1, tzinfo=UTC)
_TRAINING_TIME = _CUTOFF - timedelta(days=1)
_TARGET_PROFILE = UUID(int=900)
_UNKNOWN_PROFILE = UUID(int=901)
_READINESS_CATALOG = Path(__file__).parent / "fixtures" / "readiness_catalog_v1.json"


@dataclass(frozen=True, slots=True)
class _ArtifactFittedModel:
    metadata: ModelMetadata
    _artifact: Mapping[str, JsonScalar]

    @property
    def collaborative_artifact_document(self) -> Mapping[str, JsonScalar]:
        return self._artifact

    def rank(
        self,
        *,
        user_id: UUID,
        candidate_ids: tuple[UUID, ...],
        limit: int,
    ) -> Sequence[UUID]:
        del user_id
        return candidate_ids[:limit]


@dataclass(frozen=True, slots=True)
class _ArtifactModel:
    overrides: Mapping[str, JsonScalar]
    metadata: ModelMetadata = ModelMetadata(model_id="artifact-contract-test", version="1")

    def fit(self, training: ModelTrainingData, *, seed: int) -> _ArtifactFittedModel:
        del training
        artifact: dict[str, JsonScalar] = {
            "artifact_schema_version": "recipe-lab-collaborative-artifact-v1",
            "artifact_version": "1",
            "model_id": self.metadata.model_id,
            "model_version": self.metadata.version,
            "training_cutoff": "2026-08-01T00:00:00Z",
            "derived_seed": seed,
            "training_data_sha256": "0" * 64,
            "recipe_count": 0,
            "event_count": 0,
            "profile_count": 0,
            "observed_event_pair_count": 0,
            "nonzero_signal_pair_count": 0,
            "supported_profile_count": 0,
            "supported_item_count": 0,
        }
        artifact.update(self.overrides)
        return _ArtifactFittedModel(metadata=self.metadata, _artifact=artifact)


@dataclass(frozen=True, slots=True)
class _MalformedArtifactFittedModel:
    metadata: ModelMetadata
    value: object

    @property
    def collaborative_artifact_document(self) -> Mapping[str, JsonScalar]:
        return cast(Mapping[str, JsonScalar], self.value)

    def rank(
        self,
        *,
        user_id: UUID,
        candidate_ids: tuple[UUID, ...],
        limit: int,
    ) -> Sequence[UUID]:
        del user_id
        return candidate_ids[:limit]


@dataclass(frozen=True, slots=True)
class _MalformedArtifactModel:
    value: object
    metadata: ModelMetadata = ModelMetadata(model_id="malformed-artifact-test", version="1")

    def fit(self, training: ModelTrainingData, *, seed: int) -> _MalformedArtifactFittedModel:
        del training, seed
        return _MalformedArtifactFittedModel(metadata=self.metadata, value=self.value)


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
    occurred_at: datetime = _TRAINING_TIME,
    saved_value: bool | None = None,
    rating_value: int | None = None,
    related_recipe_id: UUID | None = None,
) -> SnapshotEvent:
    return SnapshotEvent(
        id=UUID(int=10_000 + identifier),
        user_id=profile_id,
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


def _collaborative_fixture() -> tuple[
    ModelTrainingData,
    tuple[SnapshotRecipe, ...],
    SnapshotRecipe,
    SnapshotRecipe,
]:
    anchors = tuple(_recipe(index, ingredients=(100 + index,)) for index in range(1, 6))
    # Content and global-prior fallbacks deliberately tie these candidates. UUID order favors
    # the decoy, so a target-first ranking must come from shared interaction structure.
    decoy = _recipe(6, title="Candidate", ingredients=(500,))
    target = _recipe(7, title="Candidate", ingredients=(500,))
    recipes = (*anchors, decoy, target)
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

    # Three positively similar neighbors prefer target over decoy.
    for profile_int in range(1_001, 1_004):
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
        events.extend(
            (
                _event(
                    event_id,
                    profile_id=profile_id,
                    recipe_id=target.id,
                    event_type="save",
                    saved_value=True,
                ),
                _event(
                    event_id + 1,
                    profile_id=profile_id,
                    recipe_id=decoy.id,
                    event_type="save",
                    saved_value=False,
                ),
            )
        )
        event_id += 2

    # Equal and opposite non-neighbor preferences cancel the global signed priors without
    # creating shared-history evidence for the target profile.
    for profile_int in range(2_001, 2_004):
        profile_id = UUID(int=profile_int)
        events.extend(
            (
                _event(
                    event_id,
                    profile_id=profile_id,
                    recipe_id=target.id,
                    event_type="save",
                    saved_value=False,
                ),
                _event(
                    event_id + 1,
                    profile_id=profile_id,
                    recipe_id=decoy.id,
                    event_type="save",
                    saved_value=True,
                ),
            )
        )
        event_id += 2

    return _training(recipes, tuple(events)), anchors, decoy, target


def test_shared_signed_interactions_add_signal_beyond_the_content_fallback() -> None:
    training, _, decoy, target = _collaborative_fixture()
    candidates = (target.id, decoy.id)
    content = ContentBasedV1Model().fit(training, seed=10)
    collaborative = CollaborativeV1Model().fit(training, seed=10)

    assert content.rank(
        user_id=_TARGET_PROFILE,
        candidate_ids=tuple(reversed(candidates)),
        limit=2,
    ) == (decoy.id, target.id)
    assert collaborative.rank(
        user_id=_TARGET_PROFILE,
        candidate_ids=candidates,
        limit=2,
    ) == (target.id, decoy.id)


def test_positive_collaborative_score_precedes_fallback_then_negative_score() -> None:
    training, _, decoy, target = _collaborative_fixture()
    neutral = _recipe(8, title="Aardvark", ingredients=(500,))
    neutral_events = tuple(
        _event(
            100 + offset,
            profile_id=UUID(int=profile_int),
            recipe_id=neutral.id,
            event_type="save",
            saved_value=True,
        )
        for offset, profile_int in enumerate(range(2_001, 2_004))
    )
    augmented = replace(
        training,
        recipes=(*training.recipes, neutral),
        events=training.events + neutral_events,
    )
    fitted = CollaborativeV1Model().fit(augmented, seed=11)

    assert fitted.rank(
        user_id=_TARGET_PROFILE,
        candidate_ids=(decoy.id, neutral.id, target.id),
        limit=3,
    ) == (target.id, neutral.id, decoy.id)


def test_implicit_weights_support_thresholds_and_formulas_are_versioned_metadata() -> None:
    metadata = CollaborativeV1Model().metadata

    assert metadata.model_id == COLLABORATIVE_MODEL_ID == "collaborative-v1"
    assert metadata.version == "1"
    assert metadata.parameters["save_true_signal_weight"] == "3"
    assert metadata.parameters["save_false_signal_weight"] == "-3"
    assert metadata.parameters["rating_signal_formula"] == "(rating-3)*2"
    assert metadata.parameters["view_signal_weight"] == "1"
    assert metadata.parameters["fork_signal_weight"] == "4"
    assert metadata.parameters["fork_signal_targets"] == "source_and_child"
    assert metadata.parameters["save_state_policy"] == "latest_by_occurred_at_then_event_uuid"
    assert metadata.parameters["rating_state_policy"] == "latest_by_occurred_at_then_event_uuid"
    assert metadata.parameters["repeated_view_policy"] == "deduplicate_user_recipe"
    assert metadata.parameters["repeated_fork_policy"] == "deduplicate_user_source_child"
    assert metadata.parameters["minimum_profile_signal_items"] == MIN_PROFILE_SIGNAL_ITEMS
    assert metadata.parameters["minimum_item_signal_profiles"] == MIN_ITEM_SIGNAL_PROFILES
    assert metadata.parameters["minimum_neighbor_overlap_items"] == MIN_NEIGHBOR_OVERLAP_ITEMS
    assert metadata.parameters["neighbor_similarity"] == (
        "sum(target_signal*neighbor_signal)/sum(abs(target_signal*neighbor_signal))_over_overlap"
    )
    assert metadata.parameters["candidate_score"] == (
        "sum(neighbor_similarity*neighbor_candidate_signal)/sum(abs(neighbor_similarity))"
    )
    assert metadata.parameters["fallback_model_id"] == "content-v1"
    assert "content-v1" in str(metadata.parameters["cold_start"])
    assert MIN_PROFILE_SIGNAL_ITEMS == 5
    assert MIN_ITEM_SIGNAL_PROFILES == 3
    assert MIN_NEIGHBOR_OVERLAP_ITEMS == 2


def test_artifact_metadata_fingerprints_the_exact_training_data_and_support() -> None:
    training, _, _, _ = _collaborative_fixture()
    fitted = CollaborativeV1Model().fit(training, seed=123_456)
    artifact = fitted.artifact_metadata

    assert artifact.model_id == COLLABORATIVE_MODEL_ID
    assert artifact.model_version == "1"
    assert artifact.training_cutoff == _CUTOFF
    assert artifact.derived_seed == 123_456
    assert len(artifact.training_data_sha256) == 64
    assert set(artifact.training_data_sha256) <= set("0123456789abcdef")
    assert artifact.recipe_count == 7
    assert artifact.event_count == 23
    assert artifact.profile_count == 7
    assert artifact.observed_event_pair_count == 23
    assert artifact.nonzero_signal_pair_count == 23
    assert artifact.supported_profile_count == 1
    assert artifact.supported_item_count == 4
    assert fitted.collaborative_artifact_document == {
        "artifact_schema_version": "recipe-lab-collaborative-artifact-v1",
        "artifact_version": "1",
        "derived_seed": 123_456,
        "event_count": 23,
        "model_id": COLLABORATIVE_MODEL_ID,
        "model_version": "1",
        "nonzero_signal_pair_count": 23,
        "observed_event_pair_count": 23,
        "profile_count": 7,
        "recipe_count": 7,
        "supported_item_count": 4,
        "supported_profile_count": 1,
        "training_cutoff": "2026-08-01T00:00:00Z",
        "training_data_sha256": artifact.training_data_sha256,
    }


def test_sparse_and_unknown_profiles_use_the_exact_content_fallback() -> None:
    training, anchors, decoy, target = _collaborative_fixture()
    candidates = (target.id, decoy.id)

    sparse_events = tuple(
        event
        for event in training.events
        if not (event.user_id == _TARGET_PROFILE and event.recipe_version_id == anchors[-1].id)
    )
    sparse_training = replace(training, events=sparse_events)
    sparse_collaborative = CollaborativeV1Model().fit(sparse_training, seed=20)
    sparse_content = ContentBasedV1Model().fit(sparse_training, seed=20)
    full_collaborative = CollaborativeV1Model().fit(training, seed=20)
    full_content = ContentBasedV1Model().fit(training, seed=20)

    assert sparse_collaborative.rank(
        user_id=_TARGET_PROFILE,
        candidate_ids=candidates,
        limit=2,
    ) == sparse_content.rank(
        user_id=_TARGET_PROFILE,
        candidate_ids=tuple(reversed(candidates)),
        limit=2,
    )
    assert full_collaborative.rank(
        user_id=_UNKNOWN_PROFILE,
        candidate_ids=candidates,
        limit=2,
    ) == full_content.rank(
        user_id=_UNKNOWN_PROFILE,
        candidate_ids=tuple(reversed(candidates)),
        limit=2,
    )


def test_items_below_collaborative_support_use_content_fallback() -> None:
    anchors = tuple(_recipe(index, ingredients=(100 + index,)) for index in range(1, 6))
    decoy = _recipe(6, title="Candidate", ingredients=(500,))
    target = _recipe(7, title="Candidate", ingredients=(500,))
    events: list[SnapshotEvent] = [
        _event(
            index,
            profile_id=_TARGET_PROFILE,
            recipe_id=anchor.id,
            event_type="save",
            saved_value=True,
        )
        for index, anchor in enumerate(anchors, start=1)
    ]
    positive_neighbor = UUID(int=1_001)
    balancing_non_neighbor = UUID(int=2_001)
    events.extend(
        (
            _event(
                10,
                profile_id=positive_neighbor,
                recipe_id=anchors[0].id,
                event_type="view",
            ),
            _event(
                11,
                profile_id=positive_neighbor,
                recipe_id=anchors[1].id,
                event_type="view",
            ),
            _event(
                12,
                profile_id=positive_neighbor,
                recipe_id=target.id,
                event_type="save",
                saved_value=True,
            ),
            _event(
                13,
                profile_id=positive_neighbor,
                recipe_id=decoy.id,
                event_type="save",
                saved_value=False,
            ),
            _event(
                14,
                profile_id=balancing_non_neighbor,
                recipe_id=target.id,
                event_type="save",
                saved_value=False,
            ),
            _event(
                15,
                profile_id=balancing_non_neighbor,
                recipe_id=decoy.id,
                event_type="save",
                saved_value=True,
            ),
        )
    )
    training = _training((*anchors, decoy, target), tuple(events))
    collaborative = CollaborativeV1Model().fit(training, seed=30)
    content = ContentBasedV1Model().fit(training, seed=30)
    candidates = (target.id, decoy.id)

    assert collaborative.rank(
        user_id=_TARGET_PROFILE,
        candidate_ids=candidates,
        limit=2,
    ) == content.rank(
        user_id=_TARGET_PROFILE,
        candidate_ids=tuple(reversed(candidates)),
        limit=2,
    )


def test_fit_and_ranking_are_order_hash_and_seed_independent() -> None:
    training, _, decoy, target = _collaborative_fixture()
    ordered = CollaborativeV1Model().fit(training, seed=1)
    reordered = CollaborativeV1Model().fit(
        replace(
            training,
            recipes=tuple(reversed(training.recipes)),
            events=tuple(reversed(training.events)),
        ),
        seed=999_999,
    )

    assert ordered.metadata == reordered.metadata
    assert ordered.artifact_metadata.training_data_sha256 == (
        reordered.artifact_metadata.training_data_sha256
    )
    assert ordered.artifact_metadata.derived_seed == 1
    assert reordered.artifact_metadata.derived_seed == 999_999
    assert ordered.rank(
        user_id=_TARGET_PROFILE,
        candidate_ids=(target.id, decoy.id),
        limit=2,
    ) == reordered.rank(
        user_id=_TARGET_PROFILE,
        candidate_ids=(decoy.id, target.id),
        limit=2,
    )


def test_ties_are_resolved_by_fallback_not_candidate_input_order() -> None:
    first = _recipe(1, title="Zulu")
    second = _recipe(2, title="Alpha")
    fitted = CollaborativeV1Model().fit(_training((first, second), ()), seed=40)

    assert (
        fitted.rank(
            user_id=_UNKNOWN_PROFILE,
            candidate_ids=(first.id, second.id),
            limit=2,
        )
        == fitted.rank(
            user_id=_UNKNOWN_PROFILE,
            candidate_ids=(second.id, first.id),
            limit=2,
        )
        == (second.id, first.id)
    )


def test_rank_honors_candidate_subset_and_rejects_invalid_requests() -> None:
    first = _recipe(1)
    second = _recipe(2)
    fitted = CollaborativeV1Model().fit(_training((first, second), ()), seed=50)

    assert fitted.rank(
        user_id=_UNKNOWN_PROFILE,
        candidate_ids=(second.id,),
        limit=1,
    ) == (second.id,)
    with pytest.raises(ValueError, match="duplicates"):
        fitted.rank(
            user_id=_UNKNOWN_PROFILE,
            candidate_ids=(first.id, first.id),
            limit=1,
        )
    with pytest.raises(ValueError, match="outside the fitted catalog"):
        fitted.rank(
            user_id=_UNKNOWN_PROFILE,
            candidate_ids=(UUID(int=999),),
            limit=1,
        )
    with pytest.raises(ValueError, match="candidate count"):
        fitted.rank(
            user_id=_UNKNOWN_PROFILE,
            candidate_ids=(first.id,),
            limit=2,
        )


def test_fit_rejects_duplicate_catalog_ids_and_unknown_event_references() -> None:
    first = _recipe(1)
    with pytest.raises(ValueError, match="unique IDs"):
        CollaborativeV1Model().fit(_training((first, first), ()), seed=60)

    unknown_event = _event(
        1,
        profile_id=_TARGET_PROFILE,
        recipe_id=UUID(int=999),
        event_type="view",
    )
    with pytest.raises(ValueError, match="outside the fitted catalog"):
        CollaborativeV1Model().fit(_training((first,), (unknown_event,)), seed=60)


def test_post_cutoff_events_cannot_change_collaborative_artifact_or_ranking() -> None:
    training, _, decoy, target = _collaborative_fixture()
    original_snapshot = create_snapshot(
        dataset_id="collaborative-leakage-fixture-v1",
        cutoff=_CUTOFF,
        limitations=("Synthetic leakage fixture; not evidence about real users.",),
        recipes=training.recipes,
        events=training.events,
    )
    future_event = _event(
        9_999,
        profile_id=_TARGET_PROFILE,
        recipe_id=decoy.id,
        event_type="save",
        occurred_at=_CUTOFF + timedelta(days=1),
        saved_value=True,
    )
    augmented_snapshot = create_snapshot(
        dataset_id=original_snapshot.dataset_id,
        cutoff=original_snapshot.cutoff,
        limitations=original_snapshot.limitations,
        recipes=original_snapshot.recipes,
        events=original_snapshot.events + (future_event,),
    )
    original_split = split_snapshot(original_snapshot)
    augmented_split = split_snapshot(augmented_snapshot)
    original = CollaborativeV1Model().fit(
        ModelTrainingData(
            cutoff=original_split.cutoff,
            recipes=original_split.recipes,
            events=original_split.training_events,
        ),
        seed=70,
    )
    augmented = CollaborativeV1Model().fit(
        ModelTrainingData(
            cutoff=augmented_split.cutoff,
            recipes=augmented_split.recipes,
            events=augmented_split.training_events,
        ),
        seed=70,
    )

    assert augmented_split.training_events == original_split.training_events
    assert augmented.artifact_metadata == original.artifact_metadata
    assert augmented.rank(
        user_id=_TARGET_PROFILE,
        candidate_ids=(decoy.id, target.id),
        limit=2,
    ) == original.rank(
        user_id=_TARGET_PROFILE,
        candidate_ids=(target.id, decoy.id),
        limit=2,
    )


def test_ready_cohort_reports_collaborative_quality_coverage_and_baseline_deltas() -> None:
    catalog = load_snapshot(_READINESS_CATALOG)
    snapshot = simulate_preference_cohort(
        catalog,
        CohortSimulationConfig(seed=20260822, profile_count=64),
    )
    assert assess_readiness(snapshot).status == "ready"

    report = evaluate(
        snapshot,
        models=(ContentBasedV1Model(), CollaborativeV1Model()),
        config=EvaluationConfig(seed=20260822, ks=(1, 3)),
    )

    assert report.status == "complete"
    assert [model.model_id for model in report.models] == [
        "baseline-v1",
        COLLABORATIVE_MODEL_ID,
        "content-v1",
    ]
    collaborative = report.models[1]
    assert collaborative.version == "1"
    assert [metrics.k for metrics in collaborative.metrics] == [1, 3]
    assert [delta.k for delta in collaborative.deltas_vs_baseline] == [1, 3]
    for metrics, delta in zip(
        collaborative.metrics,
        collaborative.deltas_vs_baseline,
        strict=True,
    ):
        assert metrics.evaluated_users == 64
        assert metrics.precision is not None
        assert metrics.recall is not None
        assert metrics.ndcg is not None
        assert metrics.coverage is not None
        assert delta.precision is not None
        assert delta.recall is not None
        assert delta.ndcg is not None
        assert delta.coverage is not None


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"model_id": "wrong-model"}, "mismatched model_id"),
        ({"model_version": "wrong-version"}, "mismatched model_version"),
        ({"derived_seed": -1}, "mismatched seed"),
        ({"artifact_schema_version": "Private family recipe"}, "artifact metadata"),
        ({"training_cutoff": "not-a-time"}, "artifact metadata"),
        ({"training_data_sha256": "short"}, "artifact metadata"),
        ({"event_count": -1}, "artifact metadata"),
        (
            {"nested": cast(JsonScalar, {"not": "a JSON scalar"})},
            "artifact metadata",
        ),
    ],
)
def test_runner_rejects_invalid_or_mismatched_artifact_metadata(
    synthetic_snapshot: EvaluationSnapshot,
    overrides: Mapping[str, JsonScalar],
    message: str,
) -> None:
    with pytest.raises(EvaluationError, match=message):
        evaluate(
            synthetic_snapshot,
            models=(_ArtifactModel(overrides),),
            config=EvaluationConfig(seed=20260822, ks=(1,)),
        )


@pytest.mark.parametrize("value", [None, {1: "non-string key"}])
def test_runner_rejects_malformed_collaborative_artifact_provider(
    synthetic_snapshot: EvaluationSnapshot,
    value: object,
) -> None:
    with pytest.raises(EvaluationError, match="invalid artifact metadata"):
        evaluate(
            synthetic_snapshot,
            models=(_MalformedArtifactModel(value),),
            config=EvaluationConfig(seed=20260822, ks=(1,)),
        )


def test_insufficient_snapshot_is_detected_before_a_collaborative_experiment() -> None:
    snapshot: EvaluationSnapshot = load_snapshot(_READINESS_CATALOG)
    readiness = assess_readiness(snapshot)

    assert readiness.status == "insufficient_data"
    assert readiness.reason_codes
    assert "training_profiles_below_minimum" in readiness.reason_codes
    with pytest.raises(EvaluationError, match="collaborative readiness failed"):
        evaluate(
            snapshot,
            models=(CollaborativeV1Model(),),
            config=EvaluationConfig(seed=20260822, ks=(1,)),
        )


def test_cli_refuses_insufficient_collaborative_data_without_fitting_or_overwriting(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    snapshot_path = tmp_path / "insufficient.json"
    output_path = tmp_path / "existing.json"
    snapshot_path.write_bytes(_READINESS_CATALOG.read_bytes())
    output_path.write_text("keep me", encoding="utf-8")

    def forbidden_evaluate(*args: object, **kwargs: object) -> None:
        del args, kwargs
        raise AssertionError("collaborative evaluation must not start when readiness fails")

    monkeypatch.setattr("recipe_lab_evaluation.cli.evaluate", forbidden_evaluate)

    exit_code = main(
        [
            "run",
            "--snapshot",
            str(snapshot_path),
            "--collaborative",
            "--output",
            str(output_path),
        ]
    )

    assert exit_code == STRICT_INSUFFICIENT_DATA_EXIT_CODE
    assert output_path.read_text(encoding="utf-8") == "keep me"
    error = capsys.readouterr().err
    assert "training_profiles_below_minimum" in error
    assert "run the readiness command" in error


def test_cli_ready_collaborative_report_has_artifact_quality_coverage_and_no_raw_ids(
    tmp_path: Path,
) -> None:
    catalog = load_snapshot(_READINESS_CATALOG)
    snapshot = simulate_preference_cohort(
        catalog,
        CohortSimulationConfig(seed=20260822, profile_count=64),
    )
    snapshot_path = tmp_path / "ready.json"
    report_path = tmp_path / "report.json"
    snapshot_path.write_text(snapshot_to_json(snapshot), encoding="utf-8")

    assert (
        main(
            [
                "run",
                "--snapshot",
                str(snapshot_path),
                "--collaborative",
                "--k",
                "1",
                "--k",
                "3",
                "--seed",
                "20260822",
                "--output",
                str(report_path),
            ]
        )
        == 0
    )

    raw_report = report_path.read_text(encoding="utf-8")
    report = json.loads(raw_report)
    assert report["schema_version"] == "recipe-lab-offline-evaluation-report-v3"
    assert report["protocol_version"] == "fixed-cutoff-full-catalog-v1"
    assert report["hybrid_adoption"] is None
    assert [model["model_id"] for model in report["models"]] == [
        "baseline-v1",
        COLLABORATIVE_MODEL_ID,
        "content-v1",
    ]
    collaborative = report["models"][1]
    assert collaborative["version"] == "1"
    assert collaborative["artifact"] == {
        "artifact_schema_version": "recipe-lab-collaborative-artifact-v1",
        "artifact_version": "1",
        "derived_seed": derive_model_seed(20260822, COLLABORATIVE_MODEL_ID),
        "event_count": 640,
        "model_id": COLLABORATIVE_MODEL_ID,
        "model_version": "1",
        "nonzero_signal_pair_count": 320,
        "observed_event_pair_count": 320,
        "profile_count": 64,
        "recipe_count": 8,
        "supported_item_count": 8,
        "supported_profile_count": 64,
        "training_cutoff": snapshot.cutoff.isoformat().replace("+00:00", "Z"),
        "training_data_sha256": collaborative["artifact"]["training_data_sha256"],
    }
    assert report["models"][0]["artifact"] is None
    assert report["models"][2]["artifact"] is None
    for metrics, deltas in zip(
        collaborative["metrics"],
        collaborative["deltas_vs_baseline"],
        strict=True,
    ):
        assert metrics["precision"] is not None
        assert metrics["recall"] is not None
        assert metrics["ndcg"] is not None
        assert metrics["coverage"] is not None
        assert deltas["precision"] is not None
        assert deltas["recall"] is not None
        assert deltas["ndcg"] is not None
        assert deltas["coverage"] is not None
    for recipe in snapshot.recipes:
        assert recipe.title not in raw_report
        assert str(recipe.id) not in raw_report
    for event in snapshot.events:
        assert str(event.id) not in raw_report
        assert str(event.user_id) not in raw_report


def test_cli_collaborative_report_is_reproducible_across_python_hash_seeds(
    tmp_path: Path,
) -> None:
    snapshot = simulate_preference_cohort(
        load_snapshot(_READINESS_CATALOG),
        CohortSimulationConfig(seed=20260822, profile_count=64),
    )
    snapshot_path = tmp_path / "ready.json"
    snapshot_path.write_text(snapshot_to_json(snapshot), encoding="utf-8")
    ml_root = Path(__file__).parents[1]
    source_paths = (ml_root / "src", ml_root.parent / "backend")

    def run_with_hash_seed(hash_seed: str) -> str:
        environment = os.environ.copy()
        python_path = [str(path) for path in source_paths]
        if existing := environment.get("PYTHONPATH"):
            python_path.append(existing)
        environment["PYTHONPATH"] = os.pathsep.join(python_path)
        environment["PYTHONHASHSEED"] = hash_seed
        completed = subprocess.run(
            [
                sys.executable,
                "-m",
                "recipe_lab_evaluation",
                "run",
                "--snapshot",
                str(snapshot_path),
                "--collaborative",
                "--k",
                "3",
                "--k",
                "1",
                "--seed",
                "20260822",
            ],
            check=True,
            capture_output=True,
            cwd=ml_root,
            env=environment,
            text=True,
        )
        return completed.stdout

    assert run_with_hash_seed("1") == run_with_hash_seed("987654")
