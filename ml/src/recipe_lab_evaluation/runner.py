from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from .adoption import (
    DEFAULT_HYBRID_ADOPTION_POLICY,
    HYBRID_ADOPTION_POLICY_VERSION,
    HYBRID_CANDIDATE_MODEL_ID,
    decide_hybrid_adoption,
)
from .dataset import (
    EvaluationSnapshot,
    canonical_json,
    parse_snapshot_json,
    snapshot_to_json,
)
from .metrics import MetricsAtK, calculate_metrics, quantize_metric
from .models.baseline_v1 import BaselineV1Model
from .models.collaborative_v1 import (
    COLLABORATIVE_ARTIFACT_SCHEMA_VERSION,
    COLLABORATIVE_ARTIFACT_VERSION,
    COLLABORATIVE_MODEL_ID,
    CollaborativeV1Model,
)
from .models.content_based_v1 import CONTENT_MODEL_ID, ContentBasedV1Model
from .models.hybrid_v1 import HYBRID_MODEL_ID, HybridV1Model
from .protocol import (
    EvaluationModel,
    FittedCollaborativeArtifactProvider,
    FittedRankingModel,
    JsonScalar,
    ModelMetadata,
    ModelTrainingData,
    derive_model_seed,
)
from .readiness import assess_readiness
from .report import (
    PROTOCOL_VERSION,
    REPORT_SCHEMA_VERSION,
    REQUIRED_LIMITATIONS,
    EvaluationReport,
    MetricDeltasAtK,
    ModelEvaluationReport,
    ReportStatus,
)
from .split import EvaluationSplit, split_snapshot

DEFAULT_SEED = 20_260_821
DEFAULT_KS = (5, 10)
BASELINE_MODEL_ID = "baseline-v1"

_ARTIFACT_KEYS = frozenset(
    {
        "artifact_schema_version",
        "artifact_version",
        "model_id",
        "model_version",
        "training_cutoff",
        "derived_seed",
        "training_data_sha256",
        "recipe_count",
        "event_count",
        "profile_count",
        "observed_event_pair_count",
        "nonzero_signal_pair_count",
        "supported_profile_count",
        "supported_item_count",
    }
)
_ARTIFACT_COUNT_KEYS = (
    "recipe_count",
    "event_count",
    "profile_count",
    "observed_event_pair_count",
    "nonzero_signal_pair_count",
    "supported_profile_count",
    "supported_item_count",
)
_ARTIFACT_VERSION_PATTERN = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}")
_SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")


class EvaluationError(ValueError):
    """Raised when a model or evaluation configuration violates the protocol."""


@dataclass(frozen=True, slots=True)
class _ValidatedEvaluationModel:
    metadata: ModelMetadata
    delegate: EvaluationModel

    def fit(self, training: ModelTrainingData, *, seed: int) -> FittedRankingModel:
        return self.delegate.fit(training, seed=seed)


@dataclass(frozen=True, slots=True)
class EvaluationConfig:
    seed: int = DEFAULT_SEED
    ks: tuple[int, ...] = DEFAULT_KS

    def __post_init__(self) -> None:
        if isinstance(self.seed, bool) or not isinstance(self.seed, int) or self.seed < 0:
            raise ValueError("seed must be a non-negative integer")
        if not self.ks:
            raise ValueError("ks must contain at least one cutoff")
        if any(isinstance(k, bool) or not isinstance(k, int) or not 1 <= k <= 50 for k in self.ks):
            raise ValueError("every k must be an integer between 1 and 50")
        if tuple(sorted(set(self.ks))) != self.ks:
            raise ValueError("ks must be strictly increasing and contain no duplicates")


def _parameter_document(metadata: ModelMetadata) -> dict[str, object]:
    return {
        "model_id": metadata.model_id,
        "version": metadata.version,
        "parameters": dict(sorted(metadata.parameters.items())),
    }


def _parameter_hash(metadata: ModelMetadata) -> str:
    parameters = dict(sorted(metadata.parameters.items()))
    return hashlib.sha256(canonical_json(parameters).encode("utf-8")).hexdigest()


def _validate_metadata(metadata: ModelMetadata) -> None:
    try:
        canonical_json(_parameter_document(metadata))
    except (TypeError, ValueError) as error:
        raise EvaluationError(f"model {metadata.model_id!r} has non-JSON parameters") from error


