from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from app.core.demo_identity import DEMO_USER_DISPLAY_NAME, DEMO_USER_ID
from app.models import (
    ACCOUNT_KIND_DEMO,
    ACCOUNT_KIND_MEMBER,
    ACCOUNT_KIND_SYSTEM,
    USER_STATUS_DELETED,
    CookingActionType,
    Ingredient,
    RecipeIngredient,
    RecipeInstruction,
    RecipeInstructionAction,
    User,
)
from app.services.recipe_responses import (
    public_user_reference,
    recipe_ingredient_response,
    recipe_instruction_response,
)


def _id(value: int) -> UUID:
    return UUID(int=value)


def test_public_user_reference_preserves_handleless_demo_identity() -> None:
    demo_user = User(
        id=DEMO_USER_ID,
        email="demo-cook@recipe-lab.invalid",
        display_name="Legacy label that is not exposed",
        handle=None,
        account_kind=ACCOUNT_KIND_DEMO,
    )

    assert public_user_reference(demo_user).model_dump(mode="json") == {
        "id": str(demo_user.id),
        "handle": None,
        "display_name": DEMO_USER_DISPLAY_NAME,
    }


def test_public_user_reference_projects_deleted_identity() -> None:
    deleted_user = User(
        id=uuid4(),
        email=None,
        display_name="Deleted cook",
        handle=None,
        account_kind=ACCOUNT_KIND_MEMBER,
        status=USER_STATUS_DELETED,
        deleted_at=datetime.now(UTC),
    )

    assert public_user_reference(deleted_user).model_dump(mode="json") == {
        "id": str(deleted_user.id),
        "handle": None,
        "display_name": "Deleted cook",
    }


@pytest.mark.parametrize(
    "account_kind", [ACCOUNT_KIND_MEMBER, ACCOUNT_KIND_SYSTEM, ACCOUNT_KIND_DEMO]
)
def test_public_user_reference_rejects_other_handleless_active_users(
    account_kind: str,
) -> None:
    user = User(
        id=uuid4(),
        email="incomplete@example.test",
        display_name="Incomplete user",
        handle=None,
        account_kind=account_kind,
    )

    with pytest.raises(RuntimeError, match="does not have a public handle"):
        public_user_reference(user)


def test_public_child_responses_preserve_wire_fields_and_action_order() -> None:
    version_id = _id(1)
    catalog_ingredient = Ingredient(id=_id(2), canonical_name="Tomato")
    ingredient = RecipeIngredient(
        id=_id(3),
        recipe_version_id=version_id,
        ingredient_id=catalog_ingredient.id,
        ingredient=catalog_ingredient,
        name="Cherry tomatoes",
        measure_mode="unspecified",
        quantity_min=None,
        quantity_max=None,
        measurement_unit_id=None,
        measurement_unit=None,
        unit_display=None,
        package_size_id=None,
        preparation_notes="halved",
        display_order=4,
    )
    assert recipe_ingredient_response(ingredient).model_dump(mode="json") == {
        "id": str(ingredient.id),
        "ingredient_id": str(catalog_ingredient.id),
        "canonical_name": "Tomato",
        "display_name": "Cherry tomatoes",
        "measure": {
            "kind": "qualitative",
            "value": "unspecified",
            "unit": None,
            "display_unit": None,
            "display": "amount unspecified",
        },
        "preparation_notes": "halved",
        "display_order": 4,
    }

    action_type = CookingActionType(
        id=_id(5),
        key="mix",
        canonical_verb="mix",
        active=True,
        provenance="Test fixture.",
    )

    def action(*, action_id: int, display_order: int) -> RecipeInstructionAction:
        item = RecipeInstructionAction(
            id=_id(action_id),
            recipe_version_id=version_id,
            recipe_instruction_id=_id(4),
            action_type_id=action_type.id,
            action_type=action_type,
            display_order=display_order,
        )
        item.inputs = []
        item.measures = []
        return item

    instruction = RecipeInstruction(
        id=_id(4),
        recipe_version_id=version_id,
        title="Combine",
        instruction="Mix the tomatoes.",
        display_order=2,
    )
    instruction.actions = [
        action(action_id=30, display_order=1),
        action(action_id=20, display_order=0),
        action(action_id=10, display_order=0),
    ]

    response = recipe_instruction_response(instruction).model_dump(mode="json")
    assert {key: response[key] for key in ("id", "title", "text", "display_order")} == {
        "id": str(instruction.id),
        "title": "Combine",
        "text": "Mix the tomatoes.",
        "display_order": 2,
    }
    assert [item["id"] for item in response["actions"]] == [
        str(_id(10)),
        str(_id(20)),
        str(_id(30)),
    ]
