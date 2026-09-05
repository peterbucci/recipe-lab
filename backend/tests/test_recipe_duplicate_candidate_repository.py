from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

import pytest
from sqlalchemy.orm import Session

from app.models import (
    RECIPE_PUBLICATION_STATE_MODERATION_HIDDEN,
    RECIPE_PUBLICATION_STATE_PUBLISHED,
    Ingredient,
    RecipeIngredient,
    RecipeStructuralFingerprint,
    RecipeVersionPublication,
    User,
)
from app.repositories.recipes import list_public_recipe_duplicate_candidates
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
from tests.recipe_builders import build_recipe_lineage, build_recipe_version


def _fingerprint(
    ingredient_ids: tuple[UUID, ...],
    *,
    quantity: str = "1",
) -> StructuralFingerprint:
    unit = CanonicalUnit(key="g", dimension="mass", conversion_family="mass-si")
    occurrence_keys = tuple(f"ingredient-{index}" for index in range(len(ingredient_ids)))
    fingerprint = build_structural_fingerprint(
        RecipeStructure(
            ingredients=tuple(
                StructuralIngredient(
                    occurrence_key=occurrence_key,
                    ingredient_identity=str(ingredient_id),
                    measure=StructuralMeasure(
                        mode="exact",
                        quantity_min=Decimal(quantity),
                        unit=unit,
                    ),
                )
                for occurrence_key, ingredient_id in zip(
                    occurrence_keys,
                    ingredient_ids,
                    strict=True,
                )
            ),
            instructions=(
                StructuralInstruction(
                    actions=(
                        StructuralAction(
                            action_type_key="mix",
                            ingredient_occurrence_keys=occurrence_keys,
                        ),
                    )
                ),
            ),
        )
    )
    assert fingerprint is not None
    return fingerprint


def _store_candidate(
    session: Session,
    *,
    actor: User,
    ingredients: dict[UUID, Ingredient],
    recipe_version_id: UUID,
    fingerprint: StructuralFingerprint,
    ingredient_ids: tuple[UUID, ...],
    publication_state: str | None = RECIPE_PUBLICATION_STATE_PUBLISHED,
    algorithm_version: str | None = None,
) -> None:
    lineage = build_recipe_lineage(created_by_user_id=actor.id)
    session.add(lineage)
    session.flush()
    version = build_recipe_version(
        recipe_version_id=recipe_version_id,
        lineage_id=lineage.id,
        created_by_user_id=actor.id,
        title=f"Candidate {recipe_version_id}",
        servings=Decimal("2.00"),
    )
    session.add(version)
    session.flush()
    session.add_all(
        [
            RecipeIngredient(
                recipe_version_id=version.id,
                ingredient_id=ingredient_id,
                name=ingredients[ingredient_id].canonical_name,
                measure_mode="unspecified",
                quantity_min=None,
                quantity_max=None,
                measurement_unit_id=None,
                unit_display=None,
                package_size_id=None,
                preparation_notes=None,
                display_order=index,
            )
            for index, ingredient_id in enumerate(ingredient_ids)
        ]
    )
    session.add(
        RecipeStructuralFingerprint(
            recipe_version_id=version.id,
            algorithm_version=algorithm_version or fingerprint.algorithm_version,
            digest=fingerprint.digest,
            canonical_payload=fingerprint.canonical_json,
        )
    )
    if publication_state is not None:
        session.add(
            RecipeVersionPublication(
                recipe_version_id=version.id,
                state=publication_state,
                moderation_hidden_at=(
                    datetime.now(UTC)
                    if publication_state == RECIPE_PUBLICATION_STATE_MODERATION_HIDDEN
                    else None
                ),
                state_changed_by_user_id=actor.id,
                actor_user_id=actor.id,
            )
        )
    session.flush()