def _normalize_metadata(metadata: ModelMetadata) -> ModelMetadata:
    if type(metadata.model_id) is not str or type(metadata.version) is not str:
        raise TypeError("model identity fields must be plain strings")
    parameters = dict(metadata.parameters.items())
    if any(type(key) is not str for key in parameters) or any(
        value is not None and type(value) not in (str, int, float, bool)
        for value in parameters.values()
    ):
        raise TypeError("model parameters must contain plain JSON scalar values")
    normalized = ModelMetadata(
        model_id=metadata.model_id,
        version=metadata.version,
        parameters=parameters,
    )
    _validate_metadata(normalized)
    return normalized


def _validate_artifact(
    artifact: dict[str, JsonScalar],
    *,
    metadata: ModelMetadata,
    model_seed: int,
    expected_training_cutoff: datetime,
) -> None:
    if frozenset(artifact) != _ARTIFACT_KEYS:
        raise EvaluationError(f"model {metadata.model_id!r} produced invalid artifact metadata")
    if artifact["model_id"] != metadata.model_id:
        raise EvaluationError(f"model {metadata.model_id!r} artifact has a mismatched model_id")
    if artifact["model_version"] != metadata.version:
        raise EvaluationError(
            f"model {metadata.model_id!r} artifact has a mismatched model_version"
        )
    if type(artifact["derived_seed"]) is not int or artifact["derived_seed"] != model_seed:
        raise EvaluationError(f"model {metadata.model_id!r} artifact has a mismatched seed")

    schema_version = artifact["artifact_schema_version"]
    artifact_version = artifact["artifact_version"]
    if (
        schema_version != COLLABORATIVE_ARTIFACT_SCHEMA_VERSION
        or artifact_version != COLLABORATIVE_ARTIFACT_VERSION
        or not isinstance(schema_version, str)
        or _ARTIFACT_VERSION_PATTERN.fullmatch(schema_version) is None
        or not isinstance(artifact_version, str)
        or _ARTIFACT_VERSION_PATTERN.fullmatch(artifact_version) is None
    ):
        raise EvaluationError(f"model {metadata.model_id!r} produced invalid artifact metadata")

    artifact_training_cutoff = artifact["training_cutoff"]
    if not isinstance(artifact_training_cutoff, str):
        raise EvaluationError(f"model {metadata.model_id!r} produced invalid artifact metadata")
    try:
        parsed_cutoff = datetime.fromisoformat(artifact_training_cutoff.replace("Z", "+00:00"))
    except ValueError as error:
        raise EvaluationError(
            f"model {metadata.model_id!r} produced invalid artifact metadata"
        ) from error
    if parsed_cutoff.tzinfo is None or parsed_cutoff.utcoffset() != timedelta(0):
        raise EvaluationError(f"model {metadata.model_id!r} produced invalid artifact metadata")
    canonical_cutoff = parsed_cutoff.astimezone(UTC).isoformat().replace("+00:00", "Z")
    expected_cutoff = expected_training_cutoff.astimezone(UTC).isoformat().replace("+00:00", "Z")
    if artifact_training_cutoff != canonical_cutoff or canonical_cutoff != expected_cutoff:
        raise EvaluationError(f"model {metadata.model_id!r} produced invalid artifact metadata")

    training_sha256 = artifact["training_data_sha256"]
    if not isinstance(training_sha256, str) or _SHA256_PATTERN.fullmatch(training_sha256) is None:
        raise EvaluationError(f"model {metadata.model_id!r} produced invalid artifact metadata")
    counts: dict[str, int] = {}
    for key in _ARTIFACT_COUNT_KEYS:
        value = artifact[key]
        if type(value) is not int or value < 0:
            raise EvaluationError(f"model {metadata.model_id!r} produced invalid artifact metadata")
        counts[key] = value

    recipe_count = counts["recipe_count"]
    event_count = counts["event_count"]
    profile_count = counts["profile_count"]
    if (
        counts["supported_profile_count"] > profile_count
        or counts["supported_item_count"] > recipe_count
        or counts["observed_event_pair_count"] > event_count
        or counts["nonzero_signal_pair_count"] > profile_count * recipe_count
    ):
        raise EvaluationError(f"model {metadata.model_id!r} produced invalid artifact metadata")


