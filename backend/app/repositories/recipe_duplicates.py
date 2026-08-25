import re
from collections.abc import Sequence
from dataclasses import dataclass
from fractions import Fraction
from typing import Literal
from uuid import UUID, uuid4

from sqlalchemy import Select, select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.orm import Session, selectinload

from app.models import (
    RECIPE_DUPLICATE_DECISIONS,
    RECIPE_DUPLICATE_DISTINCT,
    RECIPE_DUPLICATE_EXACT,
    RECIPE_DUPLICATE_PROBABLE,
    RecipeDuplicateCandidate,
    RecipeDuplicateDecision,
    RecipeDuplicatePreflight,
)

MAX_RECIPE_DUPLICATE_CANDIDATES = 5
MAX_RECIPE_DUPLICATE_REASON_CODES = 3
_REASON_CODE_PATTERN = re.compile(r"^[a-z0-9]+(?:_[a-z0-9]+)*$")


class RecipeDuplicateStorageConflictError(RuntimeError):
    """Raised when an idempotency key already represents different evidence."""


class RecipeDuplicatePreflightNotFoundError(LookupError):
    """Raised without disclosing whether another actor owns a preflight."""


class RecipeDuplicateAcknowledgementConflictError(RuntimeError):
    """Raised when an author decision does not acknowledge the stored result."""


@dataclass(frozen=True, slots=True)
class RecipeDuplicateCandidateWrite:
    public_recipe_version_id: UUID
    rank: int
    classification: str
    score_basis_points: int
    reason_codes: tuple[str, ...]
    fingerprint_algorithm_version: str
    policy_version: str
    exact_payload_confirmed: bool


@dataclass(frozen=True, slots=True)
class RecipeDuplicatePreflightStoreResult:
    preflight: RecipeDuplicatePreflight
    state: Literal["created", "reused"]


@dataclass(frozen=True, slots=True)
class RecipeDuplicateDecisionStoreResult:
    decision: RecipeDuplicateDecision
    state: Literal["created", "reused"]


def duplicate_score_to_basis_points(score: Fraction) -> int:
    """Round an exact unit-interval score to basis points, with ties rounded upward."""

    if not 0 <= score <= 1:
        raise ValueError("Duplicate candidate scores must be between zero and one.")
    numerator = score.numerator * 10_000
    quotient, remainder = divmod(numerator, score.denominator)
    return quotient + int(remainder * 2 >= score.denominator)


def _preflight_statement() -> Select[tuple[RecipeDuplicatePreflight]]:
    return select(RecipeDuplicatePreflight).options(
        selectinload(RecipeDuplicatePreflight.candidates),
        selectinload(RecipeDuplicatePreflight.decision),
    )


def get_recipe_duplicate_preflight_by_id(
    session: Session,
    *,
    actor_user_id: UUID,
    preflight_id: UUID,
) -> RecipeDuplicatePreflight | None:
    """Load one preflight only when it belongs to the requesting actor."""

    return session.scalar(
        _preflight_statement().where(
            RecipeDuplicatePreflight.id == preflight_id,
            RecipeDuplicatePreflight.actor_user_id == actor_user_id,
        )
    )


def get_recipe_duplicate_preflight_by_action(
    session: Session,
    *,
    actor_user_id: UUID,
    action_id: UUID,
) -> RecipeDuplicatePreflight | None:
    """Load an idempotent preflight from one actor-and-action namespace."""

    return session.scalar(
        _preflight_statement().where(
            RecipeDuplicatePreflight.actor_user_id == actor_user_id,
            RecipeDuplicatePreflight.action_id == action_id,
        )
    )


