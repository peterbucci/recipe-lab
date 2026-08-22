"""Deterministic structural-readiness checks for collaborative filtering.

The gate measures whether an evaluation snapshot has enough aggregate interaction
support to begin collaborative-filtering experiments.  It is deliberately not a
model-quality claim: event rows, distinct profile-item pairs, catalog support, and
strictly temporal holdout labels are counted separately. Because signed save,
rating, view, and fork signals can cancel, the gate also requires enough nonzero
post-aggregation matrix cells. It additionally verifies that enough temporal
evaluation profiles have at least one candidate with a nonzero collaborative
score, so a dense but non-overlapping matrix cannot pass on content fallback alone.

An observed matrix cell is one distinct ``(profile, source recipe version)`` pair
in the training prefix, regardless of how many typed events exist for that pair.
A fork child is not counted as observed unless it has its own event.  Temporal
evaluation profiles must both meet the configured training-history minimum and
have at least one unseen, available positive label under :func:`split_snapshot`.
Free-form snapshot labels and limitations are deliberately omitted from reports;
only the snapshot schema, fingerprint, and cutoff identify the source contract.
"""

from __future__ import annotations

from dataclasses import dataclass, fields
from datetime import UTC, datetime
from fractions import Fraction
from typing import Literal
from uuid import UUID

from .dataset import (
    EvaluationSnapshot,
    canonical_json,
    parse_snapshot_json,
    snapshot_to_json,
)
from .models.collaborative_v1 import (
    MIN_ITEM_SIGNAL_PROFILES,
    MIN_PROFILE_SIGNAL_ITEMS,
    score_collaborative_candidate,
)
from .models.content_based_v1 import derive_preference_signals
from .split import split_snapshot

READINESS_REPORT_SCHEMA_VERSION = "recipe-lab-collaborative-readiness-report-v2"
READINESS_PROTOCOL_VERSION = "fixed-cutoff-collaborative-readiness-v2"

READINESS_LIMITATIONS = (
    (
        "A ready result authorizes only offline RCP-18 implementation and evaluation; "
        "it is not a production-readiness decision."
    ),
    "This gate measures structural data support and temporal evaluability, not quality.",
    "A ready result from simulated events does not demonstrate behavior for real users.",
    "Event-row counts and distinct profile-item support measure different properties.",
    "Signed state can cancel raw activity, so effective nonzero support is gated separately.",
    "Usable candidate evidence is gated so a ready run cannot be content fallback only.",
)

type ReadinessStatus = Literal["ready", "insufficient_data"]


@dataclass(frozen=True, slots=True)
class ReadinessThresholds:
    """Minimum aggregate support required by the engineering-readiness gate.

    The catalog defaults are intentionally sized for the versioned eight-item
    engineering fixture.  Passing them permits collaborative-filtering pipeline
    work; it does not establish production scale, statistical power, or quality.
    """

    minimum_training_profiles: int = 50
    minimum_available_items: int = 8
    minimum_training_events: int = 500
    minimum_distinct_training_items_per_profile: int = 5
    minimum_supported_profiles: int = 40
    minimum_distinct_training_profiles_per_item: int = 3
    minimum_supported_items: int = 8
    minimum_observed_training_pairs: int = 200
    minimum_nonzero_signal_pairs: int = 200
    minimum_signal_supported_profiles: int = 40
    minimum_signal_supported_items: int = 8
    minimum_temporal_evaluation_profiles: int = 20
    minimum_temporal_relevant_items: int = 20

    def __post_init__(self) -> None:
        for threshold_field in fields(self):
            value = getattr(self, threshold_field.name)
            if isinstance(value, bool) or not isinstance(value, int) or value < 1:
                raise ValueError(f"{threshold_field.name} must be a positive integer")


DEFAULT_READINESS_THRESHOLDS = ReadinessThresholds()


@dataclass(frozen=True, slots=True)
class ProfileCounts:
    total: int
    training: int
    holdout: int


@dataclass(frozen=True, slots=True)
class ItemCounts:
    total: int
    available_at_cutoff: int
    observed_in_training: int


@dataclass(frozen=True, slots=True)
class InteractionCounts:
    total: int
    training: int
    holdout: int


@dataclass(frozen=True, slots=True)
class SupportCounts:
    profiles_meeting_history_minimum: int
    items_meeting_profile_minimum: int


