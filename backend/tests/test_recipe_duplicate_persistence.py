from collections.abc import Callable
from dataclasses import replace
from decimal import Decimal
from fractions import Fraction
from uuid import UUID, uuid4

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    RECIPE_DUPLICATE_DECISION_CONTINUE,
    RECIPE_DUPLICATE_DISTINCT,
    RECIPE_DUPLICATE_EXACT,
    RECIPE_DUPLICATE_PROBABLE,
    RecipeDuplicateCandidate,
    RecipeDuplicateDecision,
    RecipeDuplicatePreflight,
    RecipeVersion,
    User,
)
from app.repositories.recipe_duplicates import (
    MAX_RECIPE_DUPLICATE_CANDIDATES,
    RecipeDuplicateAcknowledgementConflictError,
    RecipeDuplicateCandidateWrite,
    RecipeDuplicatePreflightNotFoundError,
    RecipeDuplicatePreflightStoreResult,
    RecipeDuplicateStorageConflictError,
    duplicate_score_to_basis_points,
    get_recipe_duplicate_decision_by_preflight,
    get_recipe_duplicate_preflight_by_action,
    get_recipe_duplicate_preflight_by_id,
    store_recipe_duplicate_decision,
    store_recipe_duplicate_preflight,
)
from tests.recipe_builders import build_recipe_lineage, build_recipe_version

FINGERPRINT_VERSION = "recipe-structure-v1"
POLICY_VERSION = "recipe-duplicate-preflight-policy-v1"
REQUEST_FINGERPRINT = "a" * 64
SUBJECT_DIGEST = "b" * 64
RESULT_DIGEST = "c" * 64


@pytest.mark.parametrize(
    ("score", "expected"),
    [
        (Fraction(0), 0),
        (Fraction(1, 20_000), 1),
        (Fraction(1, 3), 3_333),
        (Fraction(4, 5), 8_000),
        (Fraction(1), 10_000),
    ],
)
def test_duplicate_score_basis_points_are_deterministic(
    score: Fraction,
    expected: int,
) -> None:
    assert duplicate_score_to_basis_points(score) == expected


@pytest.mark.parametrize("score", [Fraction(-1, 10), Fraction(11, 10)])
def test_duplicate_score_basis_points_reject_values_outside_unit_interval(
    score: Fraction,
) -> None:
    with pytest.raises(ValueError, match="between zero and one"):
        duplicate_score_to_basis_points(score)


def _create_recipe(
    session: Session,
    *,
    actor: User,
    title: str,
) -> RecipeVersion:
    lineage = build_recipe_lineage(created_by_user_id=actor.id)
    session.add(lineage)
    session.flush()
    recipe = build_recipe_version(
        lineage_id=lineage.id,
        created_by_user_id=actor.id,
        title=title,
        servings=Decimal("2.00"),
    )
    session.add(recipe)
    session.flush()
    return recipe


def _create_fixture(session: Session) -> tuple[User, User, RecipeVersion, RecipeVersion]:
    actor = User(email="duplicate-actor@example.test", display_name="Duplicate actor")
    other = User(email="duplicate-other@example.test", display_name="Duplicate other")
    session.add_all([actor, other])
    session.flush()
    source = _create_recipe(session, actor=actor, title="Source recipe")
    candidate = _create_recipe(session, actor=other, title="Public candidate")
    return actor, other, source, candidate


def _exact_candidate(recipe: RecipeVersion) -> RecipeDuplicateCandidateWrite:
    return RecipeDuplicateCandidateWrite(
        public_recipe_version_id=recipe.id,
        rank=1,
        classification=RECIPE_DUPLICATE_EXACT,
        score_basis_points=10_000,
        reason_codes=("exact_structural_match",),
        fingerprint_algorithm_version=FINGERPRINT_VERSION,
        policy_version=POLICY_VERSION,
        exact_payload_confirmed=True,
    )


def _probable_candidate(
    recipe: RecipeVersion,
    *,
    score_basis_points: int = 8_000,
    reason_codes: tuple[str, ...] = (
        "same_ingredient_multiset",
        "matching_quantities",
        "different_action_types",
    ),
) -> RecipeDuplicateCandidateWrite:
    return RecipeDuplicateCandidateWrite(
        public_recipe_version_id=recipe.id,
        rank=1,
        classification=RECIPE_DUPLICATE_PROBABLE,
        score_basis_points=score_basis_points,
        reason_codes=reason_codes,
        fingerprint_algorithm_version=FINGERPRINT_VERSION,
        policy_version=POLICY_VERSION,
        exact_payload_confirmed=False,
    )


