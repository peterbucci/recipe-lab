from decimal import Decimal
from uuid import uuid4

import pytest
from pydantic import TypeAdapter, ValidationError

from app.schemas.actions import (
    AddedIngredientOccurrenceReference,
    ExistingIngredientOccurrenceReference,
    StructuredActionInput,
)
from app.schemas.measurements import ExactMeasureInput, RangeMeasureInput
from app.schemas.recipe_forks import AddInstruction, RecipeForkRequest, SetInstructionActions


def _exact(value: str, unit_id: object) -> dict[str, object]:
    return {"kind": "exact", "value": value, "unit_id": str(unit_id)}


def test_structured_action_input_preserves_ordered_refs_and_numeric_parameters() -> None:
    action_type_id = uuid4()
    existing_id = uuid4()
    added_ref = "added-ingredient-1"
    duration_unit_id = uuid4()
    temperature_unit_id = uuid4()

    action = StructuredActionInput.model_validate(
        {
            "action_type_id": str(action_type_id),
            "ingredient_refs": [
                {"kind": "existing", "recipe_ingredient_id": str(existing_id)},
                {"kind": "added", "ingredient_edit_ref": added_ref},
            ],
            "duration": _exact("5.250000", duration_unit_id),
            "temperature": {
                "kind": "range",
                "minimum": "175",
                "maximum": "180",
                "unit_id": str(temperature_unit_id),
            },
        }
    )

    assert action.action_type_id == action_type_id
    assert isinstance(action.ingredient_refs[0], ExistingIngredientOccurrenceReference)
    assert isinstance(action.ingredient_refs[1], AddedIngredientOccurrenceReference)
    assert isinstance(action.duration, ExactMeasureInput)
    assert action.duration.value == Decimal("5.250000")
    assert isinstance(action.temperature, RangeMeasureInput)
    assert action.temperature.minimum == Decimal("175")


def test_structured_action_rejects_qualitative_parameters_and_duplicate_refs() -> None:
    action_type_id = uuid4()
    ingredient_id = uuid4()
    with pytest.raises(ValidationError):
        StructuredActionInput.model_validate(
            {
                "action_type_id": str(action_type_id),
                "duration": {"kind": "qualitative", "value": "as_needed"},
            }
        )

    with pytest.raises(ValidationError, match="same ingredient occurrence twice"):
        StructuredActionInput.model_validate(
            {
                "action_type_id": str(action_type_id),
                "ingredient_refs": [
                    {"kind": "existing", "recipe_ingredient_id": str(ingredient_id)},
                    {"kind": "existing", "recipe_ingredient_id": str(ingredient_id)},
                ],
            }
        )


def test_instruction_edits_require_nonempty_actions_for_new_or_replaced_sequences() -> None:
    adapter: TypeAdapter[AddInstruction | SetInstructionActions] = TypeAdapter(
        AddInstruction | SetInstructionActions
    )
    with pytest.raises(ValidationError):
        adapter.validate_python({"op": "add", "text": "Mix thoroughly.", "actions": []})
    with pytest.raises(ValidationError):
        adapter.validate_python(
            {
                "op": "set_actions",
                "recipe_instruction_id": str(uuid4()),
                "actions": [],
            }
        )


def test_fork_request_rejects_duplicate_added_ingredient_edit_refs() -> None:
    edit_ref = "added-ingredient-1"
    ingredient_id = uuid4()
    unit_id = uuid4()
    payload = {
        "title": "Duplicate refs",
        "description": None,
        "servings": "1",
        "ingredient_edits": [
            {
                "op": "add",
                "edit_ref": edit_ref,
                "ingredient_id": str(ingredient_id),
                "display_name": "Ingredient",
                "measure": _exact("1", unit_id),
            },
            {
                "op": "add",
                "edit_ref": edit_ref,
                "ingredient_id": str(ingredient_id),
                "display_name": "Ingredient",
                "measure": _exact("2", unit_id),
            },
        ],
        "instruction_edits": [],
    }

    with pytest.raises(ValidationError, match="edit_ref values must be unique"):
        RecipeForkRequest.model_validate(payload)
