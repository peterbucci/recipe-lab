import json
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from decimal import Decimal
from hashlib import sha256
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
from app.services.recipe_duplicate_scoring import DUPLICATE_CANDIDATE_PARAMETER_HASH
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


def test_preflight_policy_contract_versions_selection_and_work_limits() -> None:
    payload = json.loads(preflight_service.RECIPE_DUPLICATE_POLICY_PARAMETER_DOCUMENT)

    assert preflight_service.RECIPE_DUPLICATE_POLICY_VERSION == (
        "recipe-duplicate-preflight-policy-v1"
    )
    assert payload["scorer"] == {
        "algorithm_version": "duplicate-candidate-similarity-v1",
        "parameter_hash": DUPLICATE_CANDIDATE_PARAMETER_HASH,
    }
    assert payload["candidate_selection"] == {
        "maximum_candidates": 5,
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
    }
    assert payload["work_budget"] == {
        "candidate_comparisons": 500,
        "maximum_actions_per_structure": 500,
        "maximum_flattened_inputs_per_structure": 2_000,
        "maximum_ingredient_occurrences_per_structure": 200,
        "maximum_total_nonexact_pair_work_units": 10_000_000,
        "overflow_behavior": "fail_closed_without_partial_results",
        "pair_work_estimate": (
            "(1 + 2 * left_ingredients * right_ingredients) * "
            "(left_ingredients + right_ingredients) + "
            "2 * left_actions * right_actions + left_inputs * right_inputs"
        ),
        "rationale": (
            "The total bound conservatively covers quantity-scale scans and LCS cells "
            "for every non-exact pair before any pair is scored."
        ),
    }
    assert (
        sha256(
            preflight_service.RECIPE_DUPLICATE_POLICY_PARAMETER_DOCUMENT.encode("utf-8")
        ).hexdigest()
        == preflight_service.RECIPE_DUPLICATE_POLICY_PARAMETER_HASH
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


def test_preflight_fails_closed_before_scoring_an_over_capacity_public_catalog(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_id = uuid4()
    fingerprint = _required(build_structural_fingerprint(_structure()))
    candidates = [
        _public_candidate(
            uuid4(),
            title="Bounded public candidate",
            fingerprint=fingerprint,
        )
        for _ in range(preflight_service.MAX_PUBLIC_DUPLICATE_COMPARISONS + 1)
    ]
    _install_creation_dependencies(
        monkeypatch,
        prepared=_prepared(source_id, fingerprint),
        candidates=candidates,
        source_fingerprint=None,
    )
    monkeypatch.setattr(
        preflight_service,
        "get_public_recipe_version_titles",
        lambda _session, ids: {source_id: "Source"} if source_id in ids else {},
    )
    monkeypatch.setattr(
        preflight_service,
        "score_recipe_duplicate_candidates",
        lambda *_args, **_kwargs: pytest.fail("capacity must be checked before pair scoring"),
    )

    with pytest.raises(
        preflight_service.RecipeDuplicatePreflightCapacityError,
        match="temporarily unavailable",
    ):
        preflight_service.run_recipe_duplicate_preflight(
            cast(Session, object()),
            source_version_id=source_id,
            actor_user_id=uuid4(),
            action_id=uuid4(),
            payload=_payload(),
        )


def test_preflight_fails_closed_when_aggregate_pair_work_exceeds_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_id = uuid4()
    unit = CanonicalUnit(key="g", dimension="mass", conversion_family="mass-si")
    ingredients = tuple(
        StructuralIngredient(
            occurrence_key=f"work-{index}",
            ingredient_identity=f"ingredient-{index}",
            measure=StructuralMeasure(mode="exact", quantity_min=Decimal(1), unit=unit),
        )
        for index in range(100)
    )

    def work_fingerprint(action_type: str) -> StructuralFingerprint:
        actions = tuple(
            StructuralAction(
                action_type_key=action_type,
                ingredient_occurrence_keys=tuple(
                    ingredient.occurrence_key
                    for ingredient in ingredients
                    if ingredient.occurrence_key is not None
                ),
            )
            for _ in range(20)
        )
        return _required(
            build_structural_fingerprint(
                RecipeStructure(
                    ingredients=ingredients,
                    instructions=(StructuralInstruction(actions=actions),),
                )
            )
        )

    subject = work_fingerprint("mix")
    candidate_fingerprint = work_fingerprint("knead")
    candidates = [
        _public_candidate(
            uuid4(),
            title="Bounded but collectively expensive candidate",
            fingerprint=candidate_fingerprint,
        )
        for _ in range(2)
    ]
    _install_creation_dependencies(
        monkeypatch,
        prepared=_prepared(source_id, subject),
        candidates=candidates,
        source_fingerprint=None,
    )
    monkeypatch.setattr(
        preflight_service,
        "get_public_recipe_version_titles",
        lambda _session, ids: {source_id: "Source"} if source_id in ids else {},
    )
    monkeypatch.setattr(
        preflight_service,
        "score_recipe_duplicate_candidates",
        lambda *_args, **_kwargs: pytest.fail("aggregate work must be checked before pair scoring"),
    )

    with pytest.raises(preflight_service.RecipeDuplicatePreflightCapacityError):
        preflight_service.run_recipe_duplicate_preflight(
            cast(Session, object()),
            source_version_id=source_id,
            actor_user_id=uuid4(),
            action_id=uuid4(),
            payload=_payload(),
        )


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


@pytest.mark.parametrize(
    ("candidate_fingerprint", "expected"),
    [
        (_required(build_structural_fingerprint(_structure())), "exact_duplicate"),
        (
            _required(build_structural_fingerprint(_structure(amount="200"))),
            "probable_duplicate",
        ),
        (
            _required(
                build_structural_fingerprint(
                    _structure(ingredient="ingredient-water", action="boil")
                )
            ),
            "distinct",
        ),
    ],
)
def test_source_optional_core_classifies_without_excluding_a_candidate(
    monkeypatch: pytest.MonkeyPatch,
    candidate_fingerprint: StructuralFingerprint,
    expected: str,
) -> None:
    actor_id = uuid4()
    candidate_id = uuid4()
    subject = _required(build_structural_fingerprint(_structure()))
    candidate = _public_candidate(
        candidate_id,
        title="Public source-less candidate",
        fingerprint=candidate_fingerprint,
    )
    captured_exclusions: list[UUID | None] = []

    monkeypatch.setattr(
        preflight_service,
        "get_recipe_duplicate_preflight_by_action",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        preflight_service,
        "get_recipe_structural_fingerprint",
        lambda *_args, **_kwargs: pytest.fail(
            "a source-less preflight must not load a direct-parent fingerprint"
        ),
    )

    def fake_candidates(_session: Session, **kwargs: Any) -> list[PublicRecipeDuplicateCandidate]:
        captured_exclusions.append(cast(UUID | None, kwargs["exclude_recipe_version_id"]))
        return [candidate]

    monkeypatch.setattr(
        preflight_service,
        "list_public_recipe_duplicate_candidates",
        fake_candidates,
    )
    capture: list[RecipeDuplicatePreflight] = []
    _install_store(
        monkeypatch,
        titles={candidate_id: candidate.title},
        capture=capture,
    )

    result = preflight_service.run_structural_recipe_duplicate_preflight(
        cast(Session, object()),
        subject_fingerprint=subject,
        source_version_id=None,
        actor_user_id=actor_id,
        action_id=uuid4(),
        request_fingerprint="1" * 64,
    )

    assert result.response.classification == expected
    assert result.response.same_lineage_no_change is False
    assert captured_exclusions == [None]
    assert capture[0].source_version_id is None
    assert [candidate.public_recipe_version_id for candidate in result.response.candidates] == (
        [candidate_id] if expected != "distinct" else []
    )


def test_source_optional_core_replays_idempotently_and_rejects_key_reuse(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    actor_id = uuid4()
    action_id = uuid4()
    candidate_id = uuid4()
    alternate_source_id = uuid4()
    fingerprint = _required(build_structural_fingerprint(_structure()))
    candidate = _public_candidate(
        candidate_id,
        title="Public source-less candidate",
        fingerprint=fingerprint,
    )
    monkeypatch.setattr(
        preflight_service,
        "get_recipe_duplicate_preflight_by_action",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        preflight_service,
        "list_public_recipe_duplicate_candidates",
        lambda *_args, **_kwargs: [candidate],
    )
    capture: list[RecipeDuplicatePreflight] = []
    _install_store(
        monkeypatch,
        titles={
            candidate_id: candidate.title,
            alternate_source_id: "Public alternate source",
        },
        capture=capture,
    )

    first = preflight_service.run_structural_recipe_duplicate_preflight(
        cast(Session, object()),
        subject_fingerprint=fingerprint,
        source_version_id=None,
        actor_user_id=actor_id,
        action_id=action_id,
        request_fingerprint="2" * 64,
    )
    stored = capture[0]
    monkeypatch.setattr(
        preflight_service,
        "get_recipe_duplicate_preflight_by_action",
        lambda *_args, **_kwargs: stored,
    )
    monkeypatch.setattr(
        preflight_service,
        "list_public_recipe_duplicate_candidates",
        lambda *_args, **_kwargs: pytest.fail("an idempotent replay must not rescore"),
    )

    replay = preflight_service.run_structural_recipe_duplicate_preflight(
        cast(Session, object()),
        subject_fingerprint=fingerprint,
        source_version_id=None,
        actor_user_id=actor_id,
        action_id=action_id,
        request_fingerprint="2" * 64,
    )
    assert replay.state == "reused"
    assert replay.response == first.response

    changed_subject = _required(build_structural_fingerprint(_structure(amount="200")))
    with pytest.raises(RecipeDuplicateStorageConflictError, match="another request"):
        preflight_service.run_structural_recipe_duplicate_preflight(
            cast(Session, object()),
            subject_fingerprint=changed_subject,
            source_version_id=None,
            actor_user_id=actor_id,
            action_id=action_id,
            request_fingerprint="2" * 64,
        )

    with pytest.raises(RecipeDuplicateStorageConflictError, match="another request"):
        preflight_service.run_structural_recipe_duplicate_preflight(
            cast(Session, object()),
            subject_fingerprint=fingerprint,
            source_version_id=alternate_source_id,
            actor_user_id=actor_id,
            action_id=action_id,
            request_fingerprint="2" * 64,
        )

    with pytest.raises(RecipeDuplicateStorageConflictError, match="another request"):
        preflight_service.run_structural_recipe_duplicate_preflight(
            cast(Session, object()),
            subject_fingerprint=fingerprint,
            source_version_id=None,
            actor_user_id=actor_id,
            action_id=action_id,
            request_fingerprint="3" * 64,
        )


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


def test_replay_and_decision_fail_stale_when_a_returned_candidate_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_id = uuid4()
    candidate_id = uuid4()
    actor_id = uuid4()
    action_id = uuid4()
    fingerprint = _required(build_structural_fingerprint(_structure()))
    prepared = _prepared(source_id, fingerprint)
    candidate = _public_candidate(
        candidate_id,
        title="A public candidate that later becomes unavailable",
        fingerprint=fingerprint,
    )
    _install_creation_dependencies(
        monkeypatch,
        prepared=prepared,
        candidates=[candidate],
        source_fingerprint=None,
    )
    capture: list[RecipeDuplicatePreflight] = []
    _install_store(
        monkeypatch,
        titles={source_id: "Public source", candidate_id: candidate.title},
        capture=capture,
    )
    created = preflight_service.run_recipe_duplicate_preflight(
        cast(Session, object()),
        source_version_id=source_id,
        actor_user_id=actor_id,
        action_id=action_id,
        payload=_payload(),
    )
    stored = capture[0]
    assert created.response.candidates[0].public_recipe_version_id == candidate_id

    monkeypatch.setattr(
        preflight_service,
        "get_public_recipe_version_titles",
        lambda _session, ids: {source_id: "Public source"} if source_id in ids else {},
    )
    monkeypatch.setattr(
        preflight_service,
        "get_recipe_duplicate_preflight_by_action",
        lambda *_args, **_kwargs: stored,
    )
    with pytest.raises(
        preflight_service.RecipeDuplicatePreflightStaleError,
        match="no longer current",
    ) as replay_error:
        preflight_service.run_recipe_duplicate_preflight(
            cast(Session, object()),
            source_version_id=source_id,
            actor_user_id=actor_id,
            action_id=action_id,
            payload=_payload(),
        )
    assert str(candidate_id) not in str(replay_error.value)
    assert candidate.title not in str(replay_error.value)

    monkeypatch.setattr(
        preflight_service,
        "get_recipe_duplicate_preflight_by_id",
        lambda *_args, **_kwargs: stored,
    )
    monkeypatch.setattr(
        preflight_service,
        "store_recipe_duplicate_decision",
        lambda *_args, **_kwargs: pytest.fail(
            "an unavailable candidate must fail before a decision is stored"
        ),
    )
    with pytest.raises(
        preflight_service.RecipeDuplicatePreflightStaleError,
        match="no longer current",
    ) as decision_error:
        preflight_service.record_recipe_duplicate_decision(
            cast(Session, object()),
            preflight_id=stored.id,
            actor_user_id=actor_id,
            action_id=uuid4(),
            payload=RecipeDuplicateDecisionRequest(
                policy_version=created.response.acknowledgement.policy_version,
                result_digest=created.response.acknowledgement.result_digest,
                decision="continue",
            ),
        )
    assert str(candidate_id) not in str(decision_error.value)
    assert candidate.title not in str(decision_error.value)


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
