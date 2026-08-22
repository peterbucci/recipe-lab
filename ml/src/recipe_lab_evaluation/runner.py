from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

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
)
from .protocol import (
    EvaluationModel,
    FittedCollaborativeArtifactProvider,
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
    for model in supplied:
        _validate_metadata(model.metadata)
        if model.metadata.model_id == BASELINE_MODEL_ID:
            raise EvaluationError("baseline-v1 is reserved and is included automatically")
    all_models: tuple[EvaluationModel, ...] = (BaselineV1Model(), *supplied)
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
    fitted = model.fit(
        ModelTrainingData(
            cutoff=split.cutoff,
            recipes=split.recipes,
            events=split.training_events,
        ),
        seed=model_seed,
    )
    if fitted.metadata != model.metadata:
        raise EvaluationError(f"model {model.metadata.model_id!r} changed metadata during fit")
    artifact: dict[str, JsonScalar] | None = None
    if isinstance(fitted, FittedCollaborativeArtifactProvider):
        raw_artifact = fitted.collaborative_artifact_document
        if not isinstance(raw_artifact, Mapping) or any(
            not isinstance(key, str) for key in raw_artifact
        ):
            raise EvaluationError(
                f"model {model.metadata.model_id!r} produced invalid artifact metadata"
            )
        artifact = dict(sorted(raw_artifact.items()))
        if any(
            value is not None and not isinstance(value, str | int | float | bool)
            for value in artifact.values()
        ):
            raise EvaluationError(
                f"model {model.metadata.model_id!r} produced invalid artifact metadata"
            )
        try:
            canonical_json(artifact)
        except (TypeError, ValueError) as error:
            raise EvaluationError(
                f"model {model.metadata.model_id!r} produced invalid artifact metadata"
            ) from error
        _validate_artifact(
            artifact,
            metadata=model.metadata,
            model_seed=model_seed,
            expected_training_cutoff=split.cutoff,
        )
    rankings: dict[UUID, tuple[UUID, ...]] = {}
    maximum_k = max(config.ks)
    for case in split.cases:
        required = min(maximum_k, len(case.candidate_ids))
        returned = tuple(
            fitted.rank(
                user_id=case.user_id,
                candidate_ids=case.candidate_ids,
                limit=required,
            )
        )
        if len(returned) != required:
            raise EvaluationError(
                f"model {model.metadata.model_id!r} returned {len(returned)} items "
                f"for user {case.user_id}, expected exactly {required}"
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
    if any(model.metadata.model_id == COLLABORATIVE_MODEL_ID for model in evaluation_models):
        readiness = assess_readiness(normalized_snapshot)
        if readiness.status != "ready":
            reasons = ", ".join(readiness.reason_codes)
            raise EvaluationError(f"collaborative readiness failed: {reasons}")
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
    limitations = tuple(sorted(set((*normalized_snapshot.limitations, *REQUIRED_LIMITATIONS))))
    return EvaluationReport(
        schema_version=REPORT_SCHEMA_VERSION,
        protocol_version=PROTOCOL_VERSION,
        run_id=_run_id(normalized_snapshot, resolved_config, evaluation_models),
        status="insufficient_data" if reason_codes else "complete",
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
        warnings=_warnings(split),
        limitations=limitations,
    )
