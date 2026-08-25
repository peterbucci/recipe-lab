from copy import deepcopy
from typing import cast
from uuid import UUID, uuid4

from app.schemas.recipe_forks import RecipeForkRequest
from app.seeds.identifiers import action_uuid, measurement_uuid
from app.services.preference_events import recipe_fork_request_fingerprint

SOURCE_ID = UUID("99000000-0000-4000-8000-000000000001")
INGREDIENT_ROW_ID = UUID("99000000-0000-4000-8000-000000000002")
OTHER_INGREDIENT_ROW_ID = UUID("99000000-0000-4000-8000-000000000003")
INSTRUCTION_ROW_ID = UUID("99000000-0000-4000-8000-000000000004")


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


def _action_payload() -> dict[str, object]:
    payload = _payload()
    payload["instruction_edits"] = [
        {
            "op": "set_actions",
            "recipe_instruction_id": str(INSTRUCTION_ROW_ID),
            "actions": [
                {
                    "action_type_id": str(action_uuid("action-type", "mix")),
                    "ingredient_refs": [
                        {
                            "kind": "existing",
                            "recipe_ingredient_id": str(INGREDIENT_ROW_ID),
                        }
                    ],
                    "duration": {
                        "kind": "exact",
                        "value": "5.0",
                        "unit_id": str(measurement_uuid("unit", "minute")),
                    },
                },
                {
                    "action_type_id": str(action_uuid("action-type", "bake")),
                    "ingredient_refs": [],
                    "temperature": {
                        "kind": "exact",
                        "value": "180",
                        "unit_id": str(measurement_uuid("unit", "celsius")),
                    },
                },
            ],
        }
    ]
    return payload


def _actions(payload: dict[str, object]) -> list[dict[str, object]]:
    edits = cast(list[dict[str, object]], payload["instruction_edits"])
    return cast(list[dict[str, object]], edits[0]["actions"])


def test_structured_action_fingerprint_covers_graph_order_inputs_and_parameters() -> None:
    original = _action_payload()
    equivalent = deepcopy(original)
    equivalent_duration = cast(dict[str, object], _actions(equivalent)[0]["duration"])
    equivalent_duration["value"] = "5.0000"

    changed_type = deepcopy(original)
    _actions(changed_type)[0]["action_type_id"] = str(action_uuid("action-type", "fold"))

    changed_input = deepcopy(original)
    changed_refs = cast(list[dict[str, object]], _actions(changed_input)[0]["ingredient_refs"])
    changed_refs[0]["recipe_ingredient_id"] = str(OTHER_INGREDIENT_ROW_ID)

    changed_duration = deepcopy(original)
    duration = cast(dict[str, object], _actions(changed_duration)[0]["duration"])
    duration["value"] = "6"

    changed_temperature = deepcopy(original)
    temperature = cast(dict[str, object], _actions(changed_temperature)[1]["temperature"])
    temperature["value"] = "190"

    changed_order = deepcopy(original)
    _actions(changed_order).reverse()

    original_fingerprint = _fingerprint(original)
    assert _fingerprint(equivalent) == original_fingerprint
    assert _fingerprint(changed_type) != original_fingerprint
    assert _fingerprint(changed_input) != original_fingerprint
    assert _fingerprint(changed_duration) != original_fingerprint
    assert _fingerprint(changed_temperature) != original_fingerprint
    assert _fingerprint(changed_order) != original_fingerprint
