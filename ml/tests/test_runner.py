import json
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, replace
from decimal import Decimal
from typing import Any, Literal, cast
from uuid import UUID

import pytest

from recipe_lab_evaluation.dataset import EvaluationSnapshot, create_snapshot
from recipe_lab_evaluation.protocol import (
    EvaluationModel,
    FittedEvaluationModel,
    FittedRankingModel,
    JsonScalar,
    ModelMetadata,
    ModelTrainingData,
    derive_model_seed,
)
from recipe_lab_evaluation.report import report_to_document, report_to_json
from recipe_lab_evaluation.runner import EvaluationConfig, EvaluationError, evaluate
from recipe_lab_evaluation.split import split_snapshot

type InvalidRankingMode = Literal["duplicate", "long", "short", "unknown"]

UNKNOWN_RECIPE_ID = UUID("f10ed54a-0724-41d2-8f99-e3b46134a228")


def _required_metric(value: Decimal | None) -> Decimal:
    assert value is not None
    return value


@dataclass(frozen=True, slots=True)
class _PreferredFittedModel:
    metadata: ModelMetadata
    preferred_by_user: Mapping[UUID, tuple[UUID, ...]]

    def rank(
        self,
        *,
        user_id: UUID,
        candidate_ids: tuple[UUID, ...],
        limit: int,
    ) -> tuple[UUID, ...]:
        preferred = self.preferred_by_user.get(user_id, ())
        preferred_set = frozenset(preferred)
        ordered = tuple(item for item in preferred if item in candidate_ids) + tuple(
            item for item in candidate_ids if item not in preferred_set
        )
        return ordered[:limit]


@dataclass(frozen=True, slots=True)
class PreferredModel:
    metadata: ModelMetadata
    preferred_by_user: Mapping[UUID, tuple[UUID, ...]]

    def fit(self, training: ModelTrainingData, *, seed: int) -> FittedEvaluationModel:
        del training, seed
        return _PreferredFittedModel(self.metadata, self.preferred_by_user)


@dataclass(frozen=True, slots=True)
class _InvalidFittedModel:
    metadata: ModelMetadata
    mode: InvalidRankingMode

    def rank(
        self,
        *,
        user_id: UUID,
        candidate_ids: tuple[UUID, ...],
        limit: int,
    ) -> tuple[UUID, ...]:
        del user_id
        if self.mode == "short":
            return candidate_ids[: max(limit - 1, 0)]
        if self.mode == "long":
            return candidate_ids[: limit + 1]
        if self.mode == "unknown":
            return (UNKNOWN_RECIPE_ID, *candidate_ids[1:limit])
        return (candidate_ids[0],) * limit


@dataclass(frozen=True, slots=True)
class InvalidRankingModel:
    metadata: ModelMetadata
    mode: InvalidRankingMode

    def fit(self, training: ModelTrainingData, *, seed: int) -> FittedEvaluationModel:
        del training, seed
        return _InvalidFittedModel(self.metadata, self.mode)


@dataclass(frozen=True, slots=True)
class _MissingRankingContractModel:
    metadata: ModelMetadata

    def fit(self, training: ModelTrainingData, *, seed: int) -> object:
        del training, seed
        return object()


class SeedRecordingModel:
    def __init__(self, model_id: str = "seed-recorder") -> None:
        self.metadata = ModelMetadata(model_id=model_id, version="1")
        self.seen_seeds: list[int] = []

    def fit(self, training: ModelTrainingData, *, seed: int) -> FittedEvaluationModel:
        del training
        self.seen_seeds.append(seed)
        return _PreferredFittedModel(self.metadata, {})


@dataclass(frozen=True, slots=True)
class _UnreadableArtifactFitted:
    metadata: ModelMetadata

    @property
    def collaborative_artifact_document(self) -> Mapping[str, JsonScalar]:
        raise RuntimeError("private profile identifier must not escape")

    def rank(
        self,
        *,
        user_id: UUID,
        candidate_ids: tuple[UUID, ...],
        limit: int,
    ) -> tuple[UUID, ...]:
        del user_id
        return candidate_ids[:limit]


@dataclass(frozen=True, slots=True)
class _MalformedRankingFitted:
    metadata: ModelMetadata

    def rank(
        self,
        *,
        user_id: UUID,
        candidate_ids: tuple[UUID, ...],
        limit: int,
    ) -> tuple[UUID, ...]:
        del user_id, candidate_ids, limit
        return None  # type: ignore[return-value]