def _store_exact_preflight(
    session: Session,
    *,
    actor: User,
    source: RecipeVersion,
    candidate: RecipeVersion,
    action_id: UUID | None = None,
) -> RecipeDuplicatePreflightStoreResult:
    return store_recipe_duplicate_preflight(
        session,
        actor_user_id=actor.id,
        action_id=action_id if action_id is not None else uuid4(),
        request_fingerprint=REQUEST_FINGERPRINT,
        source_version_id=source.id,
        subject_fingerprint_algorithm=FINGERPRINT_VERSION,
        subject_fingerprint_digest=SUBJECT_DIGEST,
        policy_version=POLICY_VERSION,
        classification=RECIPE_DUPLICATE_EXACT,
        same_parent_no_change=False,
        result_digest=RESULT_DIGEST,
        candidates=[_exact_candidate(candidate)],
    )


def test_preflight_persistence_is_bounded_actor_scoped_and_idempotent(
    db_session: Session,
) -> None:
    actor, other, source, candidate = _create_fixture(db_session)
    action_id = uuid4()

    created = _store_exact_preflight(
        db_session,
        actor=actor,
        source=source,
        candidate=candidate,
        action_id=action_id,
    )
    replayed = _store_exact_preflight(
        db_session,
        actor=actor,
        source=source,
        candidate=candidate,
        action_id=action_id,
    )

    assert created.state == "created"
    assert replayed.state == "reused"
    assert replayed.preflight.id == created.preflight.id
    assert replayed.preflight.result_digest == RESULT_DIGEST
    assert len(replayed.preflight.candidates) == 1
    stored_candidate = replayed.preflight.candidates[0]
    assert stored_candidate.public_recipe_version_id == candidate.id
    assert stored_candidate.reason_codes == ["exact_structural_match"]
    assert (
        get_recipe_duplicate_preflight_by_action(
            db_session,
            actor_user_id=actor.id,
            action_id=action_id,
        )
        is not None
    )
    assert (
        get_recipe_duplicate_preflight_by_id(
            db_session,
            actor_user_id=other.id,
            preflight_id=created.preflight.id,
        )
        is None
    )


def test_preflight_action_collision_rejects_a_different_request(db_session: Session) -> None:
    actor, _, source, candidate = _create_fixture(db_session)
    action_id = uuid4()
    _store_exact_preflight(
        db_session,
        actor=actor,
        source=source,
        candidate=candidate,
        action_id=action_id,
    )

    with pytest.raises(RecipeDuplicateStorageConflictError, match="another request"):
        store_recipe_duplicate_preflight(
            db_session,
            actor_user_id=actor.id,
            action_id=action_id,
            request_fingerprint="d" * 64,
            source_version_id=source.id,
            subject_fingerprint_algorithm=FINGERPRINT_VERSION,
            subject_fingerprint_digest=SUBJECT_DIGEST,
            policy_version=POLICY_VERSION,
            classification=RECIPE_DUPLICATE_EXACT,
            same_parent_no_change=False,
            result_digest=RESULT_DIGEST,
            candidates=[_exact_candidate(candidate)],
        )


def test_candidate_failure_rolls_back_the_preflight_atomically(db_session: Session) -> None:
    actor, _, source, _ = _create_fixture(db_session)
    action_id = uuid4()
    missing_candidate = RecipeDuplicateCandidateWrite(
        public_recipe_version_id=uuid4(),
        rank=1,
        classification=RECIPE_DUPLICATE_EXACT,
        score_basis_points=10_000,
        reason_codes=("exact_structural_match",),
        fingerprint_algorithm_version=FINGERPRINT_VERSION,
        policy_version=POLICY_VERSION,
        exact_payload_confirmed=True,
    )

    with pytest.raises(IntegrityError):
        with db_session.begin_nested():
            store_recipe_duplicate_preflight(
                db_session,
                actor_user_id=actor.id,
                action_id=action_id,
                request_fingerprint=REQUEST_FINGERPRINT,
                source_version_id=source.id,
                subject_fingerprint_algorithm=FINGERPRINT_VERSION,
                subject_fingerprint_digest=SUBJECT_DIGEST,
                policy_version=POLICY_VERSION,
                classification=RECIPE_DUPLICATE_EXACT,
                same_parent_no_change=False,
                result_digest=RESULT_DIGEST,
                candidates=[missing_candidate],
            )

    assert (
        get_recipe_duplicate_preflight_by_action(
            db_session,
            actor_user_id=actor.id,
            action_id=action_id,
        )
        is None
    )


