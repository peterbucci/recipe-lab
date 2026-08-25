from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import Session

import app.services.recipe_duplicate_preflights as preflight_service
from app.models import (
    RecipeDuplicateCandidate,
    RecipeDuplicateDecision,
    RecipeDuplicatePreflight,
    RecipeStructuralFingerprint,
)
from app.repositories.recipe_duplicates import (
    RecipeDuplicateAcknowledgementConflictError,
    RecipeDuplicateCandidateWrite,
    RecipeDuplicateDecisionStoreResult,
    RecipeDuplicatePreflightNotFoundError,
    RecipeDuplicatePreflightStoreResult,
    RecipeDuplicateStorageConflictError,
)
from app.repositories.recipes import PublicRecipeDuplicateCandidate
from app.schemas.recipe_duplicates import RecipeDuplicateDecisionRequest
from app.schemas.recipe_forks import RecipeForkRequest
from app.services.recipe_fingerprints import (
    CanonicalUnit,
    RecipeStructure,
    StructuralAction,
    StructuralFingerprint,
    StructuralIngredient,
    StructuralInstruction,
    StructuralMeasure,
    build_structural_fingerprint,
)
from app.services.recipe_forks import PreparedRecipeFork


def _required(value: StructuralFingerprint | None) -> StructuralFingerprint:
    assert value is not None
    return value


def _structure(
    *,
    ingredient: str = "ingredient-flour",
    amount: str = "100",
    action: str = "mix",
) -> RecipeStructure:
    unit = CanonicalUnit(key="g", dimension="mass", conversion_family="mass-si")
    return RecipeStructure(
        ingredients=(
            StructuralIngredient(
                occurrence_key="flour",
                ingredient_identity=ingredient,
                measure=StructuralMeasure(
                    mode="exact",
                    quantity_min=Decimal(amount),
                    unit=unit,
                ),
            ),
        ),
        instructions=(
            StructuralInstruction(
                actions=(
                    StructuralAction(
                        action_type_key=action,
                        ingredient_occurrence_keys=("flour",),
                    ),
                )
            ),
        ),
    )


def _prepared(source_version_id: UUID, fingerprint: StructuralFingerprint) -> PreparedRecipeFork:
    return PreparedRecipeFork(
        source_version_id=source_version_id,
        lineage_id=uuid4(),
        title="Display-only title does not affect structural identity",
        description="Free-form prose is excluded from duplicate scoring.",
        servings=Decimal("4.00"),
        structure=_structure(),
        structural_fingerprint=fingerprint,
        _ingredient_drafts=(),
        _instruction_drafts=(),
    )


def _payload(*, title: str = "A proposed recipe") -> RecipeForkRequest:
    return RecipeForkRequest(
        title=title,
        description="Human-readable prose.",
        servings=Decimal("4.00"),
        ingredient_edits=[],
        instruction_edits=[],
    )


def _public_candidate(
    recipe_version_id: UUID,
    *,
    title: str,
    fingerprint: StructuralFingerprint,
    digest: str | None = None,
) -> PublicRecipeDuplicateCandidate:
    return PublicRecipeDuplicateCandidate(
        recipe_version_id=recipe_version_id,
        title=title,
        algorithm_version=fingerprint.algorithm_version,
        digest=digest or fingerprint.digest,
        canonical_payload=fingerprint.canonical_json,
    )


def _stored_fingerprint(
    recipe_version_id: UUID,
    fingerprint: StructuralFingerprint,
) -> RecipeStructuralFingerprint:
    return RecipeStructuralFingerprint(
        recipe_version_id=recipe_version_id,
        algorithm_version=fingerprint.algorithm_version,
        digest=fingerprint.digest,
        canonical_payload=fingerprint.canonical_json,
    )


