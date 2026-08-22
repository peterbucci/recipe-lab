from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

from .metrics import MetricsAtK, quantize_metric
from .simulator import SIMULATION_ASSUMPTIONS

HYBRID_ADOPTION_POLICY_VERSION = "hybrid-adoption-policy-v1"
HYBRID_CANDIDATE_MODEL_ID = "hybrid-v1"
SIMPLER_MODEL_IDS = ("baseline-v1", "content-v1", "collaborative-v1")

type HybridAdoptionStatus = Literal["adopt_hybrid", "retain_simpler"]


@dataclass(frozen=True, slots=True)
class HybridAdoptionPolicy:
    """Deterministic evidence threshold for an offline hybrid adoption decision."""

    minimum_evaluated_users: int = 40
    minimum_primary_ndcg_lift: Decimal = Decimal("0.010000")
    maximum_ndcg_regression: Decimal = Decimal("0.000000")
    maximum_recall_regression: Decimal = Decimal("0.000000")
    maximum_coverage_regression: Decimal = Decimal("0.050000")

    def __post_init__(self) -> None:
        if self.minimum_evaluated_users < 1:
            raise ValueError("minimum_evaluated_users must be positive")
        for name in (
            "minimum_primary_ndcg_lift",
            "maximum_ndcg_regression",
            "maximum_recall_regression",
            "maximum_coverage_regression",
        ):
            value = getattr(self, name)
            if value < 0:
                raise ValueError(f"{name} must not be negative")


DEFAULT_HYBRID_ADOPTION_POLICY = HybridAdoptionPolicy()


@dataclass(frozen=True, slots=True)
class HybridAdoptionComparisonAtK:
    k: int
    reference_model_id: str | None
    evaluated_users: int
    ndcg_delta: Decimal | None
    recall_delta: Decimal | None
    coverage_delta: Decimal | None


@dataclass(frozen=True, slots=True)
class HybridAdoptionDecision:
    policy_version: str
    status: HybridAdoptionStatus
    candidate_model_id: str
    primary_k: int | None
    reference_model_id: str | None
    evaluated_users: int
    primary_ndcg_lift: Decimal | None
    worst_ndcg_delta: Decimal | None
    worst_recall_delta: Decimal | None
    worst_coverage_delta: Decimal | None
    reason_codes: tuple[str, ...]
    policy: HybridAdoptionPolicy
    comparisons: tuple[HybridAdoptionComparisonAtK, ...]


def _metric_map(metrics: tuple[MetricsAtK, ...]) -> dict[int, MetricsAtK]:
    return {item.k: item for item in metrics}


def _difference(left: Decimal | None, right: Decimal | None) -> Decimal | None:
    if left is None or right is None:
        return None
    return quantize_metric(left - right)


def _best_simpler_reference(
    *,
    k: int,
    metrics_by_model: Mapping[str, tuple[MetricsAtK, ...]],
) -> tuple[str | None, MetricsAtK | None]:
    available: list[tuple[str, MetricsAtK, Decimal]] = []
    for model_id in SIMPLER_MODEL_IDS:
        metric = _metric_map(metrics_by_model.get(model_id, ())).get(k)
        if metric is not None:
            ndcg = metric.ndcg
            if ndcg is not None:
                available.append((model_id, metric, ndcg))
    if not available:
        return None, None
    # max() keeps the earliest tuple for equal metric values, which is the
    # declared simpler-model complexity order above.
    best_ndcg = max(item[2] for item in available)
    model_id, metric, _ = next(item for item in available if item[2] == best_ndcg)
    return model_id, metric


def _minimum(values: tuple[Decimal | None, ...]) -> Decimal | None:
    present = tuple(value for value in values if value is not None)
    return min(present) if present else None


