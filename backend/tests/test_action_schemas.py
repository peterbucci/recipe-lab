from decimal import Decimal
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.actions import (
    AddedIngredientOccurrenceReference,
    ExistingIngredientOccurrenceReference,
    StructuredActionInput,
)
from app.schemas.measurements import ExactMeasureInput, RangeMeasureInput


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
