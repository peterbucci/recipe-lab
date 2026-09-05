import json
from collections.abc import Sequence
from decimal import Decimal
from hashlib import sha256
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import Session

import app.services.recipe_duplicate_preflights as preflight_service
from app.models import (
    RecipeDuplicateCandidate,
    RecipeDuplicatePreflight,
    RecipeStructuralFingerprint,
)
from app.repositories.recipe_duplicates import (
    RecipeDuplicateCandidateWrite,
    RecipeDuplicatePreflightStoreResult,
)
from app.repositories.recipes import PublicRecipeDuplicateCandidate
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


def _install_core_dependencies(
    monkeypatch: pytest.MonkeyPatch,
    *,
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
        "recipe-duplicate-preflight-policy-v2"
    )
    assert payload["scorer"] == {
        "algorithm_version": "duplicate-candidate-similarity-v1",
        "parameter_hash": DUPLICATE_CANDIDATE_PARAMETER_HASH,
    }
    assert payload["candidate_selection"] == {
        "discovery": {
            "exact_lookup": {
                "confirmation": "same_algorithm_digest_and_canonical_payload",
                "maximum_candidates": 5,
                "ranking": ["ascending_public_recipe_version_uuid"],
            },
            "probable_shortlist": {
                "eligibility": "at_least_one_shared_canonical_ingredient_identity",
                "maximum_total_public_comparisons_including_exact": 500,
                "overlap_metric": ("count_distinct_shared_canonical_ingredient_identities"),
                "ranking": [
                    "descending_canonical_ingredient_overlap",
                    "ascending_public_recipe_version_uuid",
                ],
                "remaining_budget": "comparison_limit_minus_exact_candidates",
            },
        },
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
    _install_core_dependencies(
        monkeypatch,
        candidates=candidates,
        source_fingerprint=_stored_fingerprint(source_id, fingerprint),
    )
    capture: list[RecipeDuplicatePreflight] = []
    titles = {source_id: "Direct parent"} | {
        candidate.recipe_version_id: candidate.title for candidate in candidates
    }
    _install_store(monkeypatch, titles=titles, capture=capture)

    result = preflight_service.run_structural_recipe_duplicate_preflight(
        cast(Session, object()),
        subject_fingerprint=fingerprint,
        source_version_id=source_id,
        actor_user_id=actor_id,
        action_id=uuid4(),
        request_fingerprint="1" * 64,
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
    assert result.response.acknowledgement.policy_version == (
        preflight_service.RECIPE_DUPLICATE_POLICY_VERSION
    )
    assert capture[0].policy_version == preflight_service.RECIPE_DUPLICATE_POLICY_VERSION
    assert all(
        candidate.policy_version == preflight_service.RECIPE_DUPLICATE_POLICY_VERSION
        for candidate in capture[0].candidates
    )
    assert result.response.acknowledgement.result_digest == capture[0].result_digest
    assert capture[0].source_version_id == source_id
    assert source_id not in {
        candidate.public_recipe_version_id for candidate in capture[0].candidates
    }


def test_preflight_fails_closed_if_repository_violates_the_bounded_shortlist_contract(
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
    _install_core_dependencies(
        monkeypatch,
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
        preflight_service.run_structural_recipe_duplicate_preflight(
            cast(Session, object()),
            subject_fingerprint=fingerprint,
            source_version_id=source_id,
            actor_user_id=uuid4(),
            action_id=uuid4(),
            request_fingerprint="2" * 64,
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
    _install_core_dependencies(
        monkeypatch,
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
        preflight_service.run_structural_recipe_duplicate_preflight(
            cast(Session, object()),
            subject_fingerprint=subject,
            source_version_id=source_id,
            actor_user_id=uuid4(),
            action_id=uuid4(),
            request_fingerprint="3" * 64,
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
    _install_core_dependencies(
        monkeypatch,
        candidates=[candidate],
        source_fingerprint=None,
    )
    capture: list[RecipeDuplicatePreflight] = []
    _install_store(
        monkeypatch,
        titles={source_id: "Source", candidate_id: candidate.title},
        capture=capture,
    )

    result = preflight_service.run_structural_recipe_duplicate_preflight(
        cast(Session, object()),
        subject_fingerprint=subject,
        source_version_id=source_id,
        actor_user_id=uuid4(),
        action_id=uuid4(),
        request_fingerprint="4" * 64,
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
    captured_queries: list[dict[str, Any]] = []

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
        captured_queries.append(kwargs)
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
    assert len(captured_queries) == 1
    assert captured_queries[0]["exclude_recipe_version_id"] is None
    assert captured_queries[0]["subject_digest"] == subject.digest
    assert captured_queries[0]["subject_canonical_payload"] == subject.canonical_json
    assert captured_queries[0]["subject_ingredient_identities"] == ("ingredient-flour",)
    assert captured_queries[0]["comparison_limit"] == 500
    assert captured_queries[0]["exact_candidate_limit"] == 5
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
    with pytest.raises(
        preflight_service.RecipeDuplicatePreflightIdempotencyConflictError,
        match="another request",
    ):
        preflight_service.run_structural_recipe_duplicate_preflight(
            cast(Session, object()),
            subject_fingerprint=changed_subject,
            source_version_id=None,
            actor_user_id=actor_id,
            action_id=action_id,
            request_fingerprint="2" * 64,
        )

    with pytest.raises(
        preflight_service.RecipeDuplicatePreflightIdempotencyConflictError,
        match="another request",
    ):
        preflight_service.run_structural_recipe_duplicate_preflight(
            cast(Session, object()),
            subject_fingerprint=fingerprint,
            source_version_id=alternate_source_id,
            actor_user_id=actor_id,
            action_id=action_id,
            request_fingerprint="2" * 64,
        )

    with pytest.raises(
        preflight_service.RecipeDuplicatePreflightIdempotencyConflictError,
        match="another request",
    ):
        preflight_service.run_structural_recipe_duplicate_preflight(
            cast(Session, object()),
            subject_fingerprint=fingerprint,
            source_version_id=None,
            actor_user_id=actor_id,
            action_id=action_id,
            request_fingerprint="3" * 64,
        )
