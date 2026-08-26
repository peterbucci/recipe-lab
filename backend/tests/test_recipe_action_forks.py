from dataclasses import replace
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.demo_identity import DEMO_USER_ID
from app.models import RecipeStructuralFingerprint, RecipeVersion
from app.repositories.recipes import get_recipe_version
from app.schemas.recipe_forks import RecipeForkRequest
from app.seeds import load_bundled_catalog, seed_catalog
from app.seeds.identifiers import action_uuid, measurement_uuid, seed_uuid
from app.services.recipe_fingerprints import STRUCTURAL_FINGERPRINT_STORAGE_VERSION
from app.services.recipe_forks import (
    InvalidRecipeEditsError,
    PreparedRecipeFingerprintMismatchError,
    fork_recipe_version,
    persist_prepared_recipe_fork,
    prepare_recipe_fork,
)

DATASET_ID = "recipe-lab-demo-v1"
SOURCE_ID = seed_uuid(
    DATASET_ID,
    "recipe-version",
    "carrot-walnut-snack-cake-v1",
)
ORANGE_ZEST_ID = seed_uuid(DATASET_ID, "ingredient", "orange-zest")


def _payload(
    *,
    ingredient_edits: list[dict[str, object]] | None = None,
    instruction_edits: list[dict[str, object]] | None = None,
) -> RecipeForkRequest:
    return RecipeForkRequest.model_validate(
        {
            "title": "Structured action fork",
            "description": "A test child with reviewed actions.",
            "servings": "8",
            "ingredient_edits": ingredient_edits or [],
            "instruction_edits": instruction_edits or [],
        }
    )


def _seed(db_session: Session) -> RecipeVersion:
    seed_catalog(db_session, load_bundled_catalog())
    db_session.flush()
    source = get_recipe_version(db_session, SOURCE_ID)
    assert source is not None
    return source


def test_fork_copies_actions_and_remaps_inputs_to_fresh_child_occurrences(
    db_session: Session,
) -> None:
    source = _seed(db_session)
    source_ingredient_ids = {ingredient.id for ingredient in source.ingredients}
    source_action_ids = {
        action.id for instruction in source.instructions for action in instruction.actions
    }
    source_structure = [
        [
            (
                action.action_type_id,
                [
                    next(
                        ingredient.ingredient_id
                        for ingredient in source.ingredients
                        if ingredient.id == action_input.recipe_ingredient_id
                    )
                    for action_input in action.inputs
                ],
                [
                    (
                        measure.semantic,
                        measure.measure_mode,
                        measure.quantity_min,
                        measure.quantity_max,
                        measure.measurement_unit_id,
                    )
                    for measure in action.measures
                ],
            )
            for action in instruction.actions
        ]
        for instruction in source.instructions
    ]

    child_id = fork_recipe_version(
        db_session,
        source_version_id=source.id,
        author_user_id=DEMO_USER_ID,
        payload=_payload(),
    )
    assert child_id is not None
    db_session.expire_all()
    child = db_session.get(RecipeVersion, child_id)
    assert child is not None
    source_fingerprint = db_session.get(
        RecipeStructuralFingerprint,
        (source.id, STRUCTURAL_FINGERPRINT_STORAGE_VERSION),
    )
    child_fingerprint = db_session.get(
        RecipeStructuralFingerprint,
        (child.id, STRUCTURAL_FINGERPRINT_STORAGE_VERSION),
    )
    assert source_fingerprint is not None
    assert child_fingerprint is not None
    assert child_fingerprint.digest == source_fingerprint.digest
    assert child_fingerprint.canonical_payload == source_fingerprint.canonical_payload
    child_ingredient_ids = {ingredient.id for ingredient in child.ingredients}
    child_action_ids = {
        action.id for instruction in child.instructions for action in instruction.actions
    }
    child_ingredient_identity = {
        ingredient.id: ingredient.ingredient_id for ingredient in child.ingredients
    }
    child_structure = [
        [
            (
                action.action_type_id,
                [
                    child_ingredient_identity[action_input.recipe_ingredient_id]
                    for action_input in action.inputs
                ],
                [
                    (
                        measure.semantic,
                        measure.measure_mode,
                        measure.quantity_min,
                        measure.quantity_max,
                        measure.measurement_unit_id,
                    )
                    for measure in action.measures
                ],
            )
            for action in instruction.actions
        ]
        for instruction in child.instructions
    ]

    assert child_ingredient_ids.isdisjoint(source_ingredient_ids)
    assert child_action_ids.isdisjoint(source_action_ids)
    assert child_structure == source_structure
    assert all(
        action_input.recipe_ingredient_id in child_ingredient_ids
        for instruction in child.instructions
        for action in instruction.actions
        for action_input in action.inputs
    )