def _models_with_baseline(models: Iterable[EvaluationModel]) -> tuple[EvaluationModel, ...]:
    supplied = tuple(models)
    validated: list[EvaluationModel] = []
    for model in supplied:
        try:
            raw_metadata = model.metadata
            if not isinstance(raw_metadata, ModelMetadata):
                raise TypeError("metadata must be ModelMetadata")
            metadata = _normalize_metadata(raw_metadata)
        except Exception as error:
            raise EvaluationError("model metadata could not be read") from error
        if metadata.model_id == BASELINE_MODEL_ID:
            raise EvaluationError("baseline-v1 is reserved and is included automatically")
        expected: tuple[type[object], ModelMetadata] | None = None
        if metadata.model_id == CONTENT_MODEL_ID:
            expected = (ContentBasedV1Model, ContentBasedV1Model.metadata)
        elif metadata.model_id == COLLABORATIVE_MODEL_ID:
            expected = (CollaborativeV1Model, CollaborativeV1Model.metadata)
        elif metadata.model_id == HYBRID_MODEL_ID:
            expected = (HybridV1Model, HybridV1Model.metadata)
        if expected is not None and (model.__class__ is not expected[0] or metadata != expected[1]):
            raise EvaluationError(f"{metadata.model_id} is reserved for its built-in adapter")
        validated.append(_ValidatedEvaluationModel(metadata=metadata, delegate=model))
    all_models: tuple[EvaluationModel, ...] = (BaselineV1Model(), *validated)
    ids = [model.metadata.model_id for model in all_models]
    if len(ids) != len(set(ids)):
        raise EvaluationError("model_id values must be unique")
    return tuple(sorted(all_models, key=lambda model: model.metadata.model_id))


def _rank_model(
    model: EvaluationModel,
    *,
    split: EvaluationSplit,
    config: EvaluationConfig,
) -> tuple[dict[UUID, tuple[UUID, ...]], int, dict[str, JsonScalar] | None]:
    model_seed = derive_model_seed(config.seed, model.metadata.model_id)
    try:
        fitted = model.fit(
            ModelTrainingData(
                cutoff=split.cutoff,
                recipes=split.recipes,
                events=split.training_events,
            ),
            seed=model_seed,
        )
    except Exception as error:
        raise EvaluationError(f"model {model.metadata.model_id!r} failed during fit") from error
    if not isinstance(fitted, FittedRankingModel):
        raise EvaluationError(
            f"model {model.metadata.model_id!r} did not return a fitted ranking model"
        )
    try:
        raw_fitted_metadata = fitted.metadata
        if not isinstance(raw_fitted_metadata, ModelMetadata):
            raise TypeError("fitted metadata must be ModelMetadata")
        fitted_metadata = _normalize_metadata(raw_fitted_metadata)
        metadata_changed = fitted_metadata != model.metadata
    except Exception as error:
        raise EvaluationError(
            f"model {model.metadata.model_id!r} produced invalid fitted metadata"
        ) from error
    if metadata_changed:
        raise EvaluationError(f"model {model.metadata.model_id!r} changed metadata during fit")
    artifact: dict[str, JsonScalar] | None = None
    if isinstance(fitted, FittedCollaborativeArtifactProvider):
        try:
            raw_artifact = fitted.collaborative_artifact_document
            if not isinstance(raw_artifact, Mapping) or any(
                type(key) is not str for key in raw_artifact
            ):
                raise TypeError("artifact must be a plain scalar mapping")
            artifact = dict(sorted(raw_artifact.items()))
            if any(type(key) is not str for key in artifact) or any(
                value is not None and type(value) not in (str, int, float, bool)
                for value in artifact.values()
            ):
                raise TypeError("artifact must contain plain JSON scalar values")
            canonical_json(artifact)
        except Exception as error:
            raise EvaluationError(
                f"model {model.metadata.model_id!r} produced invalid artifact metadata"
            ) from error
        try:
            _validate_artifact(
                artifact,
                metadata=model.metadata,
                model_seed=model_seed,
                expected_training_cutoff=split.cutoff,
            )
        except EvaluationError:
            raise
        except Exception as error:
            raise EvaluationError(
                f"model {model.metadata.model_id!r} produced invalid artifact metadata"
            ) from error
    rankings: dict[UUID, tuple[UUID, ...]] = {}
    maximum_k = max(config.ks)
    for case in split.cases:
        required = min(maximum_k, len(case.candidate_ids))
        try:
            returned = tuple(
                fitted.rank(
                    user_id=case.user_id,
                    candidate_ids=case.candidate_ids,
                    limit=required,
                )
            )
        except Exception as error:
            raise EvaluationError(
                f"model {model.metadata.model_id!r} failed to return a ranking"
            ) from error
        if any(type(recipe_id) is not UUID for recipe_id in returned):
            raise EvaluationError(
                f"model {model.metadata.model_id!r} returned a non-UUID recipe ID"
            )
        if len(returned) != required:
            raise EvaluationError(
                f"model {model.metadata.model_id!r} returned {len(returned)} items "
                f"for an evaluation case, expected exactly {required}"
            )
        if len(returned) != len(set(returned)):
            raise EvaluationError(
                f"model {model.metadata.model_id!r} returned duplicate recipe IDs"
            )
        unknown = set(returned) - set(case.candidate_ids)
        if unknown:
            raise EvaluationError(
                f"model {model.metadata.model_id!r} returned out-of-candidate recipe IDs"
            )
        rankings[case.user_id] = returned[:required]
    return rankings, model_seed, artifact


