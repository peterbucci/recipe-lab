"""Member-scoped, advisory duplicate preflight orchestration.

The service prepares a variant without inserting it, compares only its canonical
structure with publicly readable immutable recipe snapshots, and stores a bounded
audit record. It never writes recommendation signals or changes publication state.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from fractions import Fraction
from typing import cast
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import (
    RECIPE_DUPLICATE_DISTINCT,
    RECIPE_DUPLICATE_EXACT,
    RECIPE_DUPLICATE_PROBABLE,
    RecipeDuplicateCandidate,
    RecipeDuplicateDecision,
    RecipeDuplicatePreflight,
)
from app.repositories.recipe_duplicates import (
    RecipeDuplicateAcknowledgementConflictError,
    RecipeDuplicateCandidateWrite,
    RecipeDuplicateDecisionStoreResult,
    RecipeDuplicatePreflightNotFoundError,
    RecipeDuplicatePreflightStoreResult,
    RecipeDuplicateStorageConflictError,
    get_recipe_duplicate_preflight_by_action,
    get_recipe_duplicate_preflight_by_id,
    store_recipe_duplicate_decision,
    store_recipe_duplicate_preflight,
)
from app.repositories.recipe_fingerprints import get_recipe_structural_fingerprint
from app.repositories.recipes import (
    PublicRecipeDuplicateCandidate,
    get_public_recipe_version_titles,
    list_public_recipe_duplicate_candidates,
)
from app.schemas.recipe_duplicates import (
    DuplicateCandidateClassification,
    DuplicateClassification,
    DuplicateDecision,
    RecipeDuplicateAcknowledgementResponse,
    RecipeDuplicateCandidateResponse,
    RecipeDuplicateDecisionRequest,
    RecipeDuplicateDecisionResponse,
    RecipeDuplicatePreflightResponse,
    RecipeDuplicateReasonResponse,
    RecipeDuplicateWarningResponse,
)
from app.schemas.recipe_forks import RecipeForkRequest
from app.services.preference_events import recipe_fork_request_fingerprint
from app.services.recipe_duplicate_scoring import (
    DUPLICATE_CANDIDATE_PARAMETER_HASH,
    DUPLICATE_CANDIDATE_SCORING_ALGORITHM_VERSION,
    DUPLICATE_PAIR_WORK_ESTIMATE,
    MAX_DUPLICATE_ACTIONS,
    MAX_DUPLICATE_FLATTENED_INPUTS,
    MAX_DUPLICATE_INGREDIENT_OCCURRENCES,
    MAX_DUPLICATE_PAIR_WORK_UNITS,
    MAX_DUPLICATE_REASONS,
    DuplicateCandidateFingerprint,
    DuplicateCandidateReason,
    InvalidRecipeStructurePayloadError,
    RecipeDuplicateScoringCapacityError,
    UnsupportedRecipeStructureVersionError,
    estimate_recipe_duplicate_pair_work,
    get_recipe_duplicate_scoring_shape,
    recipe_duplicate_fingerprints_are_exact,
    score_recipe_duplicate_candidates,
)
from app.services.recipe_fingerprints import (
    STRUCTURAL_FINGERPRINT_ALGORITHM_VERSION,
    StructuralFingerprint,
)
from app.services.recipe_forks import prepare_recipe_fork

RECIPE_DUPLICATE_POLICY_VERSION = "recipe-duplicate-preflight-policy-v1"
RECIPE_DUPLICATE_RESULT_SCHEMA = "recipe-lab.recipe-duplicate-preflight-result"
RECIPE_DUPLICATE_RESULT_VERSION = 1
MAX_PUBLIC_DUPLICATE_CANDIDATES = 5
MAX_PUBLIC_DUPLICATE_COMPARISONS = 500
MAX_PREFLIGHT_DUPLICATE_WORK_UNITS = MAX_DUPLICATE_PAIR_WORK_UNITS
SAME_LINEAGE_NO_CHANGE_MESSAGE = (
    "This version has the same canonical structure as its direct parent."
)

_POLICY_PARAMETER_PAYLOAD: dict[str, object] = {
    "candidate_selection": {
        "maximum_candidates": MAX_PUBLIC_DUPLICATE_CANDIDATES,
        "ranking": [
            "exact_classification_first",
            "descending_exact_rational_score",
            "ascending_public_recipe_version_uuid",
        ],
        "source_recipe_version": {
            "optional": True,
            "when_absent": "no_candidate_is_excluded_as_source",
            "when_present": (
                "publicly_rechecked_excluded_from_results_and_scored_as_direct_parent"
            ),
        },
        "visibility": "publicly_readable_recipe_versions_only",
    },
    "classification_priority": [
        "same_parent_no_change_or_exact_candidate",
        "probable_candidate",
        "distinct",
    ],
    "direct_parent_no_change": {
        "classification": RECIPE_DUPLICATE_EXACT,
        "condition": "same_versioned_fingerprint_digest_and_canonical_payload",
        "requires_acknowledgement": True,
        "warning_code": "same_lineage_no_change",
    },
    "maximum_reasons_per_candidate": MAX_DUPLICATE_REASONS,
    "policy_version": RECIPE_DUPLICATE_POLICY_VERSION,
    "scorer": {
        "algorithm_version": DUPLICATE_CANDIDATE_SCORING_ALGORITHM_VERSION,
        "parameter_hash": DUPLICATE_CANDIDATE_PARAMETER_HASH,
    },
    "work_budget": {
        "candidate_comparisons": MAX_PUBLIC_DUPLICATE_COMPARISONS,
        "maximum_actions_per_structure": MAX_DUPLICATE_ACTIONS,
        "maximum_flattened_inputs_per_structure": MAX_DUPLICATE_FLATTENED_INPUTS,
        "maximum_ingredient_occurrences_per_structure": (MAX_DUPLICATE_INGREDIENT_OCCURRENCES),
        "maximum_total_nonexact_pair_work_units": MAX_PREFLIGHT_DUPLICATE_WORK_UNITS,
        "overflow_behavior": "fail_closed_without_partial_results",
        "pair_work_estimate": DUPLICATE_PAIR_WORK_ESTIMATE,
        "rationale": (
            "The total bound conservatively covers quantity-scale scans and LCS cells "
            "for every non-exact pair before any pair is scored."
        ),
    },
}
RECIPE_DUPLICATE_POLICY_PARAMETER_DOCUMENT = json.dumps(
    _POLICY_PARAMETER_PAYLOAD,
    allow_nan=False,
    ensure_ascii=False,
    separators=(",", ":"),
    sort_keys=True,
)
RECIPE_DUPLICATE_POLICY_PARAMETER_HASH = hashlib.sha256(
    RECIPE_DUPLICATE_POLICY_PARAMETER_DOCUMENT.encode("utf-8")
).hexdigest()

_REASON_MESSAGES: dict[str, str] = {
    "exact_structural_match": "The complete canonical recipe structure matches exactly.",
    "same_ingredient_multiset": (
        "The same canonical ingredients occur with the same multiplicity."
    ),
    "overlapping_ingredient_multisets": ("The recipes share canonical ingredient occurrences."),
    "different_ingredient_multisets": "The canonical ingredient multisets differ.",
    "proportionally_scaled_quantities": (
        "All matched ingredient quantities use one consistent proportional scale."
    ),
    "matching_quantities": "Canonical ingredient quantities match at the same scale.",
    "partially_matching_quantities": ("Some canonical ingredient quantities match consistently."),
    "different_quantities": "Canonical ingredient quantities do not match consistently.",
    "matching_structured_actions": (
        "Structured actions, inputs, durations, and temperatures match."
    ),
    "different_action_types": "One or more structured cooking-action types differ.",
    "different_action_order": "The structured cooking-action order differs.",
    "different_ordered_inputs": ("The ordered canonical inputs to cooking actions differ."),
    "different_duration_or_temperature": "A structured duration or temperature differs.",
}


class RecipeDuplicatePreflightUnavailableError(LookupError):
    """Raised when a source recipe is not publicly readable."""


class RecipeDuplicatePreflightStaleError(RuntimeError):
    """Raised generically for stale acknowledgement or unavailable result evidence."""


class RecipeDuplicateDecisionNotRequiredError(RuntimeError):
    """Raised when a distinct result has no advisory acknowledgement to record."""


class RecipeDuplicateDecisionRequiredError(RuntimeError):
    """Raised when duplicate candidates were not explicitly accepted."""


class RecipeDuplicatePreflightCapacityError(RuntimeError):
    """Raised generically when fixed duplicate-scoring work limits are exceeded."""


@dataclass(frozen=True, slots=True)
class RecipeDuplicatePreflightServiceResult:
    response: RecipeDuplicatePreflightResponse
    state: str


@dataclass(frozen=True, slots=True)
class RecipeDuplicateDecisionServiceResult:
    response: RecipeDuplicateDecisionResponse
    state: str


@dataclass(frozen=True, slots=True)
class _RankedCandidate:
    recipe_version_id: UUID
    title: str
    classification: str
    score: Fraction
    score_basis_points: int
    reasons: tuple[DuplicateCandidateReason, ...]
    exact_payload_confirmed: bool


def _candidate_fingerprint(
    candidate: PublicRecipeDuplicateCandidate,
) -> DuplicateCandidateFingerprint:
    return DuplicateCandidateFingerprint(
        algorithm_version=candidate.algorithm_version,
        digest=candidate.digest,
        canonical_json=candidate.canonical_payload,
    )


def _basis_points(score: Fraction) -> int:
    """Round exact rational similarity to the nearest basis point."""

    return min(10_000, max(0, int(score * 10_000 + Fraction(1, 2))))


def _score_text(score_basis_points: int) -> str:
    integer, fractional = divmod(score_basis_points, 10_000)
    return f"{integer}.{fractional * 100:06d}"


def _rank_candidates(
    session: Session,
    *,
    subject: StructuralFingerprint,
    source_version_id: UUID | None,
) -> tuple[list[_RankedCandidate], bool]:
    same_parent_no_change = False
    source_fingerprint = (
        get_recipe_structural_fingerprint(
            session,
            recipe_version_id=source_version_id,
            algorithm_version=subject.algorithm_version,
        )
        if source_version_id is not None
        else None
    )
    try:
        subject_input = DuplicateCandidateFingerprint.from_structural_fingerprint(subject)
        subject_shape = get_recipe_duplicate_scoring_shape(subject_input)
        public_candidates = list_public_recipe_duplicate_candidates(
            session,
            algorithm_version=subject.algorithm_version,
            comparison_limit=MAX_PUBLIC_DUPLICATE_COMPARISONS + 1,
            exclude_recipe_version_id=source_version_id,
        )
        if len(public_candidates) > MAX_PUBLIC_DUPLICATE_COMPARISONS:
            raise RecipeDuplicatePreflightCapacityError(
                "Duplicate preflight is temporarily unavailable."
            )

        parent_input = (
            DuplicateCandidateFingerprint(
                algorithm_version=source_fingerprint.algorithm_version,
                digest=source_fingerprint.digest,
                canonical_json=source_fingerprint.canonical_payload,
            )
            if source_fingerprint is not None
            else None
        )
        candidate_inputs = [
            (candidate, _candidate_fingerprint(candidate)) for candidate in public_candidates
        ]
        total_work = 0
        for other_input in [
            *([parent_input] if parent_input is not None else []),
            *(candidate_input for _, candidate_input in candidate_inputs),
        ]:
            other_shape = get_recipe_duplicate_scoring_shape(other_input)
            if recipe_duplicate_fingerprints_are_exact(subject_input, other_input):
                continue
            total_work += estimate_recipe_duplicate_pair_work(subject_shape, other_shape)
            if total_work > MAX_PREFLIGHT_DUPLICATE_WORK_UNITS:
                raise RecipeDuplicatePreflightCapacityError(
                    "Duplicate preflight is temporarily unavailable."
                )

        if parent_input is not None:
            parent_score = score_recipe_duplicate_candidates(subject_input, parent_input)
            same_parent_no_change = parent_score.classification == RECIPE_DUPLICATE_EXACT

        ranked: list[_RankedCandidate] = []
        for candidate, candidate_input in candidate_inputs:
            score = score_recipe_duplicate_candidates(subject_input, candidate_input)
            if score.classification == RECIPE_DUPLICATE_DISTINCT:
                continue
            ranked.append(
                _RankedCandidate(
                    recipe_version_id=candidate.recipe_version_id,
                    title=candidate.title,
                    classification=score.classification,
                    score=score.score,
                    score_basis_points=_basis_points(score.score),
                    reasons=score.reasons,
                    exact_payload_confirmed=score.exact_match,
                )
            )
    except RecipeDuplicateScoringCapacityError as error:
        raise RecipeDuplicatePreflightCapacityError(
            "Duplicate preflight is temporarily unavailable."
        ) from error
    except (InvalidRecipeStructurePayloadError, UnsupportedRecipeStructureVersionError) as error:
        raise RuntimeError("Stored public recipe structure cannot be scored safely.") from error

    ranked.sort(
        key=lambda candidate: (
            0 if candidate.classification == RECIPE_DUPLICATE_EXACT else 1,
            -candidate.score,
            str(candidate.recipe_version_id),
        )
    )
    return ranked[:MAX_PUBLIC_DUPLICATE_CANDIDATES], same_parent_no_change


def _classification(
    candidates: list[_RankedCandidate],
    *,
    same_parent_no_change: bool,
) -> str:
    if same_parent_no_change or any(
        candidate.classification == RECIPE_DUPLICATE_EXACT for candidate in candidates
    ):
        return RECIPE_DUPLICATE_EXACT
    if candidates:
        return RECIPE_DUPLICATE_PROBABLE
    return RECIPE_DUPLICATE_DISTINCT


def _result_document(
    *,
    source_version_id: UUID | None,
    subject_algorithm: str,
    subject_digest: str,
    classification: str,
    same_parent_no_change: bool,
    candidates: list[dict[str, object]],
) -> dict[str, object]:
    return {
        "candidates": candidates,
        "classification": classification,
        "parameter_hash": DUPLICATE_CANDIDATE_PARAMETER_HASH,
        "policy_parameter_hash": RECIPE_DUPLICATE_POLICY_PARAMETER_HASH,
        "policy_version": RECIPE_DUPLICATE_POLICY_VERSION,
        "same_parent_no_change": same_parent_no_change,
        "schema": RECIPE_DUPLICATE_RESULT_SCHEMA,
        "source_version_id": str(source_version_id) if source_version_id is not None else None,
        "subject": {
            "algorithm_version": subject_algorithm,
            "digest": subject_digest,
        },
        "version": RECIPE_DUPLICATE_RESULT_VERSION,
    }


def _result_digest(document: dict[str, object]) -> str:
    encoded = json.dumps(
        document,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _computed_candidate_document(candidate: _RankedCandidate) -> dict[str, object]:
    return {
        "classification": candidate.classification,
        "exact_payload_confirmed": candidate.exact_payload_confirmed,
        "public_recipe_version_id": str(candidate.recipe_version_id),
        "reason_codes": [reason.code for reason in candidate.reasons],
        "score_basis_points": candidate.score_basis_points,
    }


def _stored_candidate_document(candidate: RecipeDuplicateCandidate) -> dict[str, object]:
    return {
        "classification": candidate.classification,
        "exact_payload_confirmed": candidate.exact_payload_confirmed,
        "public_recipe_version_id": str(candidate.public_recipe_version_id),
        "reason_codes": list(candidate.reason_codes),
        "score_basis_points": candidate.score_basis_points,
    }


def _stored_result_is_current(preflight: RecipeDuplicatePreflight) -> bool:
    if (
        preflight.policy_version != RECIPE_DUPLICATE_POLICY_VERSION
        or preflight.subject_fingerprint_algorithm != STRUCTURAL_FINGERPRINT_ALGORITHM_VERSION
    ):
        return False
    document = _result_document(
        source_version_id=preflight.source_version_id,
        subject_algorithm=preflight.subject_fingerprint_algorithm,
        subject_digest=preflight.subject_fingerprint_digest,
        classification=preflight.classification,
        same_parent_no_change=preflight.same_parent_no_change,
        candidates=[
            _stored_candidate_document(candidate)
            for candidate in sorted(preflight.candidates, key=lambda candidate: candidate.rank)
        ],
    )
    return _result_digest(document) == preflight.result_digest


def _reason_response(code: str) -> RecipeDuplicateReasonResponse:
    message = _REASON_MESSAGES.get(code)
    if message is None:
        raise RecipeDuplicatePreflightStaleError("Duplicate preflight is no longer current.")
    return RecipeDuplicateReasonResponse(code=code, message=message)


def _response_from_stored(
    session: Session,
    preflight: RecipeDuplicatePreflight,
) -> RecipeDuplicatePreflightResponse:
    if not _stored_result_is_current(preflight):
        raise RecipeDuplicatePreflightStaleError("Duplicate preflight is no longer current.")

    candidate_ids = {candidate.public_recipe_version_id for candidate in preflight.candidates}
    required_public_ids = set(candidate_ids)
    if preflight.source_version_id is not None:
        required_public_ids.add(preflight.source_version_id)
    titles = get_public_recipe_version_titles(session, required_public_ids)
    if preflight.source_version_id is not None and preflight.source_version_id not in titles:
        raise RecipeDuplicatePreflightUnavailableError("Public recipe not found.")
    if set(titles) != required_public_ids:
        raise RecipeDuplicatePreflightStaleError("Duplicate preflight is no longer current.")

    candidates = [
        RecipeDuplicateCandidateResponse(
            public_recipe_version_id=candidate.public_recipe_version_id,
            title=titles[candidate.public_recipe_version_id],
            classification=cast(DuplicateCandidateClassification, candidate.classification),
            score=_score_text(candidate.score_basis_points),
            reasons=[_reason_response(code) for code in candidate.reason_codes],
        )
        for candidate in sorted(preflight.candidates, key=lambda candidate: candidate.rank)
    ]
    acknowledgement_required = preflight.classification != RECIPE_DUPLICATE_DISTINCT
    return RecipeDuplicatePreflightResponse(
        classification=cast(DuplicateClassification, preflight.classification),
        same_lineage_no_change=preflight.same_parent_no_change,
        candidates=candidates,
        warnings=(
            [
                RecipeDuplicateWarningResponse(
                    code="same_lineage_no_change",
                    message=SAME_LINEAGE_NO_CHANGE_MESSAGE,
                )
            ]
            if preflight.same_parent_no_change
            else []
        ),
        acknowledgement=RecipeDuplicateAcknowledgementResponse(
            preflight_id=preflight.id,
            policy_version=preflight.policy_version,
            result_digest=preflight.result_digest,
            required=acknowledgement_required,
            allowed_decisions=(["continue", "revise"] if acknowledgement_required else []),
        ),
    )


def _replay_recipe_duplicate_preflight(
    session: Session,
    *,
    actor_user_id: UUID,
    action_id: UUID,
    request_fingerprint: str,
    subject_fingerprint: StructuralFingerprint | None = None,
    source_version_id: UUID | None = None,
) -> RecipeDuplicatePreflightServiceResult | None:
    replay = get_recipe_duplicate_preflight_by_action(
        session,
        actor_user_id=actor_user_id,
        action_id=action_id,
    )
    if replay is not None:
        if replay.request_fingerprint != request_fingerprint or (
            subject_fingerprint is not None
            and (
                replay.source_version_id != source_version_id
                or replay.subject_fingerprint_algorithm != subject_fingerprint.algorithm_version
                or replay.subject_fingerprint_digest != subject_fingerprint.digest
            )
        ):
            raise RecipeDuplicateStorageConflictError(
                "The preflight action identifier is already bound to another request."
            )
        return RecipeDuplicatePreflightServiceResult(
            response=_response_from_stored(session, replay),
            state="reused",
        )
    return None


def run_structural_recipe_duplicate_preflight(
    session: Session,
    *,
    subject_fingerprint: StructuralFingerprint,
    source_version_id: UUID | None,
    actor_user_id: UUID,
    action_id: UUID,
    request_fingerprint: str,
) -> RecipeDuplicatePreflightServiceResult:
    """Rank and persist one source-optional structural duplicate preflight.

    Original-recipe creation passes no source. Fork publication passes the direct
    parent so the same core also enforces public visibility, source exclusion, and
    the lineage no-change warning.
    """

    replay = _replay_recipe_duplicate_preflight(
        session,
        actor_user_id=actor_user_id,
        action_id=action_id,
        request_fingerprint=request_fingerprint,
        subject_fingerprint=subject_fingerprint,
        source_version_id=source_version_id,
    )
    if replay is not None:
        return replay

    if source_version_id is not None and source_version_id not in (
        get_public_recipe_version_titles(session, {source_version_id})
    ):
        raise RecipeDuplicatePreflightUnavailableError("Public recipe not found.")

    candidates, same_parent_no_change = _rank_candidates(
        session,
        subject=subject_fingerprint,
        source_version_id=source_version_id,
    )
    classification = _classification(
        candidates,
        same_parent_no_change=same_parent_no_change,
    )
    candidate_document = [_computed_candidate_document(candidate) for candidate in candidates]
    result_digest = _result_digest(
        _result_document(
            source_version_id=source_version_id,
            subject_algorithm=subject_fingerprint.algorithm_version,
            subject_digest=subject_fingerprint.digest,
            classification=classification,
            same_parent_no_change=same_parent_no_change,
            candidates=candidate_document,
        )
    )
    stored: RecipeDuplicatePreflightStoreResult = store_recipe_duplicate_preflight(
        session,
        actor_user_id=actor_user_id,
        action_id=action_id,
        request_fingerprint=request_fingerprint,
        source_version_id=source_version_id,
        subject_fingerprint_algorithm=subject_fingerprint.algorithm_version,
        subject_fingerprint_digest=subject_fingerprint.digest,
        policy_version=RECIPE_DUPLICATE_POLICY_VERSION,
        classification=classification,
        same_parent_no_change=same_parent_no_change,
        result_digest=result_digest,
        candidates=[
            RecipeDuplicateCandidateWrite(
                public_recipe_version_id=candidate.recipe_version_id,
                rank=rank,
                classification=candidate.classification,
                score_basis_points=candidate.score_basis_points,
                reason_codes=tuple(reason.code for reason in candidate.reasons),
                fingerprint_algorithm_version=subject_fingerprint.algorithm_version,
                policy_version=RECIPE_DUPLICATE_POLICY_VERSION,
                exact_payload_confirmed=candidate.exact_payload_confirmed,
            )
            for rank, candidate in enumerate(candidates, start=1)
        ],
    )
    return RecipeDuplicatePreflightServiceResult(
        response=_response_from_stored(session, stored.preflight),
        state=stored.state,
    )


def revalidate_recipe_duplicate_publication_evidence(
    session: Session,
    *,
    preflight_id: UUID,
    actor_user_id: UUID,
    request_fingerprint: str,
    subject_fingerprint: StructuralFingerprint,
    source_version_id: UUID | None,
    acknowledged_policy_version: str,
    acknowledged_result_digest: str,
    decision: str | None,
    decision_action_id: UUID,
) -> tuple[RecipeDuplicatePreflight, RecipeDuplicateDecision | None]:
    """Recompute source-aware evidence and bind any continue decision for publication."""

    preflight = get_recipe_duplicate_preflight_by_id(
        session,
        actor_user_id=actor_user_id,
        preflight_id=preflight_id,
    )
    if preflight is None:
        raise RecipeDuplicatePreflightNotFoundError("Duplicate preflight not found.")
    if (
        preflight.source_version_id != source_version_id
        or preflight.request_fingerprint != request_fingerprint
        or preflight.subject_fingerprint_algorithm != subject_fingerprint.algorithm_version
        or preflight.subject_fingerprint_digest != subject_fingerprint.digest
        or preflight.policy_version != acknowledged_policy_version
        or preflight.result_digest != acknowledged_result_digest
    ):
        raise RecipeDuplicatePreflightStaleError("Duplicate preflight is no longer current.")
    if source_version_id is not None and source_version_id not in (
        get_public_recipe_version_titles(session, {source_version_id})
    ):
        raise RecipeDuplicatePreflightUnavailableError("Public recipe not found.")

    candidates, same_parent_no_change = _rank_candidates(
        session,
        subject=subject_fingerprint,
        source_version_id=source_version_id,
    )
    classification = _classification(
        candidates,
        same_parent_no_change=same_parent_no_change,
    )
    current_result_digest = _result_digest(
        _result_document(
            source_version_id=source_version_id,
            subject_algorithm=subject_fingerprint.algorithm_version,
            subject_digest=subject_fingerprint.digest,
            classification=classification,
            same_parent_no_change=same_parent_no_change,
            candidates=[_computed_candidate_document(candidate) for candidate in candidates],
        )
    )
    if (
        classification != preflight.classification
        or same_parent_no_change != preflight.same_parent_no_change
        or current_result_digest != preflight.result_digest
    ):
        raise RecipeDuplicatePreflightStaleError("Duplicate preflight is no longer current.")
    _response_from_stored(session, preflight)

    if classification == RECIPE_DUPLICATE_DISTINCT:
        if decision is not None:
            raise RecipeDuplicateDecisionNotRequiredError(
                "A distinct result does not accept an author decision."
            )
        return preflight, None
    if decision != "continue":
        raise RecipeDuplicateDecisionRequiredError(
            "Duplicate candidates require an explicit continue decision."
        )
    try:
        stored = store_recipe_duplicate_decision(
            session,
            preflight_id=preflight.id,
            actor_user_id=actor_user_id,
            action_id=decision_action_id,
            decision="continue",
            acknowledged_policy_version=acknowledged_policy_version,
            acknowledged_result_digest=acknowledged_result_digest,
        )
    except RecipeDuplicateAcknowledgementConflictError as error:
        raise RecipeDuplicatePreflightStaleError(
            "Duplicate preflight is no longer current."
        ) from error
    return preflight, stored.decision


def run_recipe_duplicate_preflight(
    session: Session,
    *,
    source_version_id: UUID,
    actor_user_id: UUID,
    action_id: UUID,
    payload: RecipeForkRequest,
) -> RecipeDuplicatePreflightServiceResult:
    """Adapt a proposed fork into the source-optional structural preflight core."""

    request_fingerprint = recipe_fork_request_fingerprint(source_version_id, payload)
    replay = _replay_recipe_duplicate_preflight(
        session,
        actor_user_id=actor_user_id,
        action_id=action_id,
        request_fingerprint=request_fingerprint,
    )
    if replay is not None:
        return replay

    if source_version_id not in get_public_recipe_version_titles(
        session,
        {source_version_id},
    ):
        raise RecipeDuplicatePreflightUnavailableError("Public recipe not found.")

    prepared = prepare_recipe_fork(
        session,
        source_version_id=source_version_id,
        payload=payload,
    )
    if prepared is None:
        raise RecipeDuplicatePreflightUnavailableError("Public recipe not found.")

    return run_structural_recipe_duplicate_preflight(
        session,
        subject_fingerprint=prepared.structural_fingerprint,
        source_version_id=source_version_id,
        actor_user_id=actor_user_id,
        action_id=action_id,
        request_fingerprint=request_fingerprint,
    )


def record_recipe_duplicate_decision(
    session: Session,
    *,
    preflight_id: UUID,
    actor_user_id: UUID,
    action_id: UUID,
    payload: RecipeDuplicateDecisionRequest,
) -> RecipeDuplicateDecisionServiceResult:
    """Record an advisory author choice against current actor-owned evidence."""

    preflight = get_recipe_duplicate_preflight_by_id(
        session,
        actor_user_id=actor_user_id,
        preflight_id=preflight_id,
    )
    if preflight is None:
        raise RecipeDuplicatePreflightNotFoundError("Duplicate preflight not found.")

    response = _response_from_stored(session, preflight)
    if not response.acknowledgement.required:
        raise RecipeDuplicateDecisionNotRequiredError(
            "A distinct result does not require an author decision."
        )
    try:
        stored: RecipeDuplicateDecisionStoreResult = store_recipe_duplicate_decision(
            session,
            preflight_id=preflight_id,
            actor_user_id=actor_user_id,
            action_id=action_id,
            decision=payload.decision,
            acknowledged_policy_version=payload.policy_version,
            acknowledged_result_digest=payload.result_digest,
        )
    except RecipeDuplicateAcknowledgementConflictError as error:
        raise RecipeDuplicatePreflightStaleError(
            "Duplicate preflight is no longer current."
        ) from error

    return RecipeDuplicateDecisionServiceResult(
        response=RecipeDuplicateDecisionResponse(
            preflight_id=preflight_id,
            decision=cast(DuplicateDecision, stored.decision.decision),
            recorded_at=stored.decision.created_at,
        ),
        state=stored.state,
    )