def test_prepare_materializes_structure_without_inserting_until_persisted(
    db_session: Session,
) -> None:
    source = _seed(db_session)
    initial_count = db_session.scalar(select(func.count()).select_from(RecipeVersion))
    assert initial_count is not None
    source_fingerprint = db_session.get(
        RecipeStructuralFingerprint,
        (source.id, STRUCTURAL_FINGERPRINT_STORAGE_VERSION),
    )
    assert source_fingerprint is not None

    prepared = prepare_recipe_fork(
        db_session,
        source_version_id=source.id,
        payload=_payload(),
    )

    assert prepared is not None
    assert prepared.source_version_id == source.id
    assert prepared.lineage_id == source.lineage_id
    assert prepared.structure.ingredients
    assert prepared.structure.instructions
    assert prepared.structural_fingerprint.digest == source_fingerprint.digest
    assert prepared.structural_fingerprint.canonical_json == source_fingerprint.canonical_payload
    assert db_session.scalar(select(func.count()).select_from(RecipeVersion)) == initial_count

    child_id = persist_prepared_recipe_fork(
        db_session,
        prepared=prepared,
        author_user_id=DEMO_USER_ID,
    )
    child_fingerprint = db_session.get(
        RecipeStructuralFingerprint,
        (child_id, STRUCTURAL_FINGERPRINT_STORAGE_VERSION),
    )

    assert child_fingerprint is not None
    assert child_fingerprint.digest == prepared.structural_fingerprint.digest
    assert child_fingerprint.canonical_payload == prepared.structural_fingerprint.canonical_json
    assert db_session.scalar(select(func.count()).select_from(RecipeVersion)) == initial_count + 1


@pytest.mark.parametrize(
    ("fingerprint_field", "fingerprint_value"),
    (
        ("algorithm_version", "recipe-structure-test-mismatch"),
        ("digest", "f" * 64),
        ("canonical_json", "{}"),
    ),
)
def test_persist_rejects_structure_that_differs_from_preparation(
    db_session: Session,
    fingerprint_field: str,
    fingerprint_value: str,
) -> None:
    source = _seed(db_session)
    initial_count = db_session.scalar(select(func.count()).select_from(RecipeVersion))
    prepared = prepare_recipe_fork(
        db_session,
        source_version_id=source.id,
        payload=_payload(),
    )
    assert prepared is not None
    if fingerprint_field == "algorithm_version":
        mismatched_fingerprint = replace(
            prepared.structural_fingerprint,
            algorithm_version=fingerprint_value,
        )
    elif fingerprint_field == "digest":
        mismatched_fingerprint = replace(
            prepared.structural_fingerprint,
            digest=fingerprint_value,
        )
    else:
        assert fingerprint_field == "canonical_json"
        mismatched_fingerprint = replace(
            prepared.structural_fingerprint,
            canonical_json=fingerprint_value,
        )
    mismatched = replace(prepared, structural_fingerprint=mismatched_fingerprint)

    with pytest.raises(PreparedRecipeFingerprintMismatchError, match="does not match"):
        with db_session.begin_nested():
            persist_prepared_recipe_fork(
                db_session,
                prepared=mismatched,
                author_user_id=DEMO_USER_ID,
            )

    assert db_session.scalar(select(func.count()).select_from(RecipeVersion)) == initial_count


def test_persist_revalidates_the_prepared_lineage_before_inserting(
    db_session: Session,
) -> None:
    source = _seed(db_session)
    initial_count = db_session.scalar(select(func.count()).select_from(RecipeVersion))
    prepared = prepare_recipe_fork(
        db_session,
        source_version_id=source.id,
        payload=_payload(),
    )
    assert prepared is not None

    with pytest.raises(RuntimeError, match="lineage is no longer available"):
        persist_prepared_recipe_fork(
            db_session,
            prepared=replace(prepared, lineage_id=uuid4()),
            author_user_id=DEMO_USER_ID,
        )

    assert db_session.scalar(select(func.count()).select_from(RecipeVersion)) == initial_count