def _difference(value: Decimal | None, baseline: Decimal | None) -> Decimal | None:
    if value is None or baseline is None:
        return None
    return quantize_metric(value - baseline)


def _absolute_bias_improvement(
    value: Decimal | None,
    baseline: Decimal | None,
) -> Decimal | None:
    if value is None or baseline is None:
        return None
    return quantize_metric(abs(baseline) - abs(value))


def _metric_deltas(
    metrics: tuple[MetricsAtK, ...],
    baseline: tuple[MetricsAtK, ...],
) -> tuple[MetricDeltasAtK, ...]:
    baseline_by_k = {item.k: item for item in baseline}
    return tuple(
        MetricDeltasAtK(
            k=item.k,
            precision=_difference(item.precision, baseline_by_k[item.k].precision),
            recall=_difference(item.recall, baseline_by_k[item.k].recall),
            ndcg=_difference(item.ndcg, baseline_by_k[item.k].ndcg),
            coverage=_difference(item.coverage, baseline_by_k[item.k].coverage),
            mean_recommended_popularity=_difference(
                item.mean_recommended_popularity,
                baseline_by_k[item.k].mean_recommended_popularity,
            ),
            mean_candidate_popularity=_difference(
                item.mean_candidate_popularity,
                baseline_by_k[item.k].mean_candidate_popularity,
            ),
            popularity_bias=_difference(
                item.popularity_bias, baseline_by_k[item.k].popularity_bias
            ),
            absolute_popularity_bias_improvement=_absolute_bias_improvement(
                item.popularity_bias, baseline_by_k[item.k].popularity_bias
            ),
        )
        for item in metrics
    )


def _reason_codes(split: EvaluationSplit) -> tuple[str, ...]:
    reasons: list[str] = []
    if split.counts.available_recipes == 0:
        reasons.append("no_recipes_available_at_cutoff")
    if split.counts.raw_relevant_items == 0:
        reasons.append("no_relevant_holdout_events")
    elif split.counts.eligible_relevant_items == 0:
        reasons.append("no_eligible_holdout_labels")
    if split.counts.eligible_users == 0 and not reasons:
        reasons.append("no_evaluable_users")
    return tuple(reasons)


def _warnings(split: EvaluationSplit) -> tuple[str, ...]:
    warnings: list[str] = []
    if 0 < split.counts.eligible_users < 20:
        warnings.append("Metrics are based on fewer than 20 eligible profiles.")
    if split.counts.filtered_already_interacted:
        warnings.append("Some holdout labels were removed after prior interactions.")
    if split.counts.filtered_unavailable:
        warnings.append("Some holdout labels were unavailable at the cutoff.")
    if split.counts.training_events == 0:
        warnings.append("The training prefix contains no preference events.")
    return tuple(warnings)


def _run_id(
    snapshot: EvaluationSnapshot,
    config: EvaluationConfig,
    models: Sequence[EvaluationModel],
) -> str:
    document = {
        "protocol_version": PROTOCOL_VERSION,
        "snapshot_sha256": snapshot.sha256,
        "cutoff": snapshot.cutoff.isoformat(),
        "seed": config.seed,
        "ks": list(config.ks),
        "models": [_parameter_document(model.metadata) for model in models],
        "hybrid_adoption_policy": (
            {
                "policy_version": HYBRID_ADOPTION_POLICY_VERSION,
                "minimum_evaluated_users": (DEFAULT_HYBRID_ADOPTION_POLICY.minimum_evaluated_users),
                "minimum_primary_ndcg_lift": str(
                    DEFAULT_HYBRID_ADOPTION_POLICY.minimum_primary_ndcg_lift
                ),
                "maximum_ndcg_regression": str(
                    DEFAULT_HYBRID_ADOPTION_POLICY.maximum_ndcg_regression
                ),
                "maximum_recall_regression": str(
                    DEFAULT_HYBRID_ADOPTION_POLICY.maximum_recall_regression
                ),
                "maximum_coverage_regression": str(
                    DEFAULT_HYBRID_ADOPTION_POLICY.maximum_coverage_regression
                ),
            }
            if any(model.metadata.model_id == HYBRID_CANDIDATE_MODEL_ID for model in models)
            else None
        ),
    }
    return hashlib.sha256(canonical_json(document).encode("utf-8")).hexdigest()