def test_distinct_preflight_stores_no_candidate_or_private_recipe_content(
    db_session: Session,
) -> None:
    actor, _, source, _ = _create_fixture(db_session)
    result = store_recipe_duplicate_preflight(
        db_session,
        actor_user_id=actor.id,
        action_id=uuid4(),
        request_fingerprint=REQUEST_FINGERPRINT,
        source_version_id=source.id,
        subject_fingerprint_algorithm=FINGERPRINT_VERSION,
        subject_fingerprint_digest=SUBJECT_DIGEST,
        policy_version=POLICY_VERSION,
        classification=RECIPE_DUPLICATE_DISTINCT,
        same_parent_no_change=False,
        result_digest=RESULT_DIGEST,
        candidates=[],
    )

    assert result.preflight.candidates == []
    columns = {
        column["name"]
        for column in inspect(db_session.connection()).get_columns("recipe_duplicate_preflights")
    }
    assert not {"title", "description", "canonical_payload", "ingredient_names"} & columns


def test_same_parent_no_change_is_exact_evidence_without_a_candidate(
    db_session: Session,
) -> None:
    actor, _, source, _ = _create_fixture(db_session)
    result = store_recipe_duplicate_preflight(
        db_session,
        actor_user_id=actor.id,
        action_id=uuid4(),
        request_fingerprint=REQUEST_FINGERPRINT,
        source_version_id=source.id,
        subject_fingerprint_algorithm=FINGERPRINT_VERSION,
        subject_fingerprint_digest=SUBJECT_DIGEST,
        policy_version=POLICY_VERSION,
        classification=RECIPE_DUPLICATE_EXACT,
        same_parent_no_change=True,
        result_digest=RESULT_DIGEST,
        candidates=[],
    )

    assert result.preflight.same_parent_no_change is True
    assert result.preflight.candidates == []

    with pytest.raises(ValueError, match="requires its direct source"):
        store_recipe_duplicate_preflight(
            db_session,
            actor_user_id=actor.id,
            action_id=uuid4(),
            request_fingerprint="f" * 64,
            source_version_id=None,
            subject_fingerprint_algorithm=FINGERPRINT_VERSION,
            subject_fingerprint_digest=SUBJECT_DIGEST,
            policy_version=POLICY_VERSION,
            classification=RECIPE_DUPLICATE_EXACT,
            same_parent_no_change=True,
            result_digest=RESULT_DIGEST,
            candidates=[],
        )


def test_repository_refuses_unbounded_or_inconsistent_candidate_evidence(
    db_session: Session,
) -> None:
    actor, _, source, candidate = _create_fixture(db_session)
    too_many = [
        RecipeDuplicateCandidateWrite(
            public_recipe_version_id=uuid4(),
            rank=rank,
            classification=RECIPE_DUPLICATE_EXACT,
            score_basis_points=10_000,
            reason_codes=("exact_structural_match",),
            fingerprint_algorithm_version=FINGERPRINT_VERSION,
            policy_version=POLICY_VERSION,
            exact_payload_confirmed=True,
        )
        for rank in range(1, MAX_RECIPE_DUPLICATE_CANDIDATES + 2)
    ]
    with pytest.raises(ValueError, match="At most"):
        store_recipe_duplicate_preflight(
            db_session,
            actor_user_id=actor.id,
            action_id=uuid4(),
            request_fingerprint=REQUEST_FINGERPRINT,
            source_version_id=source.id,
            subject_fingerprint_algorithm=FINGERPRINT_VERSION,
            subject_fingerprint_digest=SUBJECT_DIGEST,
            policy_version=POLICY_VERSION,
            classification=RECIPE_DUPLICATE_EXACT,
            same_parent_no_change=False,
            result_digest=RESULT_DIGEST,
            candidates=too_many,
        )

    malformed_reason = replace(
        _exact_candidate(candidate),
        reason_codes=("Leaked candidate title",),
    )
    with pytest.raises(ValueError, match="snake-case"):
        store_recipe_duplicate_preflight(
            db_session,
            actor_user_id=actor.id,
            action_id=uuid4(),
            request_fingerprint=REQUEST_FINGERPRINT,
            source_version_id=source.id,
            subject_fingerprint_algorithm=FINGERPRINT_VERSION,
            subject_fingerprint_digest=SUBJECT_DIGEST,
            policy_version=POLICY_VERSION,
            classification=RECIPE_DUPLICATE_EXACT,
            same_parent_no_change=False,
            result_digest=RESULT_DIGEST,
            candidates=[malformed_reason],
        )


