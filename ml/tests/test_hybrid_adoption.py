from dataclasses import replace
from decimal import Decimal

import pytest

from recipe_lab_evaluation.adoption import (
    HYBRID_ADOPTION_POLICY_VERSION,
    HybridAdoptionPolicy,
    decide_hybrid_adoption,
)
from recipe_lab_evaluation.metrics import MetricsAtK
from recipe_lab_evaluation.simulator import SIMULATION_ASSUMPTIONS


def _metrics(
    *,
    k: int,
    users: int = 40,
    relevant_items: int = 80,
    ndcg: str | None,
    recall: str | None = "0.500000",
    coverage: str | None = "0.800000",
) -> MetricsAtK:
    return MetricsAtK(
        k=k,
        evaluated_users=users,
        relevant_items=relevant_items,
        precision=Decimal("0.500000"),
        recall=Decimal(recall) if recall is not None else None,
        ndcg=Decimal(ndcg) if ndcg is not None else None,
        coverage=Decimal(coverage) if coverage is not None else None,
        mean_recommended_popularity=Decimal("0.500000"),
        mean_candidate_popularity=Decimal("0.500000"),
        popularity_bias=Decimal("0.000000"),
    )


def _qualifying_metrics(*, users: int = 40) -> dict[str, tuple[MetricsAtK, ...]]:
    return {
        "baseline-v1": (
            _metrics(k=1, users=users, ndcg="0.550000", recall="0.450000"),
            _metrics(k=3, users=users, ndcg="0.570000", recall="0.470000"),
        ),
        "collaborative-v1": (
            _metrics(k=1, users=users, ndcg="0.580000", recall="0.480000"),
            _metrics(k=3, users=users, ndcg="0.590000", recall="0.490000"),
        ),
        "content-v1": (
            _metrics(k=1, users=users, ndcg="0.600000", recall="0.500000"),
            _metrics(k=3, users=users, ndcg="0.600000", recall="0.500000"),
        ),
        "hybrid-v1": (
            _metrics(
                k=1,
                users=users,
                ndcg="0.600000",
                recall="0.500000",
                coverage="0.750000",
            ),
            _metrics(
                k=3,
                users=users,
                ndcg="0.610000",
                recall="0.500000",
                coverage="0.750000",
            ),
        ),
    }


def test_policy_adopts_only_at_every_inclusive_boundary() -> None:
    decision = decide_hybrid_adoption(
        report_status="complete",
        metrics_by_model=_qualifying_metrics(),
        snapshot_limitations=("Observed privacy-safe evaluation cohort.",),
    )

    assert decision.policy_version == HYBRID_ADOPTION_POLICY_VERSION
    assert decision.status == "adopt_hybrid"
    assert decision.candidate_model_id == "hybrid-v1"
    assert decision.primary_k == 3
    assert decision.reference_model_id == "content-v1"
    assert decision.evaluated_users == 40
    assert decision.primary_ndcg_lift == Decimal("0.010000")
    assert decision.worst_ndcg_delta == Decimal("0.000000")
    assert decision.worst_recall_delta == Decimal("0.000000")
    assert decision.worst_coverage_delta == Decimal("-0.050000")
    assert decision.reason_codes == ()
    assert [comparison.reference_model_id for comparison in decision.comparisons] == [
        "content-v1",
        "content-v1",
    ]