def _validate_candidates(
    *,
    source_version_id: UUID | None,
    subject_fingerprint_algorithm: str,
    policy_version: str,
    classification: str,
    same_parent_no_change: bool,
    candidates: Sequence[RecipeDuplicateCandidateWrite],
) -> None:
    if len(candidates) > MAX_RECIPE_DUPLICATE_CANDIDATES:
        raise ValueError(
            f"At most {MAX_RECIPE_DUPLICATE_CANDIDATES} public candidates may be stored."
        )
    if [candidate.rank for candidate in candidates] != list(range(1, len(candidates) + 1)):
        raise ValueError("Candidate ranks must be consecutive and start at one.")
    if len({candidate.public_recipe_version_id for candidate in candidates}) != len(candidates):
        raise ValueError("Public recipe candidates must be unique.")
    if source_version_id is not None and any(
        candidate.public_recipe_version_id == source_version_id for candidate in candidates
    ):
        raise ValueError("The source recipe cannot be emitted as a duplicate candidate.")
    if same_parent_no_change and source_version_id is None:
        raise ValueError("A no-change warning requires its direct source recipe.")

    for candidate in candidates:
        if not 1 <= len(candidate.reason_codes) <= MAX_RECIPE_DUPLICATE_REASON_CODES:
            raise ValueError("Candidate reason codes must contain between one and three items.")
        if len(set(candidate.reason_codes)) != len(candidate.reason_codes):
            raise ValueError("Candidate reason codes must be unique.")
        if any(
            len(reason_code) > 64 or _REASON_CODE_PATTERN.fullmatch(reason_code) is None
            for reason_code in candidate.reason_codes
        ):
            raise ValueError("Candidate reason codes must use bounded snake-case identifiers.")
        if candidate.fingerprint_algorithm_version != subject_fingerprint_algorithm:
            raise ValueError("Candidate and subject fingerprint versions must match.")
        if candidate.policy_version != policy_version:
            raise ValueError("Candidate and preflight policy versions must match.")
        if candidate.classification == RECIPE_DUPLICATE_EXACT:
            if candidate.score_basis_points != 10_000 or not candidate.exact_payload_confirmed:
                raise ValueError("Exact candidates require confirmed payload equality.")
        elif candidate.classification == RECIPE_DUPLICATE_PROBABLE:
            if not 0 <= candidate.score_basis_points <= 10_000:
                raise ValueError("Candidate scores must be between zero and 10,000 basis points.")
            if candidate.exact_payload_confirmed:
                raise ValueError("Probable candidates cannot claim exact payload equality.")
        else:
            raise ValueError("Only exact and probable candidates may be stored.")

    exact_candidate_present = any(
        candidate.classification == RECIPE_DUPLICATE_EXACT for candidate in candidates
    )
    if classification == RECIPE_DUPLICATE_DISTINCT:
        if candidates or same_parent_no_change:
            raise ValueError("A distinct result cannot contain duplicate evidence.")
    elif classification == RECIPE_DUPLICATE_PROBABLE:
        if not candidates or exact_candidate_present or same_parent_no_change:
            raise ValueError("A probable result requires only probable public candidates.")
    elif classification == RECIPE_DUPLICATE_EXACT:
        if not exact_candidate_present and not same_parent_no_change:
            raise ValueError("An exact result requires an exact candidate or no-change warning.")
    else:
        raise ValueError("Unsupported duplicate classification.")


def store_recipe_duplicate_preflight(
    session: Session,
    *,
    actor_user_id: UUID,
    action_id: UUID,
    request_fingerprint: str,
    source_version_id: UUID | None,
    subject_fingerprint_algorithm: str,
    subject_fingerprint_digest: str,
    policy_version: str,
    classification: str,
    same_parent_no_change: bool,
    result_digest: str,
    candidates: Sequence[RecipeDuplicateCandidateWrite],
) -> RecipeDuplicatePreflightStoreResult:
    """Atomically store one bounded result or replay its immutable original."""

    existing = get_recipe_duplicate_preflight_by_action(
        session,
        actor_user_id=actor_user_id,
        action_id=action_id,
    )
    if existing is not None:
        if existing.request_fingerprint != request_fingerprint:
            raise RecipeDuplicateStorageConflictError(
                "The preflight action identifier is already bound to another request."
            )
        return RecipeDuplicatePreflightStoreResult(preflight=existing, state="reused")

    _validate_candidates(
        source_version_id=source_version_id,
        subject_fingerprint_algorithm=subject_fingerprint_algorithm,
        policy_version=policy_version,
        classification=classification,
        same_parent_no_change=same_parent_no_change,
        candidates=candidates,
    )
    preflight_id = uuid4()
    inserted_id = session.scalar(
        postgresql_insert(RecipeDuplicatePreflight)
        .values(
            id=preflight_id,
            actor_user_id=actor_user_id,
            action_id=action_id,
            request_fingerprint=request_fingerprint,
            source_version_id=source_version_id,
            subject_fingerprint_algorithm=subject_fingerprint_algorithm,
            subject_fingerprint_digest=subject_fingerprint_digest,
            policy_version=policy_version,
            classification=classification,
            same_parent_no_change=same_parent_no_change,
            result_digest=result_digest,
        )
        .on_conflict_do_nothing(
            index_elements=[
                RecipeDuplicatePreflight.actor_user_id,
                RecipeDuplicatePreflight.action_id,
            ]
        )
        .returning(RecipeDuplicatePreflight.id)
    )
    if inserted_id is None:
        concurrent = get_recipe_duplicate_preflight_by_action(
            session,
            actor_user_id=actor_user_id,
            action_id=action_id,
        )
        if concurrent is None:
            raise RuntimeError("The preflight idempotency conflict could not be resolved.")
        if concurrent.request_fingerprint != request_fingerprint:
            raise RecipeDuplicateStorageConflictError(
                "The preflight action identifier is already bound to another request."
            )
        return RecipeDuplicatePreflightStoreResult(preflight=concurrent, state="reused")

    session.add_all(
        [
            RecipeDuplicateCandidate(
                preflight_id=preflight_id,
                public_recipe_version_id=candidate.public_recipe_version_id,
                rank=candidate.rank,
                classification=candidate.classification,
                score_basis_points=candidate.score_basis_points,
                reason_codes=list(candidate.reason_codes),
                fingerprint_algorithm_version=candidate.fingerprint_algorithm_version,
                policy_version=candidate.policy_version,
                exact_payload_confirmed=candidate.exact_payload_confirmed,
            )
            for candidate in candidates
        ]
    )
    session.flush()
    stored = get_recipe_duplicate_preflight_by_id(
        session,
        actor_user_id=actor_user_id,
        preflight_id=preflight_id,
    )
    if stored is None:
        raise RuntimeError("The stored preflight could not be reloaded.")
    return RecipeDuplicatePreflightStoreResult(preflight=stored, state="created")