@pytest.mark.parametrize(
    ("candidate_write", "message"),
    (
        (
            lambda recipe: _probable_candidate(recipe, score_basis_points=7_999),
            "similarity threshold",
        ),
        (
            lambda recipe: _probable_candidate(
                recipe,
                reason_codes=(
                    "invented_reason",
                    "matching_quantities",
                    "matching_structured_actions",
                ),
            ),
            "supported ingredient, quantity, and action families",
        ),
        (
            lambda recipe: _probable_candidate(
                recipe,
                reason_codes=(
                    "matching_structured_actions",
                    "matching_quantities",
                    "same_ingredient_multiset",
                ),
            ),
            "supported ingredient, quantity, and action families",
        ),
        (
            lambda recipe: replace(
                _exact_candidate(recipe),
                reason_codes=("matching_quantities",),
            ),
            "exact structural-match reason",
        ),
    ),
)
def test_repository_refuses_below_threshold_or_unsupported_reason_evidence(
    db_session: Session,
    candidate_write: Callable[[RecipeVersion], RecipeDuplicateCandidateWrite],
    message: str,
) -> None:
    actor, _, source, candidate = _create_fixture(db_session)
    write = candidate_write(candidate)
    classification = write.classification

    with pytest.raises(ValueError, match=message):
        store_recipe_duplicate_preflight(
            db_session,
            actor_user_id=actor.id,
            action_id=uuid4(),
            request_fingerprint=REQUEST_FINGERPRINT,
            source_version_id=source.id,
            subject_fingerprint_algorithm=FINGERPRINT_VERSION,
            subject_fingerprint_digest=SUBJECT_DIGEST,
            policy_version=POLICY_VERSION,
            classification=classification,
            same_parent_no_change=False,
            result_digest=RESULT_DIGEST,
            candidates=[write],
        )


def test_repository_accepts_a_nonexact_probable_score_of_one(
    db_session: Session,
) -> None:
    actor, _, source, candidate = _create_fixture(db_session)

    result = store_recipe_duplicate_preflight(
        db_session,
        actor_user_id=actor.id,
        action_id=uuid4(),
        request_fingerprint=REQUEST_FINGERPRINT,
        source_version_id=source.id,
        subject_fingerprint_algorithm=FINGERPRINT_VERSION,
        subject_fingerprint_digest=SUBJECT_DIGEST,
        policy_version=POLICY_VERSION,
        classification=RECIPE_DUPLICATE_PROBABLE,
        same_parent_no_change=False,
        result_digest=RESULT_DIGEST,
        candidates=[_probable_candidate(candidate, score_basis_points=10_000)],
    )

    assert result.preflight.candidates[0].score_basis_points == 10_000
    assert result.preflight.candidates[0].exact_payload_confirmed is False


def test_database_rejects_probable_evidence_below_the_versioned_threshold(
    db_session: Session,
) -> None:
    actor, _, source, candidate = _create_fixture(db_session)
    preflight = RecipeDuplicatePreflight(
        actor_user_id=actor.id,
        action_id=uuid4(),
        request_fingerprint=REQUEST_FINGERPRINT,
        source_version_id=source.id,
        subject_fingerprint_algorithm=FINGERPRINT_VERSION,
        subject_fingerprint_digest=SUBJECT_DIGEST,
        policy_version=POLICY_VERSION,
        classification=RECIPE_DUPLICATE_PROBABLE,
        same_parent_no_change=False,
        result_digest=RESULT_DIGEST,
    )
    db_session.add(preflight)
    db_session.flush()

    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.add(
                RecipeDuplicateCandidate(
                    preflight_id=preflight.id,
                    public_recipe_version_id=candidate.id,
                    rank=1,
                    classification=RECIPE_DUPLICATE_PROBABLE,
                    score_basis_points=7_999,
                    reason_codes=[
                        "same_ingredient_multiset",
                        "matching_quantities",
                        "different_action_order",
                    ],
                    fingerprint_algorithm_version=FINGERPRINT_VERSION,
                    policy_version=POLICY_VERSION,
                    exact_payload_confirmed=False,
                )
            )
            db_session.flush()

    diagnostic = getattr(error.value.orig, "diag", None)
    assert getattr(diagnostic, "constraint_name", None) == (
        "ck_recipe_duplicate_candidates_exact_evidence_consistent"
    )


