from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, localcontext
from uuid import UUID

from .dataset import SnapshotEvent
from .split import UserEvaluationCase

METRIC_QUANTUM = Decimal("0.000001")


@dataclass(frozen=True, slots=True)
class MetricsAtK:
    k: int
    evaluated_users: int
    relevant_items: int
    precision: Decimal | None
    recall: Decimal | None
    ndcg: Decimal | None
    coverage: Decimal | None
    mean_recommended_popularity: Decimal | None
    mean_candidate_popularity: Decimal | None
    popularity_bias: Decimal | None


@dataclass(frozen=True, slots=True)
class EvaluationMetricContext:
    popularity_by_item: Mapping[UUID, Decimal]


def quantize_metric(value: Decimal) -> Decimal:
    return value.quantize(METRIC_QUANTUM, rounding=ROUND_HALF_UP)


def ratio_metric(numerator: int, denominator: int) -> Decimal | None:
    if denominator == 0:
        return None
    return quantize_metric(Decimal(numerator) / Decimal(denominator))


def _discount(rank: int) -> Decimal:
    with localcontext() as context:
        context.prec = 50
        return Decimal(1) / (Decimal(rank + 1).ln() / Decimal(2).ln())


def _training_popularity(
    training_events: tuple[SnapshotEvent, ...],
) -> dict[UUID, Decimal]:
    users_by_item: dict[UUID, set[UUID]] = {}
    for event in training_events:
        users_by_item.setdefault(event.recipe_version_id, set()).add(event.user_id)
        if event.related_recipe_version_id is not None:
            users_by_item.setdefault(event.related_recipe_version_id, set()).add(event.user_id)
    maximum = max((len(users) for users in users_by_item.values()), default=0)
    if maximum == 0:
        return {}
    return {
        recipe_version_id: Decimal(len(users)) / Decimal(maximum)
        for recipe_version_id, users in users_by_item.items()
    }


def prepare_metric_context(
    training_events: tuple[SnapshotEvent, ...],
) -> EvaluationMetricContext:
    """Prepare model-independent evidence once for all cutoffs and fitted models."""

    return EvaluationMetricContext(popularity_by_item=_training_popularity(training_events))


def calculate_metrics(
    *,
    k: int,
    cases: tuple[UserEvaluationCase, ...],
    rankings: Mapping[UUID, tuple[UUID, ...]],
    training_events: tuple[SnapshotEvent, ...],
    context: EvaluationMetricContext | None = None,
) -> MetricsAtK:
    if k < 1:
        raise ValueError("k must be positive")
    if not cases:
        return MetricsAtK(k, 0, 0, None, None, None, None, None, None, None)

    popularity = (
        context.popularity_by_item
        if context is not None
        else prepare_metric_context(training_events).popularity_by_item
    )
    precisions: list[Decimal] = []
    recalls: list[Decimal] = []
    ndcgs: list[Decimal] = []
    recommended_popularities: list[Decimal] = []
    candidate_popularities: list[Decimal] = []
    recommended_union: set[UUID] = set()
    candidate_union: set[UUID] = set()

    for case in cases:
        k_user = min(k, len(case.candidate_ids))
        if k_user == 0:
            continue
        ranked = rankings[case.user_id][:k_user]
        hits = sum(recipe_id in case.relevant_ids for recipe_id in ranked)
        precisions.append(Decimal(hits) / Decimal(k_user))
        recalls.append(Decimal(hits) / Decimal(len(case.relevant_ids)))

        dcg = sum(
            (
                _discount(rank)
                for rank, recipe_id in enumerate(ranked, start=1)
                if recipe_id in case.relevant_ids
            ),
            start=Decimal(0),
        )
        ideal_hits = min(k_user, len(case.relevant_ids))
        idcg = sum((_discount(rank) for rank in range(1, ideal_hits + 1)), start=Decimal(0))
        ndcgs.append(dcg / idcg)

        recommended_union.update(ranked)
        candidate_union.update(case.candidate_ids)
        recommended_popularities.append(
            sum((popularity.get(recipe_id, Decimal(0)) for recipe_id in ranked), Decimal(0))
            / Decimal(k_user)
        )
        candidate_popularities.append(
            sum(
                (popularity.get(recipe_id, Decimal(0)) for recipe_id in case.candidate_ids),
                Decimal(0),
            )
            / Decimal(len(case.candidate_ids))
        )

    if not precisions:
        return MetricsAtK(k, 0, 0, None, None, None, None, None, None, None)

    user_count = Decimal(len(precisions))
    precision = sum(precisions, Decimal(0)) / user_count
    recall = sum(recalls, Decimal(0)) / user_count
    ndcg = sum(ndcgs, Decimal(0)) / user_count
    coverage = Decimal(len(recommended_union)) / Decimal(len(candidate_union))
    mean_recommended_popularity = sum(recommended_popularities, Decimal(0)) / user_count
    mean_candidate_popularity = sum(candidate_popularities, Decimal(0)) / user_count
    return MetricsAtK(
        k=k,
        evaluated_users=len(precisions),
        relevant_items=sum(len(case.relevant_ids) for case in cases),
        precision=quantize_metric(precision),
        recall=quantize_metric(recall),
        ndcg=quantize_metric(ndcg),
        coverage=quantize_metric(coverage),
        mean_recommended_popularity=quantize_metric(mean_recommended_popularity),
        mean_candidate_popularity=quantize_metric(mean_candidate_popularity),
        popularity_bias=quantize_metric(mean_recommended_popularity - mean_candidate_popularity),
    )
