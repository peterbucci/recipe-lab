from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.demo_identity import DEMO_USER_ID
from app.models import RecipeVersion
from app.repositories.recipes import get_recipe_version
from app.schemas.recipe_forks import RecipeForkRequest
from app.seeds import load_bundled_catalog, seed_catalog
from app.seeds.identifiers import action_uuid, measurement_uuid, seed_uuid
from app.services.recipe_forks import InvalidRecipeEditsError, fork_recipe_version

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
    child = get_recipe_version(db_session, child_id)
    assert child is not None
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

    child_id = fork_recipe_version(
        db_session,
        source_version_id=source.id,
        author_user_id=DEMO_USER_ID,
        payload=payload,
    )
    assert child_id is not None
    db_session.expire_all()
    child = get_recipe_version(db_session, child_id)
    assert child is not None
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