@pytest.mark.parametrize(
    ("classification", "reason_codes", "exact_payload_confirmed"),
    [
        (RECIPE_DUPLICATE_EXACT, ["matching_quantities"], True),
        (
            RECIPE_DUPLICATE_PROBABLE,
            ["invented_reason", "matching_quantities", "different_action_order"],
            False,
        ),
        (
            RECIPE_DUPLICATE_PROBABLE,
            [
                "different_action_order",
                "matching_quantities",
                "same_ingredient_multiset",
            ],
            False,
        ),
    ],
)
def test_database_rejects_unsupported_or_misordered_reason_evidence(
    db_session: Session,
    classification: str,
    reason_codes: list[str],
    exact_payload_confirmed: bool,
) -> None:
    actor, _, source, candidate = _create_fixture(db_session)
    preflight = RecipeDuplicatePreflight(
        actor_user_id=actor.id,
        action_id=uuid4(),
        request_fingerprint=REQUEST_FINGERPRINT,
        source_version_id=source.id,
        subject_fingerprint_algorithm=FINGERPRINT_VERSION,
        subject_fingerprint_digest=SUBJECT_DIGEST,
        policy_version=POLICY_VERSION,
        classification=classification,
        same_parent_no_change=False,
        result_digest=RESULT_DIGEST,
    )
    db_session.add(preflight)
    db_session.flush()

    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.add(
                RecipeDuplicateCandidate(
                    preflight_id=preflight.id,
                    public_recipe_version_id=candidate.id,
                    rank=1,
                    classification=classification,
                    score_basis_points=10_000 if exact_payload_confirmed else 8_000,
                    reason_codes=reason_codes,
                    fingerprint_algorithm_version=FINGERPRINT_VERSION,
                    policy_version=POLICY_VERSION,
                    exact_payload_confirmed=exact_payload_confirmed,
                )
            )
            db_session.flush()

    diagnostic = getattr(error.value.orig, "diag", None)
    assert getattr(diagnostic, "constraint_name", None) == (
        "ck_recipe_duplicate_candidates_reason_codes_supported_ordered"
    )


@pytest.mark.parametrize(
    ("policy_version", "fingerprint_algorithm_version"),
    [
        ("different-policy-v1", FINGERPRINT_VERSION),
        (POLICY_VERSION, "recipe-structure-v2"),
    ],
)
def test_database_ties_candidate_policy_and_algorithm_to_its_preflight(
    db_session: Session,
    policy_version: str,
    fingerprint_algorithm_version: str,
) -> None:
    actor, _, source, candidate = _create_fixture(db_session)
    preflight = RecipeDuplicatePreflight(
        actor_user_id=actor.id,
        action_id=uuid4(),
        request_fingerprint=REQUEST_FINGERPRINT,
        source_version_id=source.id,
        subject_fingerprint_algorithm=FINGERPRINT_VERSION,
        subject_fingerprint_digest=SUBJECT_DIGEST,
        policy_version=POLICY_VERSION,
        classification=RECIPE_DUPLICATE_EXACT,
        same_parent_no_change=False,
        result_digest=RESULT_DIGEST,
    )
    db_session.add(preflight)
    db_session.flush()

    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.add(
                RecipeDuplicateCandidate(
                    preflight_id=preflight.id,
                    public_recipe_version_id=candidate.id,
                    rank=1,
                    classification=RECIPE_DUPLICATE_EXACT,
                    score_basis_points=10_000,
                    reason_codes=["exact_structural_match"],
                    fingerprint_algorithm_version=fingerprint_algorithm_version,
                    policy_version=policy_version,
                    exact_payload_confirmed=True,
                )
            )
            db_session.flush()

    diagnostic = getattr(error.value.orig, "diag", None)
    assert getattr(diagnostic, "constraint_name", None) == (
        "fk_recipe_duplicate_candidates_preflight_policy_algorithm"
    )


