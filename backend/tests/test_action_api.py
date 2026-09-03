from typing import cast
from uuid import uuid4

from fastapi.testclient import TestClient
from pytest import MonkeyPatch
from sqlalchemy.orm import Session

from app.api.routes import actions as action_routes
from app.main import create_app
from app.models import CookingActionType
from tests.application import application_with_session

TEST_SESSION = cast(Session, object())


def _action_type(*, active: bool = True) -> CookingActionType:
    return CookingActionType(
        id=uuid4(),
        key="test-fold",
        canonical_verb="Fold",
        active=active,
        provenance="Reviewed action API-test metadata.",
    )


def test_action_catalog_returns_the_bounded_reviewed_contract(
    monkeypatch: MonkeyPatch,
) -> None:
    action_type = _action_type()
    observed: dict[str, object] = {}

    def list_actions(session: Session, *, limit: int) -> list[CookingActionType]:
        observed.update(session=session, limit=limit)
        return [action_type]

    monkeypatch.setattr(action_routes, "list_active_cooking_action_types", list_actions)
    with application_with_session(TEST_SESSION) as application:
        with TestClient(application) as client:
            response = client.get("/api/cooking-action-types", params={"limit": 12})

    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {
                "id": str(action_type.id),
                "key": "test-fold",
                "canonical_verb": "Fold",
                "active": True,
                "provenance": "Reviewed action API-test metadata.",
            }
        ]
    }
    assert observed == {"session": TEST_SESSION, "limit": 12}


def test_action_catalog_openapi_is_read_only_and_documents_nested_recipe_actions() -> None:
    application = create_app()
    with TestClient(application) as client:
        document = client.get("/openapi.json").json()

    paths = document["paths"]
    schemas = document["components"]["schemas"]
    assert set(paths["/api/cooking-action-types"]) >= {"get"}
    assert "post" not in paths["/api/cooking-action-types"]
    assert schemas["CookingActionTypeCatalogItem"]["additionalProperties"] is False
    action_properties = schemas["RecipeInstructionActionResponse"]["properties"]
    assert set(action_properties) == {
        "id",
        "action_type",
        "display_order",
        "ingredient_occurrence_ids",
        "duration",
        "temperature",
    }
    instruction_actions = schemas["RecipeInstructionResponse"]["properties"]["actions"]
    assert instruction_actions["items"] == {
        "$ref": "#/components/schemas/RecipeInstructionActionResponse"
    }