def test_fork_actions_can_target_same_request_added_ingredients(
    db_session: Session,
) -> None:
    source = _seed(db_session)
    first_instruction_id = source.instructions[0].id
    payload = _payload(
        ingredient_edits=[
            {
                "op": "add",
                "edit_ref": "added-orange-zest",
                "ingredient_id": str(ORANGE_ZEST_ID),
                "display_name": "Orange zest",
                "measure": {
                    "kind": "exact",
                    "value": "1",
                    "unit_id": str(measurement_uuid("unit", "tbsp")),
                },
            }
        ],
        instruction_edits=[
            {
                "op": "set_actions",
                "recipe_instruction_id": str(first_instruction_id),
                "actions": [
                    {
                        "action_type_id": str(action_uuid("action-type", "bake")),
                        "ingredient_refs": [
                            {
                                "kind": "added",
                                "ingredient_edit_ref": "added-orange-zest",
                            }
                        ],
                        "duration": {
                            "kind": "range",
                            "minimum": "20",
                            "maximum": "25",
                            "unit_id": str(measurement_uuid("unit", "minute")),
                        },
                        "temperature": {
                            "kind": "exact",
                            "value": "180",
                            "unit_id": str(measurement_uuid("unit", "celsius")),
                        },
                    }
                ],
            }
        ],
    )

    prepared = prepare_recipe_fork(
        db_session,
        source_version_id=source.id,
        payload=payload,
    )
    assert prepared is not None
    child_id = persist_prepared_recipe_fork(
        db_session,
        prepared=prepared,
        author_user_id=DEMO_USER_ID,
    )
    db_session.expire_all()
    child = db_session.get(RecipeVersion, child_id)
    assert child is not None
    child_fingerprint = db_session.get(
        RecipeStructuralFingerprint,
        (child_id, STRUCTURAL_FINGERPRINT_STORAGE_VERSION),
    )
    assert child_fingerprint is not None
    assert child_fingerprint.digest == prepared.structural_fingerprint.digest
    assert child_fingerprint.canonical_payload == prepared.structural_fingerprint.canonical_json
    added = child.ingredients[-1]
    action = child.instructions[0].actions[0]

    assert added.ingredient_id == ORANGE_ZEST_ID
    assert [item.recipe_ingredient_id for item in action.inputs] == [added.id]
    measures = {measure.semantic: measure for measure in action.measures}
    assert measures["duration"].quantity_min == Decimal("20.000000")
    assert measures["duration"].quantity_max == Decimal("25.000000")
    assert measures["temperature"].quantity_min == Decimal("180.000000")


def test_fork_rejects_removed_cross_recipe_and_wrong_dimension_action_inputs_atomically(
    db_session: Session,
) -> None:
    source = _seed(db_session)
    referenced_id = source.instructions[0].actions[1].inputs[0].recipe_ingredient_id
    first_instruction_id = source.instructions[0].id
    initial_count = db_session.scalar(select(func.count()).select_from(RecipeVersion))

    with pytest.raises(InvalidRecipeEditsError, match="not present in the child recipe"):
        fork_recipe_version(
            db_session,
            source_version_id=source.id,
            author_user_id=DEMO_USER_ID,
            payload=_payload(
                ingredient_edits=[{"op": "remove", "recipe_ingredient_id": str(referenced_id)}]
            ),
        )

    with pytest.raises(InvalidRecipeEditsError, match="not present in the child recipe"):
        fork_recipe_version(
            db_session,
            source_version_id=source.id,
            author_user_id=DEMO_USER_ID,
            payload=_payload(
                instruction_edits=[
                    {
                        "op": "set_actions",
                        "recipe_instruction_id": str(first_instruction_id),
                        "actions": [
                            {
                                "action_type_id": str(action_uuid("action-type", "mix")),
                                "ingredient_refs": [
                                    {
                                        "kind": "existing",
                                        "recipe_ingredient_id": str(uuid4()),
                                    }
                                ],
                            }
                        ],
                    }
                ]
            ),
        )

    with pytest.raises(InvalidRecipeEditsError, match="measurement_semantic_mismatch"):
        fork_recipe_version(
            db_session,
            source_version_id=source.id,
            author_user_id=DEMO_USER_ID,
            payload=_payload(
                instruction_edits=[
                    {
                        "op": "set_actions",
                        "recipe_instruction_id": str(first_instruction_id),
                        "actions": [
                            {
                                "action_type_id": str(action_uuid("action-type", "mix")),
                                "duration": {
                                    "kind": "exact",
                                    "value": "1",
                                    "unit_id": str(measurement_uuid("unit", "celsius")),
                                },
                            }
                        ],
                    }
                ]
            ),
        )

    assert db_session.scalar(select(func.count()).select_from(RecipeVersion)) == initial_count
