from copy import deepcopy
from typing import cast
from uuid import UUID, uuid4

from app.schemas.recipe_forks import RecipeForkRequest
from app.seeds.identifiers import measurement_uuid
from app.services.preference_events import recipe_fork_request_fingerprint

SOURCE_ID = UUID("99000000-0000-4000-8000-000000000001")
INGREDIENT_ROW_ID = UUID("99000000-0000-4000-8000-000000000002")


def _payload() -> dict[str, object]:
    return {
        "title": "Structured fingerprint",
        "description": None,
        "servings": "4.00",
        "ingredient_edits": [
            {
                "op": "set_measure",
                "recipe_ingredient_id": str(INGREDIENT_ROW_ID),
                "measure": {
                    "kind": "range",
                    "minimum": "1.0",
                    "maximum": "2.0000",
                    "unit_id": str(measurement_uuid("unit", "g")),
                },
            }
        ],
        "instruction_edits": [],
    }


def _fingerprint(payload: dict[str, object]) -> str:
    request = RecipeForkRequest.model_validate(payload)
    return recipe_fork_request_fingerprint(SOURCE_ID, request)


def _measure(payload: dict[str, object]) -> dict[str, object]:
    edits = cast(list[dict[str, object]], payload["ingredient_edits"])
    return cast(dict[str, object], edits[0]["measure"])


def test_structured_measure_fingerprint_normalizes_decimals_but_retains_semantics() -> None:
    original = _payload()
    equivalent = deepcopy(original)
    equivalent_measure = _measure(equivalent)
    equivalent_measure["minimum"] = "1.0000"
    equivalent_measure["maximum"] = "2"

    changed_value = deepcopy(original)
    _measure(changed_value)["maximum"] = "3"

    changed_unit = deepcopy(original)
    _measure(changed_unit)["unit_id"] = str(measurement_uuid("unit", "kg"))

    changed_package = deepcopy(original)
    _measure(changed_package)["package_size_id"] = str(uuid4())

    original_fingerprint = _fingerprint(original)
    assert _fingerprint(equivalent) == original_fingerprint
    assert _fingerprint(changed_value) != original_fingerprint
    assert _fingerprint(changed_unit) != original_fingerprint
    assert _fingerprint(changed_package) != original_fingerprint