@dataclass(frozen=True, slots=True)
class _StaticFittedModel:
    metadata: ModelMetadata
    fitted: FittedEvaluationModel

    def fit(self, training: ModelTrainingData, *, seed: int) -> FittedEvaluationModel:
        del training, seed
        return self.fitted


class _StatefulParameters(Mapping[str, JsonScalar]):
    def __init__(self) -> None:
        self._iterations = 0

    def __getitem__(self, key: str) -> JsonScalar:
        if key != "safe":
            raise KeyError(key)
        return 1

    def __iter__(self) -> Iterator[str]:
        self._iterations += 1
        if self._iterations > 1:
            raise RuntimeError("private profile identifier must not escape")
        return iter(("safe",))

    def __len__(self) -> int:
        return 1


class _HostileUUID(UUID):
    def __hash__(self) -> int:
        raise RuntimeError("private profile identifier must not escape")


@dataclass(frozen=True, slots=True)
class _HostileUuidRankingFitted:
    metadata: ModelMetadata

    def rank(
        self,
        *,
        user_id: UUID,
        candidate_ids: tuple[UUID, ...],
        limit: int,
    ) -> tuple[UUID, ...]:
        del user_id
        hostile = _HostileUUID(str(candidate_ids[0]))
        return (hostile, *candidate_ids[1:limit])


def _oracle_model(snapshot: EvaluationSnapshot, model_id: str = "fixture-oracle") -> PreferredModel:
    split = split_snapshot(snapshot)
    return PreferredModel(
        metadata=ModelMetadata(model_id=model_id, version="1", parameters={"fixture": True}),
        preferred_by_user={
            case.user_id: tuple(sorted(case.relevant_ids, key=lambda value: value.int))
            for case in split.cases
        },
    )