def _install_store(
    monkeypatch: pytest.MonkeyPatch,
    *,
    titles: dict[UUID, str],
    capture: list[RecipeDuplicatePreflight],
) -> None:
    def fake_store(_session: Session, **kwargs: Any) -> RecipeDuplicatePreflightStoreResult:
        preflight_id = uuid4()
        candidate_writes = cast(Sequence[RecipeDuplicateCandidateWrite], kwargs["candidates"])
        preflight = RecipeDuplicatePreflight(
            id=preflight_id,
            actor_user_id=cast(UUID, kwargs["actor_user_id"]),
            action_id=cast(UUID, kwargs["action_id"]),
            request_fingerprint=cast(str, kwargs["request_fingerprint"]),
            source_version_id=cast(UUID | None, kwargs["source_version_id"]),
            subject_fingerprint_algorithm=cast(str, kwargs["subject_fingerprint_algorithm"]),
            subject_fingerprint_digest=cast(str, kwargs["subject_fingerprint_digest"]),
            policy_version=cast(str, kwargs["policy_version"]),
            classification=cast(str, kwargs["classification"]),
            same_parent_no_change=cast(bool, kwargs["same_parent_no_change"]),
            result_digest=cast(str, kwargs["result_digest"]),
        )
        preflight.candidates = [
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
            for candidate in candidate_writes
        ]
        preflight.decision = None
        capture.append(preflight)
        return RecipeDuplicatePreflightStoreResult(preflight=preflight, state="created")

    def fake_titles(_session: Session, ids: set[UUID]) -> dict[UUID, str]:
        return {recipe_id: titles[recipe_id] for recipe_id in ids if recipe_id in titles}

    monkeypatch.setattr(preflight_service, "store_recipe_duplicate_preflight", fake_store)
    monkeypatch.setattr(preflight_service, "get_public_recipe_version_titles", fake_titles)


def _install_creation_dependencies(
    monkeypatch: pytest.MonkeyPatch,
    *,
    prepared: PreparedRecipeFork,
    candidates: list[PublicRecipeDuplicateCandidate],
    source_fingerprint: RecipeStructuralFingerprint | None,
) -> None:
    monkeypatch.setattr(
        preflight_service,
        "get_recipe_duplicate_preflight_by_action",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        preflight_service,
        "prepare_recipe_fork",
        lambda *_args, **_kwargs: prepared,
    )
    monkeypatch.setattr(
        preflight_service,
        "get_recipe_structural_fingerprint",
        lambda *_args, **_kwargs: source_fingerprint,
    )
    monkeypatch.setattr(
        preflight_service,
        "list_public_recipe_duplicate_candidates",
        lambda *_args, **_kwargs: candidates,
    )