def _decision_matches(
    decision: RecipeDuplicateDecision,
    *,
    preflight_id: UUID,
    decision_value: str,
    acknowledged_policy_version: str,
    acknowledged_result_digest: str,
) -> bool:
    return (
        decision.preflight_id == preflight_id
        and decision.decision == decision_value
        and decision.acknowledged_policy_version == acknowledged_policy_version
        and decision.acknowledged_result_digest == acknowledged_result_digest
    )


def get_recipe_duplicate_decision_by_preflight(
    session: Session,
    *,
    actor_user_id: UUID,
    preflight_id: UUID,
) -> RecipeDuplicateDecision | None:
    """Read an author decision without revealing another actor's evidence."""

    return session.scalar(
        select(RecipeDuplicateDecision).where(
            RecipeDuplicateDecision.preflight_id == preflight_id,
            RecipeDuplicateDecision.actor_user_id == actor_user_id,
        )
    )


def store_recipe_duplicate_decision(
    session: Session,
    *,
    preflight_id: UUID,
    actor_user_id: UUID,
    action_id: UUID,
    decision: str,
    acknowledged_policy_version: str,
    acknowledged_result_digest: str,
) -> RecipeDuplicateDecisionStoreResult:
    """Record one final advisory choice against an actor-owned preflight."""

    if decision not in RECIPE_DUPLICATE_DECISIONS:
        raise ValueError("Unsupported duplicate preflight decision.")
    preflight = get_recipe_duplicate_preflight_by_id(
        session,
        actor_user_id=actor_user_id,
        preflight_id=preflight_id,
    )
    if preflight is None:
        raise RecipeDuplicatePreflightNotFoundError("Duplicate preflight not found.")
    if (
        acknowledged_policy_version != preflight.policy_version
        or acknowledged_result_digest != preflight.result_digest
    ):
        raise RecipeDuplicateAcknowledgementConflictError(
            "The duplicate preflight acknowledgement is stale."
        )

    existing_for_action = session.scalar(
        select(RecipeDuplicateDecision).where(
            RecipeDuplicateDecision.actor_user_id == actor_user_id,
            RecipeDuplicateDecision.action_id == action_id,
        )
    )
    if existing_for_action is not None:
        if not _decision_matches(
            existing_for_action,
            preflight_id=preflight_id,
            decision_value=decision,
            acknowledged_policy_version=acknowledged_policy_version,
            acknowledged_result_digest=acknowledged_result_digest,
        ):
            raise RecipeDuplicateStorageConflictError(
                "The decision action identifier is already bound to another request."
            )
        return RecipeDuplicateDecisionStoreResult(
            decision=existing_for_action,
            state="reused",
        )

    existing_for_preflight = get_recipe_duplicate_decision_by_preflight(
        session,
        actor_user_id=actor_user_id,
        preflight_id=preflight_id,
    )
    if existing_for_preflight is not None:
        if not _decision_matches(
            existing_for_preflight,
            preflight_id=preflight_id,
            decision_value=decision,
            acknowledged_policy_version=acknowledged_policy_version,
            acknowledged_result_digest=acknowledged_result_digest,
        ):
            raise RecipeDuplicateStorageConflictError(
                "A different decision is already recorded for this preflight."
            )
        return RecipeDuplicateDecisionStoreResult(
            decision=existing_for_preflight,
            state="reused",
        )

    decision_id = uuid4()
    inserted_id = session.scalar(
        postgresql_insert(RecipeDuplicateDecision)
        .values(
            id=decision_id,
            preflight_id=preflight_id,
            actor_user_id=actor_user_id,
            action_id=action_id,
            decision=decision,
            acknowledged_policy_version=acknowledged_policy_version,
            acknowledged_result_digest=acknowledged_result_digest,
        )
        .on_conflict_do_nothing()
        .returning(RecipeDuplicateDecision.id)
    )
    if inserted_id is not None:
        stored = session.get(RecipeDuplicateDecision, inserted_id)
        if stored is None:
            raise RuntimeError("The stored duplicate decision could not be reloaded.")
        return RecipeDuplicateDecisionStoreResult(decision=stored, state="created")

    concurrent = get_recipe_duplicate_decision_by_preflight(
        session,
        actor_user_id=actor_user_id,
        preflight_id=preflight_id,
    )
    if concurrent is None or not _decision_matches(
        concurrent,
        preflight_id=preflight_id,
        decision_value=decision,
        acknowledged_policy_version=acknowledged_policy_version,
        acknowledged_result_digest=acknowledged_result_digest,
    ):
        raise RecipeDuplicateStorageConflictError(
            "Conflicting duplicate decision evidence was stored concurrently."
        )
    return RecipeDuplicateDecisionStoreResult(decision=concurrent, state="reused")