def test_runner_always_includes_baseline_and_compares_every_model(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    report = evaluate(
        synthetic_snapshot,
        models=(_oracle_model(synthetic_snapshot),),
        config=EvaluationConfig(seed=20260821, ks=(1, 3)),
    )

    assert report.status == "complete"
    assert [model.model_id for model in report.models] == ["baseline-v1", "fixture-oracle"]
    baseline, oracle = report.models
    assert all(
        delta.precision == 0
        and delta.recall == 0
        and delta.ndcg == 0
        and delta.coverage == 0
        and delta.popularity_bias == 0
        for delta in baseline.deltas_vs_baseline
    )
    for metrics, baseline_metrics, deltas in zip(
        oracle.metrics, baseline.metrics, oracle.deltas_vs_baseline, strict=True
    ):
        assert deltas.k == metrics.k == baseline_metrics.k
        assert deltas.precision == _required_metric(metrics.precision) - _required_metric(
            baseline_metrics.precision
        )
        assert deltas.recall == _required_metric(metrics.recall) - _required_metric(
            baseline_metrics.recall
        )
        assert deltas.ndcg == _required_metric(metrics.ndcg) - _required_metric(
            baseline_metrics.ndcg
        )
        assert deltas.coverage == _required_metric(metrics.coverage) - _required_metric(
            baseline_metrics.coverage
        )
        assert deltas.popularity_bias == (
            _required_metric(metrics.popularity_bias)
            - _required_metric(baseline_metrics.popularity_bias)
        )


def test_runner_rejects_a_caller_supplied_or_duplicate_baseline(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    reserved = PreferredModel(ModelMetadata("baseline-v1", "test"), {})
    duplicate_a = PreferredModel(ModelMetadata("duplicate", "1"), {})
    duplicate_b = PreferredModel(ModelMetadata("duplicate", "2"), {})

    with pytest.raises(EvaluationError, match="reserved"):
        evaluate(synthetic_snapshot, models=(reserved,))
    with pytest.raises(EvaluationError, match="unique"):
        evaluate(synthetic_snapshot, models=(duplicate_a, duplicate_b))


@pytest.mark.parametrize(
    ("mode", "message"),
    [
        ("duplicate", "duplicate recipe IDs"),
        ("long", "expected exactly"),
        ("short", "expected exactly"),
        ("unknown", "out-of-candidate"),
    ],
)
def test_runner_rejects_invalid_model_rankings(
    synthetic_snapshot: EvaluationSnapshot,
    mode: InvalidRankingMode,
    message: str,
) -> None:
    model: EvaluationModel = InvalidRankingModel(
        ModelMetadata(model_id=f"invalid-{mode}", version="1"),
        mode,
    )

    with pytest.raises(EvaluationError, match=message):
        evaluate(
            synthetic_snapshot,
            models=(model,),
            config=EvaluationConfig(ks=(2,)),
        )


def test_runner_requires_the_explicit_fitted_ranking_contract(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    split = split_snapshot(synthetic_snapshot)
    training = ModelTrainingData(
        cutoff=split.cutoff,
        recipes=split.recipes,
        events=split.training_events,
    )
    fitted = PreferredModel(ModelMetadata("contract-model", "1"), {}).fit(
        training,
        seed=1,
    )
    assert isinstance(fitted, FittedRankingModel)

    invalid_model = cast(
        EvaluationModel,
        _MissingRankingContractModel(ModelMetadata("missing-contract", "1")),
    )
    with pytest.raises(
        EvaluationError,
        match="^model 'missing-contract' did not return a fitted ranking model$",
    ):
        evaluate(synthetic_snapshot, models=(invalid_model,), config=EvaluationConfig(ks=(2,)))


@pytest.mark.parametrize("failure", ["artifact", "ranking"])
def test_runner_redacts_malformed_model_protocol_failures(
    synthetic_snapshot: EvaluationSnapshot,
    failure: str,
) -> None:
    metadata = ModelMetadata(model_id=f"malformed-{failure}", version="1")
    fitted: FittedEvaluationModel
    if failure == "artifact":
        fitted = _UnreadableArtifactFitted(metadata)
    else:
        fitted = _MalformedRankingFitted(metadata)

    with pytest.raises(EvaluationError) as raised:
        evaluate(
            synthetic_snapshot,
            models=(_StaticFittedModel(metadata, fitted),),
            config=EvaluationConfig(ks=(2,)),
        )

    assert "private profile identifier" not in str(raised.value)
    assert "invalid artifact metadata" in str(raised.value) or "failed to return" in str(
        raised.value
    )


def test_runner_redacts_unreadable_model_metadata(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    class _UnreadableMetadataModel:
        @property
        def metadata(self) -> ModelMetadata:
            raise RuntimeError("private profile identifier must not escape")

        def fit(self, training: ModelTrainingData, *, seed: int) -> FittedEvaluationModel:
            del training, seed
            raise AssertionError("unreadable metadata must stop before fit")

    with pytest.raises(EvaluationError) as raised:
        evaluate(
            synthetic_snapshot,
            models=(_UnreadableMetadataModel(),),
            config=EvaluationConfig(ks=(2,)),
        )

    assert str(raised.value) == "model metadata could not be read"


def test_runner_uses_a_plain_cached_metadata_copy(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    metadata = ModelMetadata(
        model_id="stateful-metadata",
        version="1",
        parameters=_StatefulParameters(),
    )

    with pytest.raises(EvaluationError) as raised:
        evaluate(
            synthetic_snapshot,
            models=(PreferredModel(metadata, {}),),
            config=EvaluationConfig(ks=(2,)),
        )

    assert "private profile identifier" not in str(raised.value)
    assert "invalid fitted metadata" in str(raised.value)


def test_runner_rejects_uuid_subclasses_before_hashing(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    metadata = ModelMetadata(model_id="hostile-uuid", version="1")

    with pytest.raises(EvaluationError) as raised:
        evaluate(
            synthetic_snapshot,
            models=(_StaticFittedModel(metadata, _HostileUuidRankingFitted(metadata)),),
            config=EvaluationConfig(ks=(2,)),
        )

    assert "private profile identifier" not in str(raised.value)
    assert "non-UUID recipe ID" in str(raised.value)


def test_insufficient_data_is_a_valid_report_with_null_metrics(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    split = split_snapshot(synthetic_snapshot)
    training_only = create_snapshot(
        dataset_id="recipe-lab-empty-holdout-v1",
        cutoff=synthetic_snapshot.cutoff,
        limitations=synthetic_snapshot.limitations,
        recipes=synthetic_snapshot.recipes,
        events=split.training_events,
    )

    report = evaluate(training_only, config=EvaluationConfig(ks=(5,)))
    document = cast(dict[str, Any], report_to_document(report))

    assert report.status == "insufficient_data"
    assert report.reason_codes == ("no_relevant_holdout_events",)
    assert len(report.models) == 1
    assert report.models[0].metrics[0].precision is None
    assert report.models[0].metrics[0].recall is None
    assert report.models[0].metrics[0].ndcg is None
    assert report.models[0].metrics[0].coverage is None
    models = cast(list[dict[str, Any]], document["models"])
    serialized_metrics = cast(list[dict[str, Any]], models[0]["metrics"])[0]
    assert serialized_metrics["precision"] is None
    assert serialized_metrics["popularity_bias"] is None


def test_seed_is_derived_per_model_and_same_run_is_byte_reproducible(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    first_model = SeedRecordingModel()
    second_model = SeedRecordingModel()
    config = EvaluationConfig(seed=918273, ks=(1, 3))

    first = report_to_json(evaluate(synthetic_snapshot, models=(first_model,), config=config))
    second = report_to_json(evaluate(synthetic_snapshot, models=(second_model,), config=config))

    assert first == second
    assert first_model.seen_seeds == [derive_model_seed(config.seed, "seed-recorder")]
    assert second_model.seen_seeds == first_model.seen_seeds


def test_each_model_receives_an_isolated_order_independent_seed(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    first_model = SeedRecordingModel("seed-a")
    second_model = SeedRecordingModel("seed-b")
    config = EvaluationConfig(seed=7123, ks=(1,))

    evaluate(
        synthetic_snapshot,
        models=(second_model, first_model),
        config=config,
    )

    assert first_model.seen_seeds == [derive_model_seed(config.seed, "seed-a")]
    assert second_model.seen_seeds == [derive_model_seed(config.seed, "seed-b")]
    assert first_model.seen_seeds != second_model.seen_seeds


def test_model_and_snapshot_input_order_do_not_change_report_bytes(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    first_model = _oracle_model(synthetic_snapshot, "z-model")
    second_model = _oracle_model(synthetic_snapshot, "a-model")
    reordered_snapshot = create_snapshot(
        dataset_id=synthetic_snapshot.dataset_id,
        cutoff=synthetic_snapshot.cutoff,
        limitations=tuple(reversed(synthetic_snapshot.limitations)),
        recipes=tuple(reversed(synthetic_snapshot.recipes)),
        events=tuple(reversed(synthetic_snapshot.events)),
    )
    config = EvaluationConfig(seed=1234, ks=(2,))

    original = report_to_json(
        evaluate(
            synthetic_snapshot,
            models=(first_model, second_model),
            config=config,
        )
    )
    reordered = report_to_json(
        evaluate(
            reordered_snapshot,
            models=(second_model, first_model),
            config=config,
        )
    )

    assert reordered == original


def test_runner_recomputes_the_fingerprint_of_an_in_memory_snapshot(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    modified = replace(synthetic_snapshot, dataset_id="modified-in-memory-snapshot")

    report = evaluate(modified, config=EvaluationConfig(ks=(2,)))

    assert report.dataset_id == "modified-in-memory-snapshot"
    assert report.snapshot_sha256 != synthetic_snapshot.sha256


def test_serialized_report_is_canonical_aggregate_only_and_carries_limitations(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    serialized = report_to_json(
        evaluate(synthetic_snapshot, config=EvaluationConfig(seed=55, ks=(2,)))
    )
    document = json.loads(serialized)

    assert serialized.endswith("\n")
    assert (
        serialized
        == json.dumps(
            document,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        + "\n"
    )
    assert set(synthetic_snapshot.limitations) <= set(document["limitations"])
    assert len(document["limitations"]) > len(synthetic_snapshot.limitations)
    assert document["snapshot"]["recipe_count"] == len(synthetic_snapshot.recipes)
    assert document["snapshot"]["event_count"] == len(synthetic_snapshot.events)
    for event in synthetic_snapshot.events:
        assert str(event.id) not in serialized
        assert str(event.user_id) not in serialized
    for recipe in synthetic_snapshot.recipes:
        assert str(recipe.id) not in serialized
    for forbidden_field in (
        "user_id",
        "event_id",
        "recipe_version_id",
        "email",
        "request_fingerprint",
    ):
        assert f'"{forbidden_field}"' not in serialized