def test_exact_preflight_is_bounded_explainable_and_warns_on_parent_no_change(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_id = uuid4()
    actor_id = uuid4()
    fingerprint = _required(build_structural_fingerprint(_structure()))
    candidate_ids = sorted((uuid4() for _ in range(7)), key=str)
    candidates = [
        _public_candidate(
            candidate_id,
            title=f"Public exact candidate {index}",
            fingerprint=fingerprint,
        )
        for index, candidate_id in enumerate(reversed(candidate_ids))
    ]
    prepared = _prepared(source_id, fingerprint)
    _install_creation_dependencies(
        monkeypatch,
        prepared=prepared,
        candidates=candidates,
        source_fingerprint=_stored_fingerprint(source_id, fingerprint),
    )
    capture: list[RecipeDuplicatePreflight] = []
    titles = {source_id: "Direct parent"} | {
        candidate.recipe_version_id: candidate.title for candidate in candidates
    }
    _install_store(monkeypatch, titles=titles, capture=capture)

    result = preflight_service.run_recipe_duplicate_preflight(
        cast(Session, object()),
        source_version_id=source_id,
        actor_user_id=actor_id,
        action_id=uuid4(),
        payload=_payload(),
    )

    assert result.state == "created"
    assert result.response.classification == "exact_duplicate"
    assert result.response.same_lineage_no_change is True
    assert [warning.code for warning in result.response.warnings] == ["same_lineage_no_change"]
    assert len(result.response.candidates) == 5
    assert [candidate.public_recipe_version_id for candidate in result.response.candidates] == (
        candidate_ids[:5]
    )
    assert all(candidate.score == "1.000000" for candidate in result.response.candidates)
    assert all(len(candidate.reasons) <= 3 for candidate in result.response.candidates)
    assert result.response.acknowledgement.required is True
    assert result.response.acknowledgement.allowed_decisions == ["continue", "revise"]
    assert capture[0].source_version_id == source_id
    assert source_id not in {
        candidate.public_recipe_version_id for candidate in capture[0].candidates
    }


@pytest.mark.parametrize(
    ("candidate_fingerprint", "forced_digest", "expected"),
    [
        (
            _required(build_structural_fingerprint(_structure(amount="200"))),
            None,
            "probable_duplicate",
        ),
        (
            _required(
                build_structural_fingerprint(
                    _structure(ingredient="ingredient-water", action="boil")
                )
            ),
            "subject_digest",
            "distinct",
        ),
    ],
)
def test_preflight_classifies_probable_and_confirms_payload_before_exact(
    monkeypatch: pytest.MonkeyPatch,
    candidate_fingerprint: StructuralFingerprint,
    forced_digest: str | None,
    expected: str,
) -> None:
    source_id = uuid4()
    candidate_id = uuid4()
    subject = _required(build_structural_fingerprint(_structure()))
    digest = subject.digest if forced_digest is not None else candidate_fingerprint.digest
    candidate = _public_candidate(
        candidate_id,
        title="Public candidate",
        fingerprint=candidate_fingerprint,
        digest=digest,
    )
    _install_creation_dependencies(
        monkeypatch,
        prepared=_prepared(source_id, subject),
        candidates=[candidate],
        source_fingerprint=None,
    )
    capture: list[RecipeDuplicatePreflight] = []
    _install_store(
        monkeypatch,
        titles={source_id: "Source", candidate_id: candidate.title},
        capture=capture,
    )

    result = preflight_service.run_recipe_duplicate_preflight(
        cast(Session, object()),
        source_version_id=source_id,
        actor_user_id=uuid4(),
        action_id=uuid4(),
        payload=_payload(),
    )

    assert result.response.classification == expected
    if expected == "probable_duplicate":
        assert len(result.response.candidates) == 1
        assert result.response.candidates[0].classification == "probable_duplicate"
        assert result.response.acknowledgement.required is True
    else:
        assert result.response.candidates == []
        assert result.response.acknowledgement.required is False
        assert result.response.acknowledgement.allowed_decisions == []


def test_preflight_replay_is_stable_and_conflicting_key_reuse_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_id = uuid4()
    actor_id = uuid4()
    action_id = uuid4()
    fingerprint = _required(build_structural_fingerprint(_structure()))
    prepared = _prepared(source_id, fingerprint)
    _install_creation_dependencies(
        monkeypatch,
        prepared=prepared,
        candidates=[],
        source_fingerprint=_stored_fingerprint(source_id, fingerprint),
    )
    capture: list[RecipeDuplicatePreflight] = []
    _install_store(
        monkeypatch,
        titles={source_id: "Direct parent"},
        capture=capture,
    )
    first = preflight_service.run_recipe_duplicate_preflight(
        cast(Session, object()),
        source_version_id=source_id,
        actor_user_id=actor_id,
        action_id=action_id,
        payload=_payload(),
    )
    stored = capture[0]
    monkeypatch.setattr(
        preflight_service,
        "get_recipe_duplicate_preflight_by_action",
        lambda *_args, **_kwargs: stored,
    )
    monkeypatch.setattr(
        preflight_service,
        "prepare_recipe_fork",
        cast(Callable[..., PreparedRecipeFork], lambda *_args, **_kwargs: pytest.fail()),
    )

    replay = preflight_service.run_recipe_duplicate_preflight(
        cast(Session, object()),
        source_version_id=source_id,
        actor_user_id=actor_id,
        action_id=action_id,
        payload=_payload(),
    )
    assert replay.state == "reused"
    assert replay.response == first.response

    with pytest.raises(RecipeDuplicateStorageConflictError):
        preflight_service.run_recipe_duplicate_preflight(
            cast(Session, object()),
            source_version_id=source_id,
            actor_user_id=actor_id,
            action_id=action_id,
            payload=_payload(title="A conflicting request"),
        )


def test_unavailable_source_is_rejected_before_preparation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_id = uuid4()
    monkeypatch.setattr(
        preflight_service,
        "get_recipe_duplicate_preflight_by_action",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        preflight_service,
        "get_public_recipe_version_titles",
        lambda *_args, **_kwargs: {},
    )
    monkeypatch.setattr(
        preflight_service,
        "prepare_recipe_fork",
        cast(Callable[..., PreparedRecipeFork], lambda *_args, **_kwargs: pytest.fail()),
    )

    with pytest.raises(preflight_service.RecipeDuplicatePreflightUnavailableError):
        preflight_service.run_recipe_duplicate_preflight(
            cast(Session, object()),
            source_version_id=source_id,
            actor_user_id=uuid4(),
            action_id=uuid4(),
            payload=_payload(),
        )


def test_decision_is_actor_scoped_and_stale_acknowledgement_is_generic(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_id = uuid4()
    actor_id = uuid4()
    fingerprint = _required(build_structural_fingerprint(_structure()))
    prepared = _prepared(source_id, fingerprint)
    _install_creation_dependencies(
        monkeypatch,
        prepared=prepared,
        candidates=[],
        source_fingerprint=_stored_fingerprint(source_id, fingerprint),
    )
    capture: list[RecipeDuplicatePreflight] = []
    _install_store(
        monkeypatch,
        titles={source_id: "Direct parent"},
        capture=capture,
    )
    created = preflight_service.run_recipe_duplicate_preflight(
        cast(Session, object()),
        source_version_id=source_id,
        actor_user_id=actor_id,
        action_id=uuid4(),
        payload=_payload(),
    )
    stored_preflight = capture[0]
    monkeypatch.setattr(
        preflight_service,
        "get_recipe_duplicate_preflight_by_id",
        lambda *_args, **_kwargs: stored_preflight,
    )

    def stale_store(_session: Session, **_kwargs: Any) -> RecipeDuplicateDecisionStoreResult:
        raise RecipeDuplicateAcknowledgementConflictError("stale")

    monkeypatch.setattr(preflight_service, "store_recipe_duplicate_decision", stale_store)
    with pytest.raises(preflight_service.RecipeDuplicatePreflightStaleError):
        preflight_service.record_recipe_duplicate_decision(
            cast(Session, object()),
            preflight_id=stored_preflight.id,
            actor_user_id=actor_id,
            action_id=uuid4(),
            payload=RecipeDuplicateDecisionRequest(
                policy_version=created.response.acknowledgement.policy_version,
                result_digest="f" * 64,
                decision="continue",
            ),
        )

    monkeypatch.setattr(
        preflight_service,
        "get_recipe_duplicate_preflight_by_id",
        lambda *_args, **_kwargs: None,
    )
    with pytest.raises(RecipeDuplicatePreflightNotFoundError):
        preflight_service.record_recipe_duplicate_decision(
            cast(Session, object()),
            preflight_id=stored_preflight.id,
            actor_user_id=uuid4(),
            action_id=uuid4(),
            payload=RecipeDuplicateDecisionRequest(
                policy_version=created.response.acknowledgement.policy_version,
                result_digest=created.response.acknowledgement.result_digest,
                decision="revise",
            ),
        )


def test_current_decision_returns_immutable_audit_timestamp(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_id = uuid4()
    actor_id = uuid4()
    fingerprint = _required(build_structural_fingerprint(_structure()))
    prepared = _prepared(source_id, fingerprint)
    _install_creation_dependencies(
        monkeypatch,
        prepared=prepared,
        candidates=[],
        source_fingerprint=_stored_fingerprint(source_id, fingerprint),
    )
    capture: list[RecipeDuplicatePreflight] = []
    _install_store(
        monkeypatch,
        titles={source_id: "Direct parent"},
        capture=capture,
    )
    created = preflight_service.run_recipe_duplicate_preflight(
        cast(Session, object()),
        source_version_id=source_id,
        actor_user_id=actor_id,
        action_id=uuid4(),
        payload=_payload(),
    )
    preflight = capture[0]
    monkeypatch.setattr(
        preflight_service,
        "get_recipe_duplicate_preflight_by_id",
        lambda *_args, **_kwargs: preflight,
    )
    recorded_at = datetime(2026, 8, 25, tzinfo=UTC)

    def store_decision(_session: Session, **kwargs: Any) -> RecipeDuplicateDecisionStoreResult:
        decision = RecipeDuplicateDecision(
            id=uuid4(),
            preflight_id=cast(UUID, kwargs["preflight_id"]),
            actor_user_id=cast(UUID, kwargs["actor_user_id"]),
            action_id=cast(UUID, kwargs["action_id"]),
            decision=cast(str, kwargs["decision"]),
            acknowledged_policy_version=cast(str, kwargs["acknowledged_policy_version"]),
            acknowledged_result_digest=cast(str, kwargs["acknowledged_result_digest"]),
            created_at=recorded_at,
        )
        return RecipeDuplicateDecisionStoreResult(decision=decision, state="created")

    monkeypatch.setattr(
        preflight_service,
        "store_recipe_duplicate_decision",
        store_decision,
    )
    result = preflight_service.record_recipe_duplicate_decision(
        cast(Session, object()),
        preflight_id=preflight.id,
        actor_user_id=actor_id,
        action_id=uuid4(),
        payload=RecipeDuplicateDecisionRequest(
            policy_version=created.response.acknowledgement.policy_version,
            result_digest=created.response.acknowledgement.result_digest,
            decision="revise",
        ),
    )

    assert result.state == "created"
    assert result.response.preflight_id == preflight.id
    assert result.response.decision == "revise"
    assert result.response.recorded_at == recorded_at