@dataclass(frozen=True, slots=True)
class SparsityCounts:
    possible_training_pairs: int
    observed_training_pairs: int
    unobserved_training_pairs: int


@dataclass(frozen=True, slots=True)
class EffectiveSignalCounts:
    profiles_with_nonzero_signals: int
    items_with_nonzero_signals: int
    nonzero_signal_pairs: int
    profiles_meeting_signal_minimum: int
    items_meeting_signal_minimum: int


@dataclass(frozen=True, slots=True)
class CollaborativeEvidenceCounts:
    profiles_with_supported_targets: int
    profiles_with_usable_candidate_evidence: int
    candidate_items_with_usable_evidence: int


@dataclass(frozen=True, slots=True)
class TemporalEvaluationCounts:
    split_eligible_profiles: int
    split_eligible_relevant_items: int
    profiles_with_collaborative_evidence: int
    relevant_items_for_collaborative_profiles: int
    raw_relevant_items: int
    filtered_already_interacted: int
    filtered_unavailable: int


@dataclass(frozen=True, slots=True)
class ReadinessCounts:
    profiles: ProfileCounts
    items: ItemCounts
    interactions: InteractionCounts
    support: SupportCounts
    sparsity: SparsityCounts
    effective_signals: EffectiveSignalCounts
    collaborative_evidence: CollaborativeEvidenceCounts
    temporal_evaluation: TemporalEvaluationCounts


@dataclass(frozen=True, slots=True)
class ReadinessCheck:
    metric: str
    actual: int
    minimum: int
    failure_reason: str

    @property
    def passed(self) -> bool:
        return self.actual >= self.minimum


@dataclass(frozen=True, slots=True)
class ReadinessReport:
    schema_version: str
    protocol_version: str
    status: ReadinessStatus
    reason_codes: tuple[str, ...]
    snapshot_schema_version: str
    snapshot_sha256: str
    cutoff: datetime
    thresholds: ReadinessThresholds
    counts: ReadinessCounts
    checks: tuple[ReadinessCheck, ...]
    limitations: tuple[str, ...]


def _checks(
    counts: ReadinessCounts,
    thresholds: ReadinessThresholds,
) -> tuple[ReadinessCheck, ...]:
    return (
        ReadinessCheck(
            metric="training_profiles",
            actual=counts.profiles.training,
            minimum=thresholds.minimum_training_profiles,
            failure_reason="training_profiles_below_minimum",
        ),
        ReadinessCheck(
            metric="available_items",
            actual=counts.items.available_at_cutoff,
            minimum=thresholds.minimum_available_items,
            failure_reason="available_items_below_minimum",
        ),
        ReadinessCheck(
            metric="training_events",
            actual=counts.interactions.training,
            minimum=thresholds.minimum_training_events,
            failure_reason="training_events_below_minimum",
        ),
        ReadinessCheck(
            metric="supported_profiles",
            actual=counts.support.profiles_meeting_history_minimum,
            minimum=thresholds.minimum_supported_profiles,
            failure_reason="supported_profiles_below_minimum",
        ),
        ReadinessCheck(
            metric="supported_items",
            actual=counts.support.items_meeting_profile_minimum,
            minimum=thresholds.minimum_supported_items,
            failure_reason="supported_items_below_minimum",
        ),
        ReadinessCheck(
            metric="observed_training_pairs",
            actual=counts.sparsity.observed_training_pairs,
            minimum=thresholds.minimum_observed_training_pairs,
            failure_reason="observed_training_pairs_below_minimum",
        ),
        ReadinessCheck(
            metric="nonzero_signal_pairs",
            actual=counts.effective_signals.nonzero_signal_pairs,
            minimum=thresholds.minimum_nonzero_signal_pairs,
            failure_reason="nonzero_signal_pairs_below_minimum",
        ),
        ReadinessCheck(
            metric="signal_supported_profiles",
            actual=counts.effective_signals.profiles_meeting_signal_minimum,
            minimum=thresholds.minimum_signal_supported_profiles,
            failure_reason="signal_supported_profiles_below_minimum",
        ),
        ReadinessCheck(
            metric="signal_supported_items",
            actual=counts.effective_signals.items_meeting_signal_minimum,
            minimum=thresholds.minimum_signal_supported_items,
            failure_reason="signal_supported_items_below_minimum",
        ),
        ReadinessCheck(
            metric="temporal_evaluation_profiles",
            actual=counts.temporal_evaluation.profiles_with_collaborative_evidence,
            minimum=thresholds.minimum_temporal_evaluation_profiles,
            failure_reason="temporal_evaluation_profiles_below_minimum",
        ),
        ReadinessCheck(
            metric="temporal_relevant_items",
            actual=counts.temporal_evaluation.relevant_items_for_collaborative_profiles,
            minimum=thresholds.minimum_temporal_relevant_items,
            failure_reason="temporal_relevant_items_below_minimum",
        ),
    )


