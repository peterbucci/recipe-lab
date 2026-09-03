from decimal import Decimal
from uuid import UUID

import pytest
from sqlalchemy import Engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    Ingredient,
    RecipeIngredient,
    RecipeInstruction,
    RecipeInstructionAction,
    RecipeInstructionActionInput,
    RecipeLineage,
    RecipeStructuralFingerprint,
    RecipeVersion,
    User,
)
from app.repositories.recipe_fingerprints import (
    StructuralFingerprintStorageConflictError,
    find_structurally_equal_recipe_version_ids,
    get_recipe_structural_fingerprint,
    store_recipe_structural_fingerprint,
)
from app.seeds.identifiers import action_uuid, measurement_uuid
from app.services.recipe_fingerprint_persistence import (
    MAX_FINGERPRINT_BACKFILL_BATCH_SIZE,
    backfill_recipe_structural_fingerprints,
    fingerprint_and_store_recipe_version,
)
from tests.database import session_with_outer_rollback


def _create_recipe_versions(session: Session, count: int = 2) -> list[RecipeVersion]:
    user = User(
        email="fingerprint-persistence@example.test",
        display_name="Fingerprint persistence",
    )
    session.add(user)
    session.flush()
    lineage = RecipeLineage(created_by_user_id=user.id)
    session.add(lineage)
    session.flush()
    versions = [
        RecipeVersion(
            lineage_id=lineage.id,
            parent_version_id=None if number == 1 else None,
            created_by_user_id=user.id,
            version_number=number,
            title=f"Fingerprint fixture {number}",
            description=None,
            servings=Decimal("2.00"),
        )
        for number in range(1, count + 1)
    ]
    # Each version is a root in its own lineage because recipe topology permits
    # only one root. Give later rows their own lineage while keeping the fixture
    # intentionally free of recipe content.
    session.add(versions[0])
    session.flush()
    for version in versions[1:]:
        child_lineage = RecipeLineage(created_by_user_id=user.id)
        session.add(child_lineage)
        session.flush()
        version.lineage_id = child_lineage.id
        session.add(version)
        session.flush()
    return versions


def test_storage_allows_exact_duplicates_and_multiple_algorithms(
    db_session: Session,
) -> None:
    first, second = _create_recipe_versions(db_session)
    payload = '{"ingredients":[],"version":1}'
    digest = "a" * 64

    stored = store_recipe_structural_fingerprint(
        db_session,
        recipe_version_id=first.id,
        algorithm_version="recipe-structure-v1",
        digest=digest,
        canonical_payload=payload,
    )
    retried = store_recipe_structural_fingerprint(
        db_session,
        recipe_version_id=first.id,
        algorithm_version="recipe-structure-v1",
        digest=digest,
        canonical_payload=payload,
    )
    store_recipe_structural_fingerprint(
        db_session,
        recipe_version_id=second.id,
        algorithm_version="recipe-structure-v1",
        digest=digest,
        canonical_payload=payload,
    )
    store_recipe_structural_fingerprint(
        db_session,
        recipe_version_id=first.id,
        algorithm_version="recipe-structure-v2",
        digest="b" * 64,
        canonical_payload='{"ingredients":[],"version":2}',
    )

    assert retried is stored
    assert (
        get_recipe_structural_fingerprint(
            db_session,
            recipe_version_id=first.id,
            algorithm_version="recipe-structure-v1",
        )
        is stored
    )
    assert find_structurally_equal_recipe_version_ids(
        db_session,
        algorithm_version="recipe-structure-v1",
        digest=digest,
        canonical_payload=payload,
    ) == sorted([first.id, second.id])