def evaluate(
    snapshot: EvaluationSnapshot,
    models: Iterable[EvaluationModel] = (),
    config: EvaluationConfig | None = None,
) -> EvaluationReport:
    """Evaluate every supplied approach and the mandatory production baseline."""

    resolved_config = config or EvaluationConfig()
    normalized_snapshot = parse_snapshot_json(snapshot_to_json(snapshot))
    split = split_snapshot(normalized_snapshot)
    evaluation_models = _models_with_baseline(models)
    evaluation_model_ids = {model.metadata.model_id for model in evaluation_models}
    if evaluation_model_ids & {COLLABORATIVE_MODEL_ID, HYBRID_CANDIDATE_MODEL_ID}:
        readiness = assess_readiness(normalized_snapshot)
        if readiness.status != "ready":
            reasons = ", ".join(readiness.reason_codes)
            raise EvaluationError(f"collaborative readiness failed: {reasons}")
    if HYBRID_CANDIDATE_MODEL_ID in evaluation_model_ids and not {
        CONTENT_MODEL_ID,
        COLLABORATIVE_MODEL_ID,
    }.issubset(evaluation_model_ids):
        raise EvaluationError(
            "hybrid-v1 requires content-v1 and collaborative-v1 in the same evaluation"
        )
    metrics_by_model: dict[str, tuple[MetricsAtK, ...]] = {}
    seeds_by_model: dict[str, int] = {}
    artifacts_by_model: dict[str, dict[str, JsonScalar] | None] = {}
    for model in evaluation_models:
        rankings, model_seed, artifact = _rank_model(
            model,
            split=split,
            config=resolved_config,
        )
        seeds_by_model[model.metadata.model_id] = model_seed
        artifacts_by_model[model.metadata.model_id] = artifact
        metrics_by_model[model.metadata.model_id] = tuple(
            calculate_metrics(
                k=k,
                cases=split.cases,
                rankings=rankings,
                training_events=split.training_events,
            )
            for k in resolved_config.ks
        )

    baseline_metrics = metrics_by_model[BASELINE_MODEL_ID]
    model_reports = tuple(
        ModelEvaluationReport(
            model_id=model.metadata.model_id,
            version=model.metadata.version,
            parameters=dict(sorted(model.metadata.parameters.items())),
            parameter_sha256=_parameter_hash(model.metadata),
            seed=seeds_by_model[model.metadata.model_id],
            artifact=artifacts_by_model[model.metadata.model_id],
            metrics=metrics_by_model[model.metadata.model_id],
            deltas_vs_baseline=_metric_deltas(
                metrics_by_model[model.metadata.model_id], baseline_metrics
            ),
        )
        for model in evaluation_models
    )
    reason_codes = _reason_codes(split)
    report_status: ReportStatus = "insufficient_data" if reason_codes else "complete"
    limitations = tuple(sorted(set((*normalized_snapshot.limitations, *REQUIRED_LIMITATIONS))))
    hybrid_adoption = (
        decide_hybrid_adoption(
            report_status=report_status,
            metrics_by_model=metrics_by_model,
            snapshot_limitations=normalized_snapshot.limitations,
        )
        if HYBRID_CANDIDATE_MODEL_ID in evaluation_model_ids
        else None
    )
    return EvaluationReport(
        schema_version=REPORT_SCHEMA_VERSION,
        protocol_version=PROTOCOL_VERSION,
        run_id=_run_id(normalized_snapshot, resolved_config, evaluation_models),
        status=report_status,
        reason_codes=reason_codes,
        dataset_id=normalized_snapshot.dataset_id,
        snapshot_sha256=normalized_snapshot.sha256,
        snapshot_recipe_count=len(normalized_snapshot.recipes),
        snapshot_event_count=len(normalized_snapshot.events),
        cutoff=normalized_snapshot.cutoff,
        seed=resolved_config.seed,
        ks=resolved_config.ks,
        split_counts=split.counts,
        models=model_reports,
        hybrid_adoption=hybrid_adoption,
        warnings=_warnings(split),
        limitations=limitations,
    )