def assess_readiness(
    snapshot: EvaluationSnapshot,
    thresholds: ReadinessThresholds | None = None,
) -> ReadinessReport:
    """Return a deterministic, aggregate-only collaborative-data readiness report."""

    resolved_thresholds = thresholds or DEFAULT_READINESS_THRESHOLDS
    normalized_snapshot = parse_snapshot_json(snapshot_to_json(snapshot))
    split = split_snapshot(normalized_snapshot)

    training_profiles = frozenset(event.user_id for event in split.training_events)
    holdout_profiles = frozenset(event.user_id for event in split.holdout_events)
    all_profiles = training_profiles | holdout_profiles
    training_pairs = frozenset(
        (event.user_id, event.recipe_version_id) for event in split.training_events
    )

    items_by_profile: dict[UUID, set[UUID]] = {}
    profiles_by_item: dict[UUID, set[UUID]] = {}
    for profile_id, item_id in training_pairs:
        items_by_profile.setdefault(profile_id, set()).add(item_id)
        profiles_by_item.setdefault(item_id, set()).add(profile_id)

    supported_profiles = frozenset(
        profile_id
        for profile_id, item_ids in items_by_profile.items()
        if len(item_ids) >= resolved_thresholds.minimum_distinct_training_items_per_profile
    )
    supported_items = frozenset(
        item_id
        for item_id, profile_ids in profiles_by_item.items()
        if len(profile_ids) >= resolved_thresholds.minimum_distinct_training_profiles_per_item
    )

    derived_signals_by_profile = derive_preference_signals(split.training_events)
    signals_by_profile = {
        profile_id: {signal.recipe_version_id: signal.weight for signal in signals}
        for profile_id, signals in derived_signals_by_profile.items()
    }
    signal_items_by_profile = {
        profile_id: frozenset(signals) for profile_id, signals in signals_by_profile.items()
    }
    signal_profiles_by_item: dict[UUID, set[UUID]] = {}
    for profile_id, item_ids in signal_items_by_profile.items():
        for item_id in item_ids:
            signal_profiles_by_item.setdefault(item_id, set()).add(profile_id)
    signal_supported_profiles = frozenset(
        profile_id
        for profile_id, item_ids in signal_items_by_profile.items()
        if len(item_ids) >= resolved_thresholds.minimum_distinct_training_items_per_profile
    )
    signal_supported_items = frozenset(
        item_id
        for item_id, profile_ids in signal_profiles_by_item.items()
        if len(profile_ids) >= resolved_thresholds.minimum_distinct_training_profiles_per_item
    )

    profiles_by_signal_item = {
        item_id: tuple(sorted(profile_ids, key=lambda value: value.int))
        for item_id, profile_ids in signal_profiles_by_item.items()
    }
    supported_target_profiles: set[UUID] = set()
    collaborative_profile_ids: set[UUID] = set()
    collaborative_candidate_ids: set[UUID] = set()
    for case in split.cases:
        target = signals_by_profile.get(case.user_id, {})
        if len(target) < max(
            MIN_PROFILE_SIGNAL_ITEMS,
            resolved_thresholds.minimum_distinct_training_items_per_profile,
        ):
            continue
        supported_target_profiles.add(case.user_id)
        similarity_cache: dict[UUID, Fraction | None] = {}
        evidence_ids = {
            candidate_id
            for candidate_id in case.candidate_ids
            if score_collaborative_candidate(
                candidate_id=candidate_id,
                user_id=case.user_id,
                target=target,
                signals_by_user=signals_by_profile,
                profiles_by_recipe=profiles_by_signal_item,
                similarity_cache=similarity_cache,
                minimum_item_signal_profiles=max(
                    MIN_ITEM_SIGNAL_PROFILES,
                    resolved_thresholds.minimum_distinct_training_profiles_per_item,
                ),
            )
            != 0
        }
        if evidence_ids:
            collaborative_profile_ids.add(case.user_id)
            collaborative_candidate_ids.update(evidence_ids)

    collaborative_cases = tuple(
        case for case in split.cases if case.user_id in collaborative_profile_ids
    )
    possible_training_pairs = len(training_profiles) * len(split.recipes)
    observed_training_pairs = len(training_pairs)
    counts = ReadinessCounts(
        profiles=ProfileCounts(
            total=len(all_profiles),
            training=len(training_profiles),
            holdout=len(holdout_profiles),
        ),
        items=ItemCounts(
            total=len(normalized_snapshot.recipes),
            available_at_cutoff=len(split.recipes),
            observed_in_training=len(profiles_by_item),
        ),
        interactions=InteractionCounts(
            total=len(normalized_snapshot.events),
            training=len(split.training_events),
            holdout=len(split.holdout_events),
        ),
        support=SupportCounts(
            profiles_meeting_history_minimum=len(supported_profiles),
            items_meeting_profile_minimum=len(supported_items),
        ),
        sparsity=SparsityCounts(
            possible_training_pairs=possible_training_pairs,
            observed_training_pairs=observed_training_pairs,
            unobserved_training_pairs=possible_training_pairs - observed_training_pairs,
        ),
        effective_signals=EffectiveSignalCounts(
            profiles_with_nonzero_signals=len(signal_items_by_profile),
            items_with_nonzero_signals=len(signal_profiles_by_item),
            nonzero_signal_pairs=sum(
                len(item_ids) for item_ids in signal_items_by_profile.values()
            ),
            profiles_meeting_signal_minimum=len(signal_supported_profiles),
            items_meeting_signal_minimum=len(signal_supported_items),
        ),
        collaborative_evidence=CollaborativeEvidenceCounts(
            profiles_with_supported_targets=len(supported_target_profiles),
            profiles_with_usable_candidate_evidence=len(collaborative_profile_ids),
            candidate_items_with_usable_evidence=len(collaborative_candidate_ids),
        ),
        temporal_evaluation=TemporalEvaluationCounts(
            split_eligible_profiles=split.counts.eligible_users,
            split_eligible_relevant_items=split.counts.eligible_relevant_items,
            profiles_with_collaborative_evidence=len(collaborative_cases),
            relevant_items_for_collaborative_profiles=sum(
                len(case.relevant_ids) for case in collaborative_cases
            ),
            raw_relevant_items=split.counts.raw_relevant_items,
            filtered_already_interacted=split.counts.filtered_already_interacted,
            filtered_unavailable=split.counts.filtered_unavailable,
        ),
    )
    checks = _checks(counts, resolved_thresholds)
    reason_codes = tuple(check.failure_reason for check in checks if not check.passed)
    return ReadinessReport(
        schema_version=READINESS_REPORT_SCHEMA_VERSION,
        protocol_version=READINESS_PROTOCOL_VERSION,
        status="insufficient_data" if reason_codes else "ready",
        reason_codes=reason_codes,
        snapshot_schema_version=normalized_snapshot.schema_version,
        snapshot_sha256=normalized_snapshot.sha256,
        cutoff=normalized_snapshot.cutoff,
        thresholds=resolved_thresholds,
        counts=counts,
        checks=checks,
        limitations=READINESS_LIMITATIONS,
    )