def test_digest_collision_candidates_require_exact_canonical_payload(
    db_session: Session,
) -> None:
    first, collision = _create_recipe_versions(db_session)
    digest = "c" * 64
    expected_payload = '{"ingredients":["expected"],"version":1}'
    store_recipe_structural_fingerprint(
        db_session,
        recipe_version_id=first.id,
        algorithm_version="recipe-structure-v1",
        digest=digest,
        canonical_payload=expected_payload,
    )
    store_recipe_structural_fingerprint(
        db_session,
        recipe_version_id=collision.id,
        algorithm_version="recipe-structure-v1",
        digest=digest,
        canonical_payload='{"ingredients":["collision"],"version":1}',
    )

    assert find_structurally_equal_recipe_version_ids(
        db_session,
        algorithm_version="recipe-structure-v1",
        digest=digest,
        canonical_payload=expected_payload,
    ) == [first.id]
    assert (
        find_structurally_equal_recipe_version_ids(
            db_session,
            algorithm_version="recipe-structure-v1",
            digest=digest,
            canonical_payload=expected_payload,
            exclude_recipe_version_id=first.id,
        )
        == []
    )


def test_storage_refuses_to_reinterpret_an_existing_algorithm_result(
    db_session: Session,
) -> None:
    (recipe,) = _create_recipe_versions(db_session, count=1)
    store_recipe_structural_fingerprint(
        db_session,
        recipe_version_id=recipe.id,
        algorithm_version="recipe-structure-v1",
        digest="d" * 64,
        canonical_payload='{"version":1}',
    )

    with pytest.raises(StructuralFingerprintStorageConflictError, match="already stored"):
        store_recipe_structural_fingerprint(
            db_session,
            recipe_version_id=recipe.id,
            algorithm_version="recipe-structure-v1",
            digest="e" * 64,
            canonical_payload='{"version":1,"changed":true}',
        )


@pytest.mark.parametrize(
    ("algorithm_version", "digest", "canonical_payload", "constraint"),
    [
        ("", "f" * 64, '{"version":1}', "algorithm_version_format"),
        (
            "Recipe Structure V1",
            "f" * 64,
            '{"version":1}',
            "algorithm_version_format",
        ),
        (
            "recipe-structure-v1",
            "F" * 64,
            '{"version":1}',
            "digest_lowercase_sha256",
        ),
        (
            "recipe-structure-v1",
            "f" * 63,
            '{"version":1}',
            "digest_lowercase_sha256",
        ),
        ("recipe-structure-v1", "f" * 64, " ", "canonical_payload_not_blank"),
    ],
)
def test_storage_constraints_reject_malformed_values(
    db_session: Session,
    algorithm_version: str,
    digest: str,
    canonical_payload: str,
    constraint: str,
) -> None:
    (recipe,) = _create_recipe_versions(db_session, count=1)
    invalid = RecipeStructuralFingerprint(
        recipe_version_id=recipe.id,
        algorithm_version=algorithm_version,
        digest=digest,
        canonical_payload=canonical_payload,
    )

    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.add(invalid)
            db_session.flush()

    diagnostic = getattr(error.value.orig, "diag", None)
    actual = getattr(diagnostic, "constraint_name", None)
    assert actual == f"ck_recipe_structural_fingerprints_{constraint}"


def _create_complete_measured_recipe(
    session: Session,
    *,
    user: User,
    ingredient: Ingredient,
    title: str,
    quantity: Decimal,
    unit_key: str,
    version_id: UUID | None = None,
) -> RecipeVersion:
    lineage = RecipeLineage(created_by_user_id=user.id)
    session.add(lineage)
    session.flush()
    version = RecipeVersion(
        lineage_id=lineage.id,
        parent_version_id=None,
        created_by_user_id=user.id,
        version_number=1,
        title=title,
        description=None,
        servings=Decimal("1.00"),
    )
    if version_id is not None:
        version.id = version_id
    session.add(version)
    session.flush()
    recipe_ingredient = RecipeIngredient(
        recipe_version_id=version.id,
        ingredient_id=ingredient.id,
        name=ingredient.canonical_name,
        measure_mode="exact",
        quantity_min=quantity,
        quantity_max=None,
        measurement_unit_id=measurement_uuid("unit", unit_key),
        unit_display=unit_key,
        package_size_id=None,
        preparation_notes=None,
        display_order=0,
    )
    instruction = RecipeInstruction(
        recipe_version_id=version.id,
        instruction=f"Mix the {ingredient.canonical_name}.",
        display_order=0,
    )
    session.add_all([recipe_ingredient, instruction])
    session.flush()
    action = RecipeInstructionAction(
        recipe_version_id=version.id,
        recipe_instruction_id=instruction.id,
        action_type_id=action_uuid("action-type", "mix"),
        display_order=0,
    )
    session.add(action)
    session.flush()
    session.add(
        RecipeInstructionActionInput(
            recipe_version_id=version.id,
            recipe_instruction_action_id=action.id,
            recipe_ingredient_id=recipe_ingredient.id,
            display_order=0,
        )
    )
    session.flush()
    return version


