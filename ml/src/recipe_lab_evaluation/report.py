from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Literal

from .dataset import canonical_json
from .metrics import MetricsAtK
from .protocol import JsonScalar
from .split import EvaluationSplitCounts

REPORT_SCHEMA_VERSION = "recipe-lab-offline-evaluation-report-v2"
PROTOCOL_VERSION = "fixed-cutoff-full-catalog-v1"

REQUIRED_LIMITATIONS = (
    "The small or seeded dataset cannot support statistical significance or generalization claims.",
    (
        "The shared demo identity can combine multiple visitors and is not a coherent "
        "account-level profile."
    ),
    (
        "Unobserved recipe versions are not proven negatives, so full-catalog metrics "
        "contain exposure bias."
    ),
    (
        "No recommendation-impression or randomized-exposure log exists, so offline "
        "results are not causal."
    ),
)

type ReportStatus = Literal["complete", "insufficient_data"]


@dataclass(frozen=True, slots=True)
class MetricDeltasAtK:
    k: int
    precision: Decimal | None
    recall: Decimal | None
    ndcg: Decimal | None
    coverage: Decimal | None
    mean_recommended_popularity: Decimal | None
    mean_candidate_popularity: Decimal | None
    popularity_bias: Decimal | None
    absolute_popularity_bias_improvement: Decimal | None


@dataclass(frozen=True, slots=True)
class ModelEvaluationReport:
    model_id: str
    version: str
    parameters: Mapping[str, JsonScalar]
    parameter_sha256: str
    seed: int
    artifact: Mapping[str, JsonScalar] | None
    metrics: tuple[MetricsAtK, ...]
    deltas_vs_baseline: tuple[MetricDeltasAtK, ...]


@dataclass(frozen=True, slots=True)
class EvaluationReport:
    schema_version: str
    protocol_version: str
    run_id: str
    status: ReportStatus
    reason_codes: tuple[str, ...]
    dataset_id: str
    snapshot_sha256: str
    snapshot_recipe_count: int
    snapshot_event_count: int
    cutoff: datetime
    seed: int
    ks: tuple[int, ...]
    split_counts: EvaluationSplitCounts
    models: tuple[ModelEvaluationReport, ...]
    warnings: tuple[str, ...]
    limitations: tuple[str, ...]


def _timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _decimal(value: Decimal | None) -> str | None:
    return format(value, "f") if value is not None else None


def _metrics_document(metrics: MetricsAtK) -> dict[str, object]:
    return {
        "k": metrics.k,
        "support": {
            "evaluated_users": metrics.evaluated_users,
            "relevant_items": metrics.relevant_items,
        },
        "precision": _decimal(metrics.precision),
        "recall": _decimal(metrics.recall),
        "ndcg": _decimal(metrics.ndcg),
        "coverage": _decimal(metrics.coverage),
        "mean_recommended_popularity": _decimal(metrics.mean_recommended_popularity),
        "mean_candidate_popularity": _decimal(metrics.mean_candidate_popularity),
        "popularity_bias": _decimal(metrics.popularity_bias),
    }


def _deltas_document(deltas: MetricDeltasAtK) -> dict[str, object]:
    return {
        "k": deltas.k,
        "precision": _decimal(deltas.precision),
        "recall": _decimal(deltas.recall),
        "ndcg": _decimal(deltas.ndcg),
        "coverage": _decimal(deltas.coverage),
        "mean_recommended_popularity": _decimal(deltas.mean_recommended_popularity),
        "mean_candidate_popularity": _decimal(deltas.mean_candidate_popularity),
        "popularity_bias": _decimal(deltas.popularity_bias),
        "absolute_popularity_bias_improvement": _decimal(
            deltas.absolute_popularity_bias_improvement
        ),
    }


def report_to_document(report: EvaluationReport) -> dict[str, object]:
    return {
        "schema_version": report.schema_version,
        "protocol_version": report.protocol_version,
        "run_id": report.run_id,
        "status": report.status,
        "reason_codes": list(report.reason_codes),
        "snapshot": {
            "dataset_id": report.dataset_id,
            "sha256": report.snapshot_sha256,
            "cutoff": _timestamp(report.cutoff),
            "recipe_count": report.snapshot_recipe_count,
            "event_count": report.snapshot_event_count,
        },
        "configuration": {"seed": report.seed, "ks": list(report.ks)},
        "split_counts": {
            "available_recipes": report.split_counts.available_recipes,
            "training_events": report.split_counts.training_events,
            "holdout_events": report.split_counts.holdout_events,
            "raw_relevant_items": report.split_counts.raw_relevant_items,
            "eligible_relevant_items": report.split_counts.eligible_relevant_items,
            "eligible_users": report.split_counts.eligible_users,
            "filtered_already_interacted": (report.split_counts.filtered_already_interacted),
            "filtered_unavailable": report.split_counts.filtered_unavailable,
        },
        "models": [
            {
                "model_id": model.model_id,
                "version": model.version,
                "parameters": dict(sorted(model.parameters.items())),
                "parameter_sha256": model.parameter_sha256,
                "seed": model.seed,
                "artifact": (
                    dict(sorted(model.artifact.items())) if model.artifact is not None else None
                ),
                "metrics": [_metrics_document(metrics) for metrics in model.metrics],
                "deltas_vs_baseline": [
                    _deltas_document(deltas) for deltas in model.deltas_vs_baseline
                ],
            }
            for model in report.models
        ],
        "warnings": list(report.warnings),
        "limitations": list(report.limitations),
    }


def report_to_json(report: EvaluationReport) -> str:
    """Serialize a report without wall-clock or host-dependent fields."""

    return canonical_json(report_to_document(report)) + "\n"