def _timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _threshold_document(thresholds: ReadinessThresholds) -> dict[str, int]:
    return {
        threshold_field.name: getattr(thresholds, threshold_field.name)
        for threshold_field in fields(thresholds)
    }


def readiness_report_to_document(report: ReadinessReport) -> dict[str, object]:
    """Return the aggregate document form without host or wall-clock metadata."""

    sparsity = report.counts.sparsity
    density = (
        None
        if sparsity.possible_training_pairs == 0
        else {
            "numerator": sparsity.observed_training_pairs,
            "denominator": sparsity.possible_training_pairs,
        }
    )
    sparsity_fraction = (
        None
        if sparsity.possible_training_pairs == 0
        else {
            "numerator": sparsity.unobserved_training_pairs,
            "denominator": sparsity.possible_training_pairs,
        }
    )
    return {
        "schema_version": report.schema_version,
        "protocol_version": report.protocol_version,
        "status": report.status,
        "reason_codes": list(report.reason_codes),
        "snapshot": {
            "schema_version": report.snapshot_schema_version,
            "sha256": report.snapshot_sha256,
            "cutoff": _timestamp(report.cutoff),
        },
        "thresholds": _threshold_document(report.thresholds),
        "counts": {
            "profiles": {
                "total": report.counts.profiles.total,
                "training": report.counts.profiles.training,
                "holdout": report.counts.profiles.holdout,
            },
            "items": {
                "total": report.counts.items.total,
                "available_at_cutoff": report.counts.items.available_at_cutoff,
                "observed_in_training": report.counts.items.observed_in_training,
            },
            "interactions": {
                "total": report.counts.interactions.total,
                "training": report.counts.interactions.training,
                "holdout": report.counts.interactions.holdout,
            },
            "support": {
                "profiles_meeting_history_minimum": (
                    report.counts.support.profiles_meeting_history_minimum
                ),
                "items_meeting_profile_minimum": (
                    report.counts.support.items_meeting_profile_minimum
                ),
            },
            "sparsity": {
                "possible_training_pairs": sparsity.possible_training_pairs,
                "observed_training_pairs": sparsity.observed_training_pairs,
                "unobserved_training_pairs": sparsity.unobserved_training_pairs,
                "density": density,
                "sparsity": sparsity_fraction,
            },
            "effective_signals": {
                "profiles_with_nonzero_signals": (
                    report.counts.effective_signals.profiles_with_nonzero_signals
                ),
                "items_with_nonzero_signals": (
                    report.counts.effective_signals.items_with_nonzero_signals
                ),
                "nonzero_signal_pairs": report.counts.effective_signals.nonzero_signal_pairs,
                "profiles_meeting_signal_minimum": (
                    report.counts.effective_signals.profiles_meeting_signal_minimum
                ),
                "items_meeting_signal_minimum": (
                    report.counts.effective_signals.items_meeting_signal_minimum
                ),
            },
            "collaborative_evidence": {
                "profiles_with_supported_targets": (
                    report.counts.collaborative_evidence.profiles_with_supported_targets
                ),
                "profiles_with_usable_candidate_evidence": (
                    report.counts.collaborative_evidence.profiles_with_usable_candidate_evidence
                ),
                "candidate_items_with_usable_evidence": (
                    report.counts.collaborative_evidence.candidate_items_with_usable_evidence
                ),
            },
            "temporal_evaluation": {
                "split_eligible_profiles": (
                    report.counts.temporal_evaluation.split_eligible_profiles
                ),
                "split_eligible_relevant_items": (
                    report.counts.temporal_evaluation.split_eligible_relevant_items
                ),
                "profiles_with_collaborative_evidence": (
                    report.counts.temporal_evaluation.profiles_with_collaborative_evidence
                ),
                "relevant_items_for_collaborative_profiles": (
                    report.counts.temporal_evaluation.relevant_items_for_collaborative_profiles
                ),
                "raw_relevant_items": report.counts.temporal_evaluation.raw_relevant_items,
                "filtered_already_interacted": (
                    report.counts.temporal_evaluation.filtered_already_interacted
                ),
                "filtered_unavailable": (report.counts.temporal_evaluation.filtered_unavailable),
            },
        },
        "checks": {
            check.metric: {
                "actual": check.actual,
                "minimum": check.minimum,
                "passed": check.passed,
                "failure_reason": check.failure_reason,
            }
            for check in report.checks
        },
        "limitations": list(report.limitations),
    }


def readiness_report_to_json(report: ReadinessReport) -> str:
    """Serialize readiness results to stable canonical JSON bytes."""

    return canonical_json(readiness_report_to_document(report)) + "\n"


__all__ = [
    "DEFAULT_READINESS_THRESHOLDS",
    "READINESS_LIMITATIONS",
    "READINESS_PROTOCOL_VERSION",
    "READINESS_REPORT_SCHEMA_VERSION",
    "CollaborativeEvidenceCounts",
    "EffectiveSignalCounts",
    "InteractionCounts",
    "ItemCounts",
    "ProfileCounts",
    "ReadinessCheck",
    "ReadinessCounts",
    "ReadinessReport",
    "ReadinessStatus",
    "ReadinessThresholds",
    "SparsityCounts",
    "SupportCounts",
    "TemporalEvaluationCounts",
    "assess_readiness",
    "readiness_report_to_document",
    "readiness_report_to_json",
]