def test_public_duplicate_shortlist_is_exact_first_bounded_and_deterministic(
    db_session: Session,
) -> None:
    actor = User(
        email="duplicate-shortlist@example.test",
        display_name="Duplicate shortlist",
    )
    ingredient_ids = (
        UUID("81000000-0000-4000-8000-000000000001"),
        UUID("81000000-0000-4000-8000-000000000002"),
        UUID("81000000-0000-4000-8000-000000000003"),
        UUID("81000000-0000-4000-8000-000000000004"),
    )
    ingredients = {
        ingredient_id: Ingredient(
            id=ingredient_id,
            canonical_name=f"Shortlist ingredient {index}",
        )
        for index, ingredient_id in enumerate(ingredient_ids)
    }
    db_session.add(actor)
    db_session.add_all(ingredients.values())
    db_session.flush()

    subject_ids = ingredient_ids[:3]
    subject = _fingerprint(subject_ids)
    exact_id = UUID("82000000-0000-4000-8000-000000000009")
    source_id = UUID("82000000-0000-4000-8000-000000000001")
    overlap_three_id = UUID("83000000-0000-4000-8000-000000000009")
    overlap_two_first_id = UUID("83000000-0000-4000-8000-000000000001")
    overlap_two_second_id = UUID("83000000-0000-4000-8000-000000000002")

    fixtures = (
        (exact_id, subject, subject_ids, RECIPE_PUBLICATION_STATE_PUBLISHED, None),
        (source_id, subject, subject_ids, RECIPE_PUBLICATION_STATE_PUBLISHED, None),
        (
            overlap_three_id,
            _fingerprint(subject_ids, quantity="2"),
            subject_ids,
            RECIPE_PUBLICATION_STATE_PUBLISHED,
            None,
        ),
        (
            overlap_two_second_id,
            _fingerprint(subject_ids[:2], quantity="3"),
            subject_ids[:2],
            RECIPE_PUBLICATION_STATE_PUBLISHED,
            None,
        ),
        (
            overlap_two_first_id,
            _fingerprint(subject_ids[:2], quantity="4"),
            subject_ids[:2],
            RECIPE_PUBLICATION_STATE_PUBLISHED,
            None,
        ),
        (
            UUID("84000000-0000-4000-8000-000000000001"),
            _fingerprint(subject_ids[:1], quantity="5"),
            subject_ids[:1],
            RECIPE_PUBLICATION_STATE_PUBLISHED,
            None,
        ),
        (
            UUID("85000000-0000-4000-8000-000000000001"),
            _fingerprint(ingredient_ids[3:]),
            ingredient_ids[3:],
            RECIPE_PUBLICATION_STATE_PUBLISHED,
            None,
        ),
        (
            UUID("86000000-0000-4000-8000-000000000001"),
            subject,
            subject_ids,
            RECIPE_PUBLICATION_STATE_MODERATION_HIDDEN,
            None,
        ),
        (
            UUID("87000000-0000-4000-8000-000000000001"),
            subject,
            subject_ids,
            None,
            None,
        ),
        (
            UUID("88000000-0000-4000-8000-000000000001"),
            subject,
            subject_ids,
            RECIPE_PUBLICATION_STATE_PUBLISHED,
            "recipe-structure-v2",
        ),
    )
    for recipe_version_id, fingerprint, ids, state, algorithm in fixtures:
        _store_candidate(
            db_session,
            actor=actor,
            ingredients=ingredients,
            recipe_version_id=recipe_version_id,
            fingerprint=fingerprint,
            ingredient_ids=ids,
            publication_state=state,
            algorithm_version=algorithm,
        )

    candidates = list_public_recipe_duplicate_candidates(
        db_session,
        algorithm_version=subject.algorithm_version,
        subject_digest=subject.digest,
        subject_canonical_payload=subject.canonical_json,
        subject_ingredient_identities=tuple(str(value) for value in subject_ids),
        comparison_limit=4,
        exact_candidate_limit=2,
        exclude_recipe_version_id=source_id,
    )

    assert [candidate.recipe_version_id for candidate in candidates] == [
        exact_id,
        overlap_three_id,
        overlap_two_first_id,
        overlap_two_second_id,
    ]

    exact_only = list_public_recipe_duplicate_candidates(
        db_session,
        algorithm_version=subject.algorithm_version,
        subject_digest=subject.digest,
        subject_canonical_payload=subject.canonical_json,
        subject_ingredient_identities=tuple(str(value) for value in subject_ids),
        comparison_limit=4,
        exact_candidate_limit=1,
    )
    assert [candidate.recipe_version_id for candidate in exact_only] == [source_id]


def test_public_duplicate_shortlist_rejects_invalid_bounds_and_identities(
    db_session: Session,
) -> None:
    with pytest.raises(ValueError, match="comparison limit must be positive"):
        list_public_recipe_duplicate_candidates(
            db_session,
            algorithm_version="recipe-structure-v1",
            subject_digest="0" * 64,
            subject_canonical_payload="{}",
            subject_ingredient_identities=(),
            comparison_limit=0,
            exact_candidate_limit=5,
        )
    for exact_limit in (0, 6):
        with pytest.raises(ValueError, match="Exact duplicate candidate limit"):
            list_public_recipe_duplicate_candidates(
                db_session,
                algorithm_version="recipe-structure-v1",
                subject_digest="0" * 64,
                subject_canonical_payload="{}",
                subject_ingredient_identities=(),
                comparison_limit=5,
                exact_candidate_limit=exact_limit,
            )

    with pytest.raises(ValueError, match="identities must be UUIDs"):
        list_public_recipe_duplicate_candidates(
            db_session,
            algorithm_version="recipe-structure-v1",
            subject_digest="0" * 64,
            subject_canonical_payload="{}",
            subject_ingredient_identities=("not-a-uuid",),
            comparison_limit=5,
            exact_candidate_limit=5,
        )