def test_decision_requires_actor_owned_current_acknowledgement_and_is_idempotent(
    db_session: Session,
) -> None:
    actor, other, source, candidate = _create_fixture(db_session)
    preflight = _store_exact_preflight(
        db_session,
        actor=actor,
        source=source,
        candidate=candidate,
    ).preflight
    action_id = uuid4()

    with pytest.raises(RecipeDuplicatePreflightNotFoundError, match="not found"):
        store_recipe_duplicate_decision(
            db_session,
            preflight_id=preflight.id,
            actor_user_id=other.id,
            action_id=uuid4(),
            decision=RECIPE_DUPLICATE_DECISION_CONTINUE,
            acknowledged_policy_version=POLICY_VERSION,
            acknowledged_result_digest=RESULT_DIGEST,
        )
    with pytest.raises(RecipeDuplicateAcknowledgementConflictError, match="stale"):
        store_recipe_duplicate_decision(
            db_session,
            preflight_id=preflight.id,
            actor_user_id=actor.id,
            action_id=uuid4(),
            decision=RECIPE_DUPLICATE_DECISION_CONTINUE,
            acknowledged_policy_version=POLICY_VERSION,
            acknowledged_result_digest="e" * 64,
        )

    created = store_recipe_duplicate_decision(
        db_session,
        preflight_id=preflight.id,
        actor_user_id=actor.id,
        action_id=action_id,
        decision=RECIPE_DUPLICATE_DECISION_CONTINUE,
        acknowledged_policy_version=POLICY_VERSION,
        acknowledged_result_digest=RESULT_DIGEST,
    )
    replayed = store_recipe_duplicate_decision(
        db_session,
        preflight_id=preflight.id,
        actor_user_id=actor.id,
        action_id=action_id,
        decision=RECIPE_DUPLICATE_DECISION_CONTINUE,
        acknowledged_policy_version=POLICY_VERSION,
        acknowledged_result_digest=RESULT_DIGEST,
    )

    assert created.state == "created"
    assert replayed.state == "reused"
    assert replayed.decision.id == created.decision.id
    assert (
        get_recipe_duplicate_decision_by_preflight(
            db_session,
            actor_user_id=other.id,
            preflight_id=preflight.id,
        )
        is None
    )


@pytest.mark.parametrize("mismatch", ["actor", "policy", "result"])
def test_database_ties_decision_actor_and_acknowledgement_to_its_preflight(
    db_session: Session,
    mismatch: str,
) -> None:
    actor, other, source, candidate = _create_fixture(db_session)
    preflight = _store_exact_preflight(
        db_session,
        actor=actor,
        source=source,
        candidate=candidate,
    ).preflight

    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.add(
                RecipeDuplicateDecision(
                    preflight_id=preflight.id,
                    actor_user_id=other.id if mismatch == "actor" else actor.id,
                    action_id=uuid4(),
                    decision=RECIPE_DUPLICATE_DECISION_CONTINUE,
                    acknowledged_policy_version=(
                        "different-policy-v1" if mismatch == "policy" else POLICY_VERSION
                    ),
                    acknowledged_result_digest=(
                        "d" * 64 if mismatch == "result" else RESULT_DIGEST
                    ),
                )
            )
            db_session.flush()

    diagnostic = getattr(error.value.orig, "diag", None)
    assert getattr(diagnostic, "constraint_name", None) == (
        "fk_recipe_duplicate_decisions_preflight_actor_acknowledgement"
    )


def test_duplicate_evidence_tables_reject_update_delete_and_truncate(
    db_session: Session,
) -> None:
    actor, _, source, candidate = _create_fixture(db_session)
    preflight = _store_exact_preflight(
        db_session,
        actor=actor,
        source=source,
        candidate=candidate,
    ).preflight
    store_recipe_duplicate_decision(
        db_session,
        preflight_id=preflight.id,
        actor_user_id=actor.id,
        action_id=uuid4(),
        decision=RECIPE_DUPLICATE_DECISION_CONTINUE,
        acknowledged_policy_version=POLICY_VERSION,
        acknowledged_result_digest=RESULT_DIGEST,
    )

    mutations = (
        ("UPDATE recipe_duplicate_preflights SET classification = 'distinct'", "append-only"),
        ("DELETE FROM recipe_duplicate_candidates", "append-only"),
        (
            "TRUNCATE TABLE recipe_duplicate_decisions",
            "append-only|cannot truncate a table referenced in a foreign key constraint",
        ),
    )
    for statement, expected_error in mutations:
        with pytest.raises(DBAPIError, match=expected_error):
            with db_session.begin_nested():
                db_session.execute(text(statement))