def decide_hybrid_adoption(
    *,
    report_status: str,
    metrics_by_model: Mapping[str, tuple[MetricsAtK, ...]],
    snapshot_limitations: tuple[str, ...],
    policy: HybridAdoptionPolicy = DEFAULT_HYBRID_ADOPTION_POLICY,
) -> HybridAdoptionDecision:
    """Compare hybrid-v1 with the best simpler model at every shared cutoff."""

    hybrid_metrics = _metric_map(metrics_by_model.get(HYBRID_CANDIDATE_MODEL_ID, ()))
    ks = tuple(sorted(hybrid_metrics))
    comparisons: list[HybridAdoptionComparisonAtK] = []
    incomplete = report_status != "complete" or not ks
    required_metric_missing = False

    expected_models = {*SIMPLER_MODEL_IDS, HYBRID_CANDIDATE_MODEL_ID}
    if not expected_models.issubset(metrics_by_model):
        incomplete = True
    metric_maps = {
        model_id: _metric_map(metrics_by_model.get(model_id, ())) for model_id in expected_models
    }
    if any(frozenset(model_metrics) != frozenset(ks) for model_metrics in metric_maps.values()):
        incomplete = True

    for k in ks:
        hybrid = hybrid_metrics[k]
        reference_model_id, reference = _best_simpler_reference(
            k=k,
            metrics_by_model=metrics_by_model,
        )
        if reference is None:
            incomplete = True
            required_metric_missing = True
            comparisons.append(
                HybridAdoptionComparisonAtK(k, None, hybrid.evaluated_users, None, None, None)
            )
            continue
        support = (hybrid.evaluated_users, hybrid.relevant_items)
        if any(
            model_metrics.get(k) is None
            or (
                model_metrics[k].evaluated_users,
                model_metrics[k].relevant_items,
            )
            != support
            for model_metrics in metric_maps.values()
        ):
            incomplete = True
        ndcg_delta = _difference(hybrid.ndcg, reference.ndcg)
        recall_delta = _difference(hybrid.recall, reference.recall)
        coverage_delta = _difference(hybrid.coverage, reference.coverage)
        if ndcg_delta is None or recall_delta is None or coverage_delta is None:
            required_metric_missing = True
        comparisons.append(
            HybridAdoptionComparisonAtK(
                k=k,
                reference_model_id=reference_model_id,
                evaluated_users=hybrid.evaluated_users,
                ndcg_delta=ndcg_delta,
                recall_delta=recall_delta,
                coverage_delta=coverage_delta,
            )
        )

    primary_k = max(ks) if ks else None
    primary = next((item for item in comparisons if item.k == primary_k), None)
    evaluated_users = primary.evaluated_users if primary is not None else 0
    primary_lift = primary.ndcg_delta if primary is not None else None
    worst_ndcg = _minimum(tuple(item.ndcg_delta for item in comparisons))
    worst_recall = _minimum(tuple(item.recall_delta for item in comparisons))
    worst_coverage = _minimum(tuple(item.coverage_delta for item in comparisons))

    reasons: list[str] = []
    if incomplete:
        reasons.append("report_incomplete")
    if set(SIMULATION_ASSUMPTIONS).issubset(snapshot_limitations):
        reasons.append("synthetic_evidence_only")
    if required_metric_missing or primary_lift is None:
        reasons.append("required_metric_missing")
    if evaluated_users < policy.minimum_evaluated_users:
        reasons.append("evaluated_users_below_minimum")
    if primary_lift is not None and primary_lift < policy.minimum_primary_ndcg_lift:
        reasons.append("primary_ndcg_lift_below_minimum")
    if worst_ndcg is not None and worst_ndcg < -policy.maximum_ndcg_regression:
        reasons.append("ndcg_regression")
    if worst_recall is not None and worst_recall < -policy.maximum_recall_regression:
        reasons.append("recall_regression")
    if worst_coverage is not None and worst_coverage < -policy.maximum_coverage_regression:
        reasons.append("coverage_regression")

    return HybridAdoptionDecision(
        policy_version=HYBRID_ADOPTION_POLICY_VERSION,
        status="retain_simpler" if reasons else "adopt_hybrid",
        candidate_model_id=HYBRID_CANDIDATE_MODEL_ID,
        primary_k=primary_k,
        reference_model_id=primary.reference_model_id if primary is not None else None,
        evaluated_users=evaluated_users,
        primary_ndcg_lift=primary_lift,
        worst_ndcg_delta=worst_ndcg,
        worst_recall_delta=worst_recall,
        worst_coverage_delta=worst_coverage,
        reason_codes=tuple(reasons),
        policy=policy,
        comparisons=tuple(comparisons),
    )


__all__ = [
    "DEFAULT_HYBRID_ADOPTION_POLICY",
    "HYBRID_ADOPTION_POLICY_VERSION",
    "HYBRID_CANDIDATE_MODEL_ID",
    "HybridAdoptionComparisonAtK",
    "HybridAdoptionDecision",
    "HybridAdoptionPolicy",
    "decide_hybrid_adoption",
]