@pytest.mark.parametrize(
    ("mutation", "reason"),
    [
        ("users", "evaluated_users_below_minimum"),
        ("primary_lift", "primary_ndcg_lift_below_minimum"),
        ("ndcg", "ndcg_regression"),
        ("recall", "recall_regression"),
        ("coverage", "coverage_regression"),
    ],
)
def test_one_failed_guardrail_always_retains_simpler(
    mutation: str,
    reason: str,
) -> None:
    metrics = _qualifying_metrics(users=39 if mutation == "users" else 40)
    hybrid = list(metrics["hybrid-v1"])
    if mutation == "primary_lift":
        hybrid[1] = replace(hybrid[1], ndcg=Decimal("0.609999"))
    elif mutation == "ndcg":
        hybrid[0] = replace(hybrid[0], ndcg=Decimal("0.599999"))
    elif mutation == "recall":
        hybrid[0] = replace(hybrid[0], recall=Decimal("0.499999"))
    elif mutation == "coverage":
        hybrid[0] = replace(hybrid[0], coverage=Decimal("0.749999"))
    metrics["hybrid-v1"] = tuple(hybrid)

    decision = decide_hybrid_adoption(
        report_status="complete",
        metrics_by_model=metrics,
        snapshot_limitations=("Observed privacy-safe evaluation cohort.",),
    )

    assert decision.status == "retain_simpler"
    assert reason in decision.reason_codes


def test_best_simpler_reference_is_selected_independently_at_each_k() -> None:
    metrics = _qualifying_metrics()
    metrics["baseline-v1"] = (
        replace(metrics["baseline-v1"][0], ndcg=Decimal("0.605000")),
        metrics["baseline-v1"][1],
    )

    decision = decide_hybrid_adoption(
        report_status="complete",
        metrics_by_model=metrics,
        snapshot_limitations=("Observed privacy-safe evaluation cohort.",),
    )

    assert [comparison.reference_model_id for comparison in decision.comparisons] == [
        "baseline-v1",
        "content-v1",
    ]
    assert decision.worst_ndcg_delta == Decimal("-0.005000")
    assert "ndcg_regression" in decision.reason_codes


def test_synthetic_data_forces_retain_even_if_every_metric_qualifies() -> None:
    decision = decide_hybrid_adoption(
        report_status="complete",
        metrics_by_model=_qualifying_metrics(),
        snapshot_limitations=SIMULATION_ASSUMPTIONS,
    )

    assert decision.status == "retain_simpler"
    assert decision.reason_codes == ("synthetic_evidence_only",)


def test_missing_metrics_or_an_incomplete_report_cannot_adopt() -> None:
    metrics = _qualifying_metrics()
    metrics["hybrid-v1"] = (
        metrics["hybrid-v1"][0],
        replace(metrics["hybrid-v1"][1], ndcg=None),
    )

    missing_metric = decide_hybrid_adoption(
        report_status="complete",
        metrics_by_model=metrics,
        snapshot_limitations=("Observed privacy-safe evaluation cohort.",),
    )
    incomplete = decide_hybrid_adoption(
        report_status="insufficient_data",
        metrics_by_model=_qualifying_metrics(),
        snapshot_limitations=("Observed privacy-safe evaluation cohort.",),
    )

    assert missing_metric.status == "retain_simpler"
    assert "required_metric_missing" in missing_metric.reason_codes
    assert incomplete.status == "retain_simpler"
    assert "report_incomplete" in incomplete.reason_codes


@pytest.mark.parametrize("mismatch", ["users", "relevant_items"])
def test_component_support_mismatch_cannot_authorize_adoption(mismatch: str) -> None:
    metrics = _qualifying_metrics()
    baseline = list(metrics["baseline-v1"])
    baseline[0] = replace(
        baseline[0],
        evaluated_users=39 if mismatch == "users" else baseline[0].evaluated_users,
        relevant_items=79 if mismatch == "relevant_items" else baseline[0].relevant_items,
    )
    metrics["baseline-v1"] = tuple(baseline)

    decision = decide_hybrid_adoption(
        report_status="complete",
        metrics_by_model=metrics,
        snapshot_limitations=("Observed privacy-safe evaluation cohort.",),
    )

    assert decision.status == "retain_simpler"
    assert "report_incomplete" in decision.reason_codes


def test_policy_rejects_invalid_thresholds() -> None:
    with pytest.raises(ValueError, match="positive"):
        HybridAdoptionPolicy(minimum_evaluated_users=0)
    with pytest.raises(ValueError, match="must not be negative"):
        HybridAdoptionPolicy(minimum_primary_ndcg_lift=Decimal("-0.000001"))