def test_orm_adapter_eagerly_loads_reviewed_conversions_and_normalizes_equivalents(
    db_session: Session,
) -> None:
    user = User(
        email="fingerprint-conversion@example.test",
        display_name="Fingerprint conversion",
    )
    ingredient = Ingredient(canonical_name="Fingerprint flour")
    db_session.add_all([user, ingredient])
    db_session.flush()
    grams = _create_complete_measured_recipe(
        db_session,
        user=user,
        ingredient=ingredient,
        title="One thousand grams",
        quantity=Decimal("1000"),
        unit_key="g",
    )
    kilograms = _create_complete_measured_recipe(
        db_session,
        user=user,
        ingredient=ingredient,
        title="One kilogram",
        quantity=Decimal("1"),
        unit_key="kg",
    )

    grams_result = fingerprint_and_store_recipe_version(db_session, grams.id)
    kilograms_result = fingerprint_and_store_recipe_version(db_session, kilograms.id)

    assert grams_result.state == "created"
    assert kilograms_result.state == "created"
    assert grams_result.fingerprint is not None
    assert kilograms_result.fingerprint is not None
    assert grams_result.fingerprint.digest == kilograms_result.fingerprint.digest
    assert (
        grams_result.fingerprint.canonical_payload == kilograms_result.fingerprint.canonical_payload
    )


def test_backfill_is_bounded_resumable_and_idempotent(
    seeded_api_engine: Engine,
) -> None:
    with session_with_outer_rollback(seeded_api_engine) as session:
        existing_cursor = session.scalar(select(RecipeVersion.id).order_by(RecipeVersion.id.desc()))
        assert existing_cursor is not None
        user = User(
            email="fingerprint-backfill@example.test",
            display_name="Fingerprint backfill",
        )
        ingredient = Ingredient(canonical_name="Fingerprint backfill ingredient")
        session.add_all([user, ingredient])
        session.flush()
        recipe_version_ids = [
            _create_complete_measured_recipe(
                session,
                user=user,
                ingredient=ingredient,
                title=f"Fingerprint backfill {number}",
                quantity=Decimal(number),
                unit_key="g",
                version_id=UUID(f"ffffffff-ffff-4fff-8fff-fffffffffff{number}"),
            ).id
            for number in range(1, 4)
        ]

        first = backfill_recipe_structural_fingerprints(
            session,
            after_recipe_version_id=existing_cursor,
            limit=1,
        )
        assert first.scanned == 1
        assert first.created == 1
        assert first.reused == 0
        assert first.incomplete == 0
        assert first.next_cursor == recipe_version_ids[0]

        retried = backfill_recipe_structural_fingerprints(
            session,
            after_recipe_version_id=existing_cursor,
            limit=1,
        )
        assert retried.scanned == 1
        assert retried.created == 0
        assert retried.reused == 1
        assert retried.next_cursor == recipe_version_ids[0]

        second = backfill_recipe_structural_fingerprints(
            session,
            after_recipe_version_id=first.next_cursor,
            limit=1,
        )
        assert second.scanned == 1
        assert second.created == 1
        assert second.next_cursor == recipe_version_ids[1]


@pytest.mark.parametrize("limit", [0, MAX_FINGERPRINT_BACKFILL_BATCH_SIZE + 1])
def test_backfill_rejects_unbounded_limits(db_session: Session, limit: int) -> None:
    with pytest.raises(ValueError, match="limit must be between"):
        backfill_recipe_structural_fingerprints(db_session, limit=limit)
