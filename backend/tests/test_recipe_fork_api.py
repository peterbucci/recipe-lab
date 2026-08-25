from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from decimal import Decimal
from threading import Barrier
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, delete, func, select
from sqlalchemy.orm import Session

import app.api.routes.recipes as recipe_routes
from app.api.dependencies import get_session
from app.main import create_app
from app.models import (
    Ingredient,
    IngredientAlias,
    IngredientPackageSize,
    MeasurementUnit,
    PreferenceEvent,
    RecipeIngredient,
    RecipeInstruction,
    RecipeInstructionAction,
    RecipeInstructionActionInput,
    RecipeInstructionActionMeasure,
    RecipeLineage,
    RecipeRating,
    RecipeSave,
    RecipeVersion,
    User,
)
from app.schemas.recipe_forks import RecipeForkRequest
from app.seeds.identifiers import action_uuid, measurement_uuid, seed_uuid
from app.seeds.loader import CATALOG_USER_KEY
from app.services.recipe_forks import InvalidRecipeEditsError, fork_recipe_version
from tests.member_session import (
    MemberCredentials,
    authenticate_client,
    create_member_credentials,
)

DATASET_ID = "recipe-lab-demo-v1"
CARROT_ROOT_KEY = "carrot-walnut-snack-cake-v1"
CARROT_PECAN_KEY = "lower-sugar-pecan-carrot-cake-v2"
PASTA_ROOT_KEY = "tomato-basil-spaghetti-v1"

CARROT_ROOT_ID = seed_uuid(DATASET_ID, "recipe-version", CARROT_ROOT_KEY)
CARROT_PECAN_ID = seed_uuid(DATASET_ID, "recipe-version", CARROT_PECAN_KEY)
CARROT_LINEAGE_ID = seed_uuid(DATASET_ID, "recipe-lineage", CARROT_ROOT_KEY)
CATALOG_USER_ID = seed_uuid(DATASET_ID, "user", CATALOG_USER_KEY)

SUGAR_ROW_ID = seed_uuid(DATASET_ID, "recipe-ingredient", f"{CARROT_ROOT_KEY}:sugar")
NUTS_ROW_ID = seed_uuid(DATASET_ID, "recipe-ingredient", f"{CARROT_ROOT_KEY}:nuts")
FLOUR_ROW_ID = seed_uuid(DATASET_ID, "recipe-ingredient", f"{CARROT_ROOT_KEY}:flour")
CARROT_ROW_ID = seed_uuid(DATASET_ID, "recipe-ingredient", f"{CARROT_ROOT_KEY}:carrot")
EGGS_ROW_ID = seed_uuid(DATASET_ID, "recipe-ingredient", f"{CARROT_ROOT_KEY}:eggs")
OIL_ROW_ID = seed_uuid(DATASET_ID, "recipe-ingredient", f"{CARROT_ROOT_KEY}:oil")
CINNAMON_ROW_ID = seed_uuid(
    DATASET_ID,
    "recipe-ingredient",
    f"{CARROT_ROOT_KEY}:cinnamon",
)
BAKING_POWDER_ROW_ID = seed_uuid(
    DATASET_ID,
    "recipe-ingredient",
    f"{CARROT_ROOT_KEY}:baking-powder",
)
BAKING_SODA_ROW_ID = seed_uuid(
    DATASET_ID,
    "recipe-ingredient",
    f"{CARROT_ROOT_KEY}:baking-soda",
)
FOREIGN_INGREDIENT_ROW_ID = seed_uuid(
    DATASET_ID,
    "recipe-ingredient",
    f"{PASTA_ROOT_KEY}:spaghetti",
)
MIX_DRY_INSTRUCTION_ID = seed_uuid(
    DATASET_ID,
    "recipe-instruction",
    f"{CARROT_ROOT_KEY}:mix-dry",
)
COMBINE_INSTRUCTION_ID = seed_uuid(
    DATASET_ID,
    "recipe-instruction",
    f"{CARROT_ROOT_KEY}:combine",
)
BAKE_INSTRUCTION_ID = seed_uuid(
    DATASET_ID,
    "recipe-instruction",
    f"{CARROT_ROOT_KEY}:bake",
)
PECAN_ID = seed_uuid(DATASET_ID, "ingredient", "pecan")
ORANGE_ZEST_ID = seed_uuid(DATASET_ID, "ingredient", "orange-zest")
CHICKPEA_ID = seed_uuid(DATASET_ID, "ingredient", "chickpea")
WALNUT_ID = seed_uuid(DATASET_ID, "ingredient", "walnut")
SUGAR_ID = seed_uuid(DATASET_ID, "ingredient", "granulated-sugar")
UNKNOWN_INGREDIENT_ID = UUID("77000000-0000-4000-8000-000000000099")
MEMBER_USER_ID = UUID("77000000-0000-4000-8000-000000000002")
CUP_UNIT_ID = measurement_uuid("unit", "cup")
TBSP_UNIT_ID = measurement_uuid("unit", "tbsp")
G_UNIT_ID = measurement_uuid("unit", "g")
CAN_UNIT_ID = measurement_uuid("unit", "can")


@dataclass(frozen=True, slots=True)
class IngredientSnapshot:
    id: UUID
    ingredient_id: UUID
    name: str
    measure_mode: str
    quantity_min: Decimal | None
    quantity_max: Decimal | None
    measurement_unit_id: UUID | None
    unit_display: str | None
    package_size_id: UUID | None
    preparation_notes: str | None
    display_order: int


@dataclass(frozen=True, slots=True)
class InstructionSnapshot:
    id: UUID
    text: str
    display_order: int


@dataclass(frozen=True, slots=True)
class VersionSnapshot:
    id: UUID
    lineage_id: UUID
    parent_version_id: UUID | None
    created_by_user_id: UUID
    version_number: int
    title: str
    description: str | None
    servings: Decimal
    created_at: object
    ingredients: tuple[IngredientSnapshot, ...]
    instructions: tuple[InstructionSnapshot, ...]


def _clear_member_forks(engine: Engine) -> None:
    fork_ids = select(RecipeVersion.id).where(RecipeVersion.created_by_user_id == MEMBER_USER_ID)
    action_ids = select(RecipeInstructionAction.id).where(
        RecipeInstructionAction.recipe_version_id.in_(fork_ids)
    )
    with Session(bind=engine) as session, session.begin():
        session.execute(delete(PreferenceEvent).where(PreferenceEvent.user_id == MEMBER_USER_ID))
        session.execute(delete(RecipeRating).where(RecipeRating.recipe_version_id.in_(fork_ids)))
        session.execute(delete(RecipeSave).where(RecipeSave.recipe_version_id.in_(fork_ids)))
        session.execute(
            delete(RecipeInstructionActionMeasure).where(
                RecipeInstructionActionMeasure.recipe_instruction_action_id.in_(action_ids)
            )
        )
        session.execute(
            delete(RecipeInstructionActionInput).where(
                RecipeInstructionActionInput.recipe_version_id.in_(fork_ids)
            )
        )
        session.execute(
            delete(RecipeInstructionAction).where(
                RecipeInstructionAction.recipe_version_id.in_(fork_ids)
            )
        )
        session.execute(
            delete(RecipeIngredient).where(RecipeIngredient.recipe_version_id.in_(fork_ids))
        )
        session.execute(
            delete(RecipeInstruction).where(RecipeInstruction.recipe_version_id.in_(fork_ids))
        )
        session.execute(
            delete(RecipeVersion).where(RecipeVersion.created_by_user_id == MEMBER_USER_ID)
        )


@pytest.fixture(autouse=True)
def clean_member_forks(seeded_api_engine: Engine) -> Iterator[None]:
    _clear_member_forks(seeded_api_engine)
    try:
        yield
    finally:
        _clear_member_forks(seeded_api_engine)


@pytest.fixture(autouse=True)
def test_member_credentials(
    seeded_api_engine: Engine,
    clean_member_forks: None,
) -> Iterator[MemberCredentials]:
    credentials = create_member_credentials(seeded_api_engine, user_id=MEMBER_USER_ID)
    try:
        yield credentials
    finally:
        _clear_member_forks(seeded_api_engine)
        with Session(bind=seeded_api_engine) as session, session.begin():
            session.execute(delete(User).where(User.id == MEMBER_USER_ID))


@pytest.fixture
def fork_client(
    seeded_api_engine: Engine,
    test_member_credentials: MemberCredentials,
) -> Iterator[TestClient]:
    application = create_app()

    def override_session() -> Iterator[Session]:
        with Session(bind=seeded_api_engine) as session:
            yield session

    application.dependency_overrides[get_session] = override_session
    try:
        with TestClient(application) as client:
            authenticate_client(client, test_member_credentials)
            yield client
    finally:
        application.dependency_overrides.clear()


def _base_payload(*, title: str = "My Carrot Cake") -> dict[str, Any]:
    return {
        "title": title,
        "description": "A structured member variant.",
        "servings": "8.00",
        "ingredient_edits": [],
        "instruction_edits": [],
    }


def _exact_measure(value: object, unit_id: UUID) -> dict[str, object]:
    return {"kind": "exact", "value": value, "unit_id": str(unit_id)}


def _qualitative_measure(value: str = "unspecified") -> dict[str, str]:
    return {"kind": "qualitative", "value": value}


def _structured_action(
    action_type_key: str,
    *ingredient_occurrence_ids: UUID,
) -> dict[str, object]:
    return {
        "action_type_id": str(action_uuid("action-type", action_type_key)),
        "ingredient_refs": [
            {
                "kind": "existing",
                "recipe_ingredient_id": str(ingredient_occurrence_id),
            }
            for ingredient_occurrence_id in ingredient_occurrence_ids
        ],
    }


def _action_headers(action_id: UUID | None = None) -> dict[str, str]:
    return {"Idempotency-Key": str(action_id or uuid4())}


def _snapshot_version(engine: Engine, recipe_version_id: UUID) -> VersionSnapshot:
    with Session(bind=engine) as session:
        version = session.get(RecipeVersion, recipe_version_id)
        assert version is not None
        ingredients = tuple(
            IngredientSnapshot(
                id=item.id,
                ingredient_id=item.ingredient_id,
                name=item.name,
                measure_mode=item.measure_mode,
                quantity_min=item.quantity_min,
                quantity_max=item.quantity_max,
                measurement_unit_id=item.measurement_unit_id,
                unit_display=item.unit_display,
                package_size_id=item.package_size_id,
                preparation_notes=item.preparation_notes,
                display_order=item.display_order,
            )
            for item in session.scalars(
                select(RecipeIngredient)
                .where(RecipeIngredient.recipe_version_id == recipe_version_id)
                .order_by(RecipeIngredient.display_order)
            )
        )
        instructions = tuple(
            InstructionSnapshot(
                id=item.id,
                text=item.instruction,
                display_order=item.display_order,
            )
            for item in session.scalars(
                select(RecipeInstruction)
                .where(RecipeInstruction.recipe_version_id == recipe_version_id)
                .order_by(RecipeInstruction.display_order)
            )
        )
        return VersionSnapshot(
            id=version.id,
            lineage_id=version.lineage_id,
            parent_version_id=version.parent_version_id,
            created_by_user_id=version.created_by_user_id,
            version_number=version.version_number,
            title=version.title,
            description=version.description,
            servings=version.servings,
            created_at=version.created_at,
            ingredients=ingredients,
            instructions=instructions,
        )


def _ingredient_values(items: tuple[IngredientSnapshot, ...]) -> list[tuple[object, ...]]:
    return [
        (
            item.ingredient_id,
            item.name,
            item.measure_mode,
            item.quantity_min,
            item.quantity_max,
            item.measurement_unit_id,
            item.unit_display,
            item.package_size_id,
            item.preparation_notes,
            item.display_order,
        )
        for item in items
    ]


def _instruction_values(items: tuple[InstructionSnapshot, ...]) -> list[tuple[object, ...]]:
    return [(item.text, item.display_order) for item in items]


def _member_fork_count(engine: Engine) -> int:
    with Session(bind=engine) as session:
        return (
            session.scalar(
                select(func.count())
                .select_from(RecipeVersion)
                .where(RecipeVersion.created_by_user_id == MEMBER_USER_ID)
            )
            or 0
        )


def _member_fork_event_count(engine: Engine) -> int:
    with Session(bind=engine) as session:
        return (
            session.scalar(
                select(func.count())
                .select_from(PreferenceEvent)
                .where(
                    PreferenceEvent.user_id == MEMBER_USER_ID,
                    PreferenceEvent.event_type == "fork",
                )
            )
            or 0
        )


def _catalog_snapshot(
    engine: Engine,
) -> tuple[tuple[tuple[UUID, str], ...], tuple[tuple[UUID, UUID, str], ...]]:
    with Session(bind=engine) as session:
        ingredients = tuple(
            session.execute(
                select(Ingredient.id, Ingredient.canonical_name).order_by(Ingredient.id)
            ).tuples()
        )
        aliases = tuple(
            session.execute(
                select(
                    IngredientAlias.id,
                    IngredientAlias.ingredient_id,
                    IngredientAlias.alias,
                ).order_by(IngredientAlias.id)
            ).tuples()
        )
    return ingredients, aliases


def _json_object(value: object) -> dict[str, Any]:
    return cast(dict[str, Any], value)


def test_fork_copies_snapshot_and_persists_lineage_parent_and_author(
    fork_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    parent_before = _snapshot_version(seeded_api_engine, CARROT_ROOT_ID)

    response = fork_client.post(
        f"/api/recipes/{CARROT_ROOT_ID}/variants",
        json=_base_payload(),
        headers=_action_headers(),
    )

    assert response.status_code == 201, response.text
    detail = _json_object(response.json())
    child_id = UUID(detail["id"])
    assert response.headers["location"] == f"/api/recipes/{child_id}"
    assert detail["lineage_id"] == str(CARROT_LINEAGE_ID)
    assert detail["parent_version_id"] == str(CARROT_ROOT_ID)
    assert detail["parent"]["id"] == str(CARROT_ROOT_ID)
    assert detail["version_number"] == 4
    assert detail["children"] == []
    assert detail["average_rating"] is None
    assert detail["rating_count"] == 0
    assert detail["viewer_state"]["saved"] is False
    assert detail["viewer_state"]["rating"] is None

    child = _snapshot_version(seeded_api_engine, child_id)
    assert child.lineage_id == CARROT_LINEAGE_ID
    assert child.parent_version_id == CARROT_ROOT_ID
    assert child.created_by_user_id == MEMBER_USER_ID
    assert child.version_number == 4
    assert child.title == "My Carrot Cake"
    assert child.description == "A structured member variant."
    assert child.servings == Decimal("8.00")
    assert {item.id for item in child.ingredients}.isdisjoint(
        item.id for item in parent_before.ingredients
    )
    assert {item.id for item in child.instructions}.isdisjoint(
        item.id for item in parent_before.instructions
    )
    assert _ingredient_values(child.ingredients) == _ingredient_values(parent_before.ingredients)
    assert _instruction_values(child.instructions) == _instruction_values(
        parent_before.instructions
    )
    assert _snapshot_version(seeded_api_engine, CARROT_ROOT_ID) == parent_before

    with Session(bind=seeded_api_engine) as session:
        lineage = session.get(RecipeLineage, CARROT_LINEAGE_ID)
        assert lineage is not None
        assert lineage.created_by_user_id == CATALOG_USER_ID
        parent = session.get(RecipeVersion, CARROT_ROOT_ID)
        assert parent is not None
        assert parent.created_by_user_id == CATALOG_USER_ID
        assert (
            session.get(
                RecipeSave,
                {"user_id": MEMBER_USER_ID, "recipe_version_id": child_id},
            )
            is None
        )
        assert (
            session.get(
                RecipeRating,
                {"user_id": MEMBER_USER_ID, "recipe_version_id": child_id},
            )
            is None
        )

    refreshed_parent = _json_object(fork_client.get(f"/api/recipes/{CARROT_ROOT_ID}").json())
    assert child_id in {UUID(item["id"]) for item in refreshed_parent["children"]}


def test_fork_from_variant_uses_direct_parent_and_lineage_wide_number(
    fork_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    response = fork_client.post(
        f"/api/recipes/{CARROT_PECAN_ID}/variants",
        json=_base_payload(title="A Child of the Pecan Variant"),
        headers=_action_headers(),
    )

    assert response.status_code == 201
    detail = _json_object(response.json())
    child = _snapshot_version(seeded_api_engine, UUID(detail["id"]))
    assert child.lineage_id == CARROT_LINEAGE_ID
    assert child.parent_version_id == CARROT_PECAN_ID
    assert child.version_number == 4
    assert child.created_by_user_id == MEMBER_USER_ID
    assert detail["parent"]["id"] == str(CARROT_PECAN_ID)


def test_fork_applies_all_structured_edits_without_mutating_parent(
    fork_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    parent_before = _snapshot_version(seeded_api_engine, CARROT_ROOT_ID)
    payload = _base_payload(title="Orange Pecan Carrot Cake")
    payload["ingredient_edits"] = [
        {
            "op": "set_measure",
            "recipe_ingredient_id": str(SUGAR_ROW_ID),
            "measure": _exact_measure("1.2500", CUP_UNIT_ID),
        },
        {
            "op": "replace",
            "recipe_ingredient_id": str(NUTS_ROW_ID),
            "ingredient_id": str(PECAN_ID),
            "display_name": "Pecan",
        },
        {
            "op": "remove",
            "recipe_ingredient_id": str(BAKING_SODA_ROW_ID),
        },
        {
            "op": "add",
            "ingredient_id": str(ORANGE_ZEST_ID),
            "display_name": "Orange zest",
            "measure": _exact_measure("1", TBSP_UNIT_ID),
            "preparation_notes": "finely grated",
        },
    ]
    payload["instruction_edits"] = [
        {
            "op": "update",
            "recipe_instruction_id": str(MIX_DRY_INSTRUCTION_ID),
            "text": "Whisk the dry ingredients until evenly combined.",
        },
        {
            "op": "set_actions",
            "recipe_instruction_id": str(MIX_DRY_INSTRUCTION_ID),
            "actions": [
                _structured_action(
                    "whisk",
                    FLOUR_ROW_ID,
                    CINNAMON_ROW_ID,
                    BAKING_POWDER_ROW_ID,
                )
            ],
        },
        {
            "op": "set_actions",
            "recipe_instruction_id": str(COMBINE_INSTRUCTION_ID),
            "actions": [
                _structured_action("whisk", SUGAR_ROW_ID, EGGS_ROW_ID, OIL_ROW_ID),
                _structured_action(
                    "fold",
                    FLOUR_ROW_ID,
                    CINNAMON_ROW_ID,
                    BAKING_POWDER_ROW_ID,
                ),
                _structured_action("fold", CARROT_ROW_ID, NUTS_ROW_ID),
            ],
        },
        {
            "op": "remove",
            "recipe_instruction_id": str(BAKE_INSTRUCTION_ID),
        },
        {
            "op": "add",
            "text": "Bake until springy in the center, then cool completely.",
            "actions": [_structured_action("bake")],
        },
    ]

    response = fork_client.post(
        f"/api/recipes/{CARROT_ROOT_ID}/variants",
        json=payload,
        headers=_action_headers(),
    )

    assert response.status_code == 201, response.text
    detail = _json_object(response.json())
    ingredients = cast(list[dict[str, Any]], detail["ingredients"])
    instructions = cast(list[dict[str, Any]], detail["instructions"])
    assert [item["display_order"] for item in ingredients] == list(range(9))
    assert [item["display_name"] for item in ingredients] == [
        "All-purpose flour",
        "Carrot",
        "White sugar",
        "Egg",
        "Vegetable oil",
        "Pecan",
        "Cinnamon",
        "Baking powder",
        "Orange zest",
    ]
    sugar = ingredients[2]
    assert sugar["measure"]["value"] == "1.2500"
    assert sugar["measure"]["unit"]["id"] == str(CUP_UNIT_ID)
    pecan = ingredients[5]
    assert pecan["ingredient_id"] == str(PECAN_ID)
    assert pecan["canonical_name"] == "Pecan"
    assert pecan["measure"]["value"] == "100.0000"
    assert pecan["preparation_notes"] == "roughly chopped"
    orange_zest = ingredients[-1]
    assert orange_zest["ingredient_id"] == str(ORANGE_ZEST_ID)
    assert orange_zest["preparation_notes"] == "finely grated"

    assert [item["display_order"] for item in instructions] == list(range(4))
    assert [item["text"] for item in instructions] == [
        parent_before.instructions[0].text,
        "Whisk the dry ingredients until evenly combined.",
        parent_before.instructions[2].text,
        "Bake until springy in the center, then cool completely.",
    ]
    assert _snapshot_version(seeded_api_engine, CARROT_ROOT_ID) == parent_before


def test_replacing_ingredient_clears_ingredient_specific_package_metadata(
    seeded_api_engine: Engine,
) -> None:
    package_size_id = uuid4()
    with Session(bind=seeded_api_engine) as session:
        transaction = session.begin()
        try:
            package_size = IngredientPackageSize(
                id=package_size_id,
                ingredient_id=WALNUT_ID,
                package_unit_id=CAN_UNIT_ID,
                content_unit_id=G_UNIT_ID,
                content_value=Decimal("400.000000"),
                label="400 g fork replacement test can",
                active=True,
                provenance="Reviewed fork replacement test package size.",
            )
            session.add(package_size)
            session.flush()
            source_row = session.get(RecipeIngredient, NUTS_ROW_ID)
            assert source_row is not None
            source_row.measure_mode = "exact"
            source_row.quantity_min = Decimal("1.0000")
            source_row.quantity_max = None
            source_row.measurement_unit_id = CAN_UNIT_ID
            source_row.unit_display = "can"
            source_row.package_size_id = package_size.id
            session.flush()

            payload = RecipeForkRequest.model_validate(
                {
                    **_base_payload(title="Package-safe pecan replacement"),
                    "ingredient_edits": [
                        {
                            "op": "replace",
                            "recipe_ingredient_id": str(NUTS_ROW_ID),
                            "ingredient_id": str(PECAN_ID),
                            "display_name": "Pecan",
                        }
                    ],
                }
            )
            child_id = fork_recipe_version(
                session,
                source_version_id=CARROT_ROOT_ID,
                author_user_id=MEMBER_USER_ID,
                payload=payload,
            )
            assert child_id is not None
            session.flush()

            replacement = session.scalar(
                select(RecipeIngredient).where(
                    RecipeIngredient.recipe_version_id == child_id,
                    RecipeIngredient.ingredient_id == PECAN_ID,
                )
            )
            assert replacement is not None
            assert replacement.package_size_id is None
        finally:
            transaction.rollback()


def test_fork_persists_matching_reviewed_package_metadata(
    seeded_api_engine: Engine,
) -> None:
    package_size_id = uuid4()
    with Session(bind=seeded_api_engine) as session:
        transaction = session.begin()
        try:
            session.add(
                IngredientPackageSize(
                    id=package_size_id,
                    ingredient_id=WALNUT_ID,
                    package_unit_id=CAN_UNIT_ID,
                    content_unit_id=G_UNIT_ID,
                    content_value=Decimal("400.000000"),
                    label="400 g authored package test can",
                    active=True,
                    provenance="Reviewed authored package test size.",
                )
            )
            session.flush()
            payload = RecipeForkRequest.model_validate(
                {
                    **_base_payload(title="Package-aware walnut measure"),
                    "ingredient_edits": [
                        {
                            "op": "set_measure",
                            "recipe_ingredient_id": str(NUTS_ROW_ID),
                            "measure": {
                                "kind": "exact",
                                "value": "2",
                                "unit_id": str(CAN_UNIT_ID),
                                "package_size_id": str(package_size_id),
                            },
                        }
                    ],
                }
            )

            child_id = fork_recipe_version(
                session,
                source_version_id=CARROT_ROOT_ID,
                author_user_id=MEMBER_USER_ID,
                payload=payload,
            )
            assert child_id is not None
            session.flush()

            packaged_row = session.scalar(
                select(RecipeIngredient).where(
                    RecipeIngredient.recipe_version_id == child_id,
                    RecipeIngredient.ingredient_id == WALNUT_ID,
                )
            )
            assert packaged_row is not None
            assert packaged_row.measurement_unit_id == CAN_UNIT_ID
            assert packaged_row.package_size_id == package_size_id
        finally:
            transaction.rollback()


def test_fork_persists_range_and_qualitative_measures_atomically(
    fork_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    range_payload = _base_payload(title="Ranged Sugar Carrot Cake")
    range_payload["ingredient_edits"] = [
        {
            "op": "set_measure",
            "recipe_ingredient_id": str(SUGAR_ROW_ID),
            "measure": {
                "kind": "range",
                "minimum": "160",
                "maximum": "180",
                "unit_id": str(G_UNIT_ID),
            },
        }
    ]
    range_response = fork_client.post(
        f"/api/recipes/{CARROT_ROOT_ID}/variants",
        json=range_payload,
        headers=_action_headers(),
    )

    assert range_response.status_code == 201
    ranged_sugar = next(
        item
        for item in cast(list[dict[str, Any]], range_response.json()["ingredients"])
        if item["ingredient_id"] == str(SUGAR_ID)
    )
    assert ranged_sugar["measure"] == {
        "kind": "range",
        "minimum": "160.0000",
        "maximum": "180.0000",
        "unit": {
            "id": str(G_UNIT_ID),
            "key": "g",
            "dimension": "mass",
            "canonical_label": "gram",
            "plural_label": "grams",
            "symbol": "g",
            "display_style": "symbol",
            "active": True,
        },
        "display_unit": "g",
        "display": "160–180 g",
        "package_size_id": None,
    }
    ranged_stored = next(
        item
        for item in _snapshot_version(
            seeded_api_engine,
            UUID(range_response.json()["id"]),
        ).ingredients
        if item.ingredient_id == SUGAR_ID
    )
    assert ranged_stored.measure_mode == "range"
    assert ranged_stored.quantity_min == Decimal("160.0000")
    assert ranged_stored.quantity_max == Decimal("180.0000")
    assert ranged_stored.measurement_unit_id == G_UNIT_ID

    qualitative_payload = _base_payload(title="Sugar to Taste Carrot Cake")
    qualitative_payload["ingredient_edits"] = [
        {
            "op": "set_measure",
            "recipe_ingredient_id": str(SUGAR_ROW_ID),
            "measure": {"kind": "qualitative", "value": "to_taste"},
        }
    ]
    qualitative_response = fork_client.post(
        f"/api/recipes/{CARROT_ROOT_ID}/variants",
        json=qualitative_payload,
        headers=_action_headers(),
    )

    assert qualitative_response.status_code == 201
    qualitative_sugar = next(
        item
        for item in cast(list[dict[str, Any]], qualitative_response.json()["ingredients"])
        if item["ingredient_id"] == str(SUGAR_ID)
    )
    assert qualitative_sugar["measure"] == {
        "kind": "qualitative",
        "value": "to_taste",
        "unit": None,
        "display_unit": None,
        "display": "to taste",
    }
    qualitative_stored = next(
        item
        for item in _snapshot_version(
            seeded_api_engine,
            UUID(qualitative_response.json()["id"]),
        ).ingredients
        if item.ingredient_id == SUGAR_ID
    )
    assert qualitative_stored.measure_mode == "to_taste"
    assert qualitative_stored.quantity_min is None
    assert qualitative_stored.quantity_max is None
    assert qualitative_stored.measurement_unit_id is None


def test_historical_inactive_units_remain_readable_and_copyable_but_not_selectable(
    fork_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    with Session(bind=seeded_api_engine) as session, session.begin():
        gram = session.get(MeasurementUnit, G_UNIT_ID)
        assert gram is not None
        gram.active = False

    try:
        parent_response = fork_client.get(f"/api/recipes/{CARROT_ROOT_ID}")
        assert parent_response.status_code == 200
        parent_sugar = next(
            item
            for item in cast(list[dict[str, Any]], parent_response.json()["ingredients"])
            if item["ingredient_id"] == str(SUGAR_ID)
        )
        assert parent_sugar["measure"]["unit"]["active"] is False

        copied_response = fork_client.post(
            f"/api/recipes/{CARROT_ROOT_ID}/variants",
            json=_base_payload(title="Historical Unit Copy"),
            headers=_action_headers(),
        )
        assert copied_response.status_code == 201
        copied_sugar = next(
            item
            for item in cast(list[dict[str, Any]], copied_response.json()["ingredients"])
            if item["ingredient_id"] == str(SUGAR_ID)
        )
        assert copied_sugar["measure"]["unit"]["active"] is False

        rejected_payload = _base_payload(title="Inactive Unit Selection")
        rejected_payload["ingredient_edits"] = [
            {
                "op": "set_measure",
                "recipe_ingredient_id": str(SUGAR_ROW_ID),
                "measure": _exact_measure("150", G_UNIT_ID),
            }
        ]
        rejected_response = fork_client.post(
            f"/api/recipes/{CARROT_ROOT_ID}/variants",
            json=rejected_payload,
            headers=_action_headers(),
        )
        assert rejected_response.status_code == 422
        error = _json_object(rejected_response.json())["error"]
        assert error["code"] == "invalid_recipe_edits"
        assert "measurement_unit_inactive" in error["message"]
    finally:
        with Session(bind=seeded_api_engine) as session, session.begin():
            gram = session.get(MeasurementUnit, G_UNIT_ID)
            assert gram is not None
            gram.active = True


def test_unknown_curated_unit_is_rejected_without_creating_a_fork(
    fork_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    unknown_unit_id = uuid4()
    payload = _base_payload(title="Unknown Unit Selection")
    payload["ingredient_edits"] = [
        {
            "op": "set_measure",
            "recipe_ingredient_id": str(SUGAR_ROW_ID),
            "measure": _exact_measure("1", unknown_unit_id),
        }
    ]

    response = fork_client.post(
        f"/api/recipes/{CARROT_ROOT_ID}/variants",
        json=payload,
        headers=_action_headers(),
    )

    assert response.status_code == 422
    error = _json_object(response.json())["error"]
    assert error["code"] == "invalid_recipe_edits"
    assert "measurement_unit_not_found" in error["message"]
    assert _member_fork_count(seeded_api_engine) == 0


def test_known_alias_preserves_display_text_and_uses_catalog_identity(
    fork_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    payload = _base_payload(title="Carrot Cake with Chickpeas")
    payload["ingredient_edits"] = [
        {
            "op": "add",
            "ingredient_id": str(CHICKPEA_ID),
            "display_name": "  garbanzo beans  ",
            "measure": _exact_measure("1", CUP_UNIT_ID),
        }
    ]

    response = fork_client.post(
        f"/api/recipes/{CARROT_ROOT_ID}/variants",
        json=payload,
        headers=_action_headers(),
    )

    assert response.status_code == 201
    detail = _json_object(response.json())
    added = cast(list[dict[str, Any]], detail["ingredients"])[-1]
    assert added["ingredient_id"] == str(CHICKPEA_ID)
    assert added["canonical_name"] == "Chickpea"
    assert added["display_name"] == "Garbanzo beans"

    stored = _snapshot_version(seeded_api_engine, UUID(detail["id"])).ingredients[-1]
    assert stored.ingredient_id == CHICKPEA_ID
    assert stored.name == "Garbanzo beans"


def test_valid_ingredient_id_with_another_identitys_label_is_rejected(
    fork_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    payload = _base_payload(title="Tampered ingredient selection")
    payload["ingredient_edits"] = [
        {
            "op": "add",
            "ingredient_id": str(PECAN_ID),
            "display_name": "Orange zest",
            "measure": _qualitative_measure(),
        }
    ]

    response = fork_client.post(
        f"/api/recipes/{CARROT_ROOT_ID}/variants",
        json=payload,
        headers=_action_headers(),
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_recipe_edits"
    assert "not a curated name or alias" in response.json()["error"]["message"]
    assert _member_fork_count(seeded_api_engine) == 0


def test_same_identity_can_select_a_different_curated_display_label(
    fork_client: TestClient,
) -> None:
    payload = _base_payload(title="Canonical sugar label")
    payload["ingredient_edits"] = [
        {
            "op": "replace",
            "recipe_ingredient_id": str(SUGAR_ROW_ID),
            "ingredient_id": str(SUGAR_ID),
            "display_name": "Granulated sugar",
        }
    ]

    response = fork_client.post(
        f"/api/recipes/{CARROT_ROOT_ID}/variants",
        json=payload,
        headers=_action_headers(),
    )

    assert response.status_code == 201
    sugar = next(
        item
        for item in cast(list[dict[str, Any]], response.json()["ingredients"])
        if item["id"] != str(SUGAR_ROW_ID) and item["ingredient_id"] == str(SUGAR_ID)
    )
    assert sugar["display_name"] == "Granulated sugar"


@pytest.mark.parametrize(
    "payload",
    [
        {**_base_payload(), "title": "   "},
        {**_base_payload(), "servings": "0"},
        {
            **_base_payload(),
            "ingredient_edits": [
                {
                    "op": "set_measure",
                    "recipe_ingredient_id": str(SUGAR_ROW_ID),
                    "measure": _exact_measure(True, G_UNIT_ID),
                }
            ],
        },
        {
            **_base_payload(),
            "ingredient_edits": [
                {
                    "op": "set_measure",
                    "recipe_ingredient_id": str(SUGAR_ROW_ID),
                    "measure": _exact_measure("1.00001", G_UNIT_ID),
                }
            ],
        },
        {
            **_base_payload(),
            "ingredient_edits": [
                {
                    "op": "set_measure",
                    "recipe_ingredient_id": str(SUGAR_ROW_ID),
                    "measure": {
                        "kind": "exact",
                        "value": "1",
                        "unit_id": "not-a-uuid",
                    },
                }
            ],
        },
        {**_base_payload(), "ingredient_edits": [{"op": "unknown"}]},
        {**_base_payload(), "created_by_user_id": str(uuid4())},
    ],
    ids=[
        "blank-title",
        "zero-servings",
        "boolean-quantity",
        "overprecise-quantity",
        "invalid-unit-id",
        "unknown-operation",
        "client-author",
    ],
)
def test_invalid_request_shapes_create_no_fork(
    fork_client: TestClient,
    seeded_api_engine: Engine,
    payload: dict[str, Any],
) -> None:
    response = fork_client.post(
        f"/api/recipes/{CARROT_ROOT_ID}/variants",
        json=payload,
        headers=_action_headers(),
    )

    assert response.status_code == 422
    error = _json_object(response.json())["error"]
    assert error["code"] == "validation_error"
    assert error["issues"]
    assert _member_fork_count(seeded_api_engine) == 0


@pytest.mark.parametrize(
    "edits",
    [
        [
            {
                "op": "set_measure",
                "recipe_ingredient_id": str(FOREIGN_INGREDIENT_ROW_ID),
                "measure": _exact_measure("2", G_UNIT_ID),
            }
        ],
        [
            {
                "op": "set_measure",
                "recipe_ingredient_id": str(SUGAR_ROW_ID),
                "measure": _exact_measure("150", G_UNIT_ID),
            },
            {
                "op": "set_measure",
                "recipe_ingredient_id": str(SUGAR_ROW_ID),
                "measure": _exact_measure("140", G_UNIT_ID),
            },
        ],
        [
            {"op": "remove", "recipe_ingredient_id": str(SUGAR_ROW_ID)},
            {
                "op": "set_measure",
                "recipe_ingredient_id": str(SUGAR_ROW_ID),
                "measure": _exact_measure("1", CUP_UNIT_ID),
            },
        ],
        [
            {
                "op": "replace",
                "recipe_ingredient_id": str(NUTS_ROW_ID),
                "ingredient_id": str(WALNUT_ID),
                "display_name": "Walnut",
            }
        ],
    ],
    ids=[
        "target-from-other-version",
        "duplicate-operation",
        "remove-and-edit",
        "replacement-is-no-op",
    ],
)
def test_invalid_or_conflicting_edits_roll_back_without_mutating_parent(
    fork_client: TestClient,
    seeded_api_engine: Engine,
    edits: list[dict[str, object]],
) -> None:
    parent_before = _snapshot_version(seeded_api_engine, CARROT_ROOT_ID)
    payload = _base_payload()
    payload["ingredient_edits"] = edits

    response = fork_client.post(
        f"/api/recipes/{CARROT_ROOT_ID}/variants",
        json=payload,
        headers=_action_headers(),
    )

    assert response.status_code == 422
    error = _json_object(response.json())["error"]
    assert error["code"] == "invalid_recipe_edits"
    assert error["message"]
    assert error["issues"] == []
    assert _member_fork_count(seeded_api_engine) == 0
    assert _snapshot_version(seeded_api_engine, CARROT_ROOT_ID) == parent_before


@pytest.mark.parametrize(
    "edit",
    [
        {
            "op": "add",
            "ingredient_id": str(UNKNOWN_INGREDIENT_ID),
            "display_name": "Not a catalog ingredient",
            "measure": _qualitative_measure(),
        },
        {
            "op": "replace",
            "recipe_ingredient_id": str(NUTS_ROW_ID),
            "ingredient_id": str(UNKNOWN_INGREDIENT_ID),
            "display_name": "Not a catalog ingredient",
        },
    ],
    ids=["add", "replace"],
)
def test_unknown_ingredient_cannot_publish_or_mutate_the_catalog(
    fork_client: TestClient,
    seeded_api_engine: Engine,
    edit: dict[str, object],
) -> None:
    parent_before = _snapshot_version(seeded_api_engine, CARROT_ROOT_ID)
    catalog_before = _catalog_snapshot(seeded_api_engine)
    payload = _base_payload()
    payload["ingredient_edits"] = [edit]

    response = fork_client.post(
        f"/api/recipes/{CARROT_ROOT_ID}/variants",
        json=payload,
        headers=_action_headers(),
    )

    assert response.status_code == 422
    assert response.json() == {
        "error": {
            "code": "invalid_recipe_edits",
            "message": (
                f"Ingredient {UNKNOWN_INGREDIENT_ID} is not in the curated catalog and "
                "cannot be published."
            ),
            "issues": [],
        }
    }
    assert _member_fork_count(seeded_api_engine) == 0
    assert _member_fork_event_count(seeded_api_engine) == 0
    assert _snapshot_version(seeded_api_engine, CARROT_ROOT_ID) == parent_before
    assert _catalog_snapshot(seeded_api_engine) == catalog_before


def test_removing_every_structured_row_is_rejected_atomically(
    fork_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    parent = _snapshot_version(seeded_api_engine, CARROT_ROOT_ID)
    payload = _base_payload()
    payload["ingredient_edits"] = [
        {"op": "remove", "recipe_ingredient_id": str(item.id)} for item in parent.ingredients
    ]
    payload["instruction_edits"] = [
        {"op": "remove", "recipe_instruction_id": str(item.id)} for item in parent.instructions
    ]

    response = fork_client.post(
        f"/api/recipes/{CARROT_ROOT_ID}/variants",
        json=payload,
        headers=_action_headers(),
    )

    assert response.status_code == 422
    assert _json_object(response.json())["error"]["code"] == "invalid_recipe_edits"
    assert _member_fork_count(seeded_api_engine) == 0
    assert _snapshot_version(seeded_api_engine, CARROT_ROOT_ID) == parent


def test_transaction_rolls_back_if_edit_processing_fails_after_child_insert(
    monkeypatch: pytest.MonkeyPatch,
    fork_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    parent_before = _snapshot_version(seeded_api_engine, CARROT_ROOT_ID)

    def insert_then_fail(
        session: Session,
        *,
        source_version_id: UUID,
        author_user_id: UUID,
        payload: RecipeForkRequest,
    ) -> UUID | None:
        source = session.get(RecipeVersion, source_version_id)
        assert source is not None
        child = RecipeVersion(
            lineage_id=source.lineage_id,
            parent_version_id=source.id,
            created_by_user_id=author_user_id,
            version_number=99,
            title=payload.title,
            description=payload.description,
            servings=payload.servings,
        )
        session.add(child)
        session.flush()
        raise InvalidRecipeEditsError("Injected invalid edit after a partial write.")

    monkeypatch.setattr(recipe_routes, "fork_recipe_version", insert_then_fail)

    response = fork_client.post(
        f"/api/recipes/{CARROT_ROOT_ID}/variants",
        json=_base_payload(),
        headers=_action_headers(),
    )

    assert response.status_code == 422
    assert response.json() == {
        "error": {
            "code": "invalid_recipe_edits",
            "message": "Injected invalid edit after a partial write.",
            "issues": [],
        }
    }
    assert _member_fork_count(seeded_api_engine) == 0
    assert _snapshot_version(seeded_api_engine, CARROT_ROOT_ID) == parent_before


def test_missing_and_malformed_source_ids_create_no_fork(
    fork_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    missing_id = uuid4()
    missing = fork_client.post(
        f"/api/recipes/{missing_id}/variants",
        json=_base_payload(),
        headers=_action_headers(),
    )
    malformed = fork_client.post(
        "/api/recipes/not-a-uuid/variants",
        json=_base_payload(),
        headers=_action_headers(),
    )

    assert missing.status_code == 404
    assert missing.json() == {
        "error": {
            "code": "recipe_not_found",
            "message": f"Recipe version {missing_id} was not found.",
            "issues": [],
        }
    }
    assert malformed.status_code == 422
    assert _json_object(malformed.json())["error"]["code"] == "invalid_identifier"
    assert _member_fork_count(seeded_api_engine) == 0


def test_missing_session_member_rejects_fork_without_partial_write(
    fork_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    with Session(bind=seeded_api_engine) as session, session.begin():
        session.execute(delete(User).where(User.id == MEMBER_USER_ID))

    response = fork_client.post(
        f"/api/recipes/{CARROT_ROOT_ID}/variants",
        json=_base_payload(),
        headers=_action_headers(),
    )

    assert response.status_code == 401
    assert _json_object(response.json())["error"]["code"] == "authentication_required"
    assert _member_fork_count(seeded_api_engine) == 0


def test_concurrent_forks_allocate_unique_contiguous_lineage_numbers(
    seeded_api_engine: Engine,
) -> None:
    worker_count = 6
    start = Barrier(worker_count)
    source = _snapshot_version(seeded_api_engine, CARROT_ROOT_ID)

    def create_fork(worker_number: int) -> UUID:
        payload = RecipeForkRequest.model_validate(
            _base_payload(title=f"Concurrent Carrot Cake {worker_number}")
        )
        with Session(bind=seeded_api_engine) as session, session.begin():
            start.wait(timeout=10)
            child_id = fork_recipe_version(
                session,
                source_version_id=CARROT_ROOT_ID,
                author_user_id=MEMBER_USER_ID,
                payload=payload,
            )
            assert child_id is not None
            return child_id

    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = [executor.submit(create_fork, number) for number in range(worker_count)]
        child_ids = [future.result(timeout=30) for future in futures]

    assert len(set(child_ids)) == worker_count
    children = [_snapshot_version(seeded_api_engine, child_id) for child_id in child_ids]
    assert sorted(child.version_number for child in children) == list(range(4, 4 + worker_count))
    assert all(child.lineage_id == CARROT_LINEAGE_ID for child in children)
    assert all(child.parent_version_id == CARROT_ROOT_ID for child in children)
    assert all(child.created_by_user_id == MEMBER_USER_ID for child in children)
    assert all(
        _ingredient_values(child.ingredients) == _ingredient_values(source.ingredients)
        for child in children
    )
    assert all(
        _instruction_values(child.instructions) == _instruction_values(source.instructions)
        for child in children
    )


def test_openapi_documents_recipe_fork_contract(fork_client: TestClient) -> None:
    document = _json_object(fork_client.get("/openapi.json").json())
    paths = cast(dict[str, Any], document["paths"])
    schemas = cast(dict[str, Any], cast(dict[str, Any], document["components"])["schemas"])

    operation = paths["/api/recipes/{recipe_version_id}/variants"]["post"]
    assert operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/RecipeForkRequest"
    )
    assert operation["responses"]["201"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/RecipeDetailResponse"
    )
    for status_code in ("401", "403", "404", "409", "422"):
        assert operation["responses"][status_code]["content"]["application/json"]["schema"][
            "$ref"
        ].endswith("/ErrorResponse")

    request_schema = schemas["RecipeForkRequest"]
    assert request_schema["additionalProperties"] is False
    assert set(request_schema["required"]) == {"title", "description", "servings"}
    assert "created_by_user_id" not in request_schema["properties"]
    assert "user_id" not in request_schema["properties"]
    ingredient_items = request_schema["properties"]["ingredient_edits"]["items"]
    instruction_items = request_schema["properties"]["instruction_edits"]["items"]
    assert ingredient_items["discriminator"]["propertyName"] == "op"
    assert instruction_items["discriminator"]["propertyName"] == "op"
    assert "existing curated catalog" in operation["description"]
    assert (
        "Stable curated catalog identity"
        in schemas["AddIngredient"]["properties"]["ingredient_id"]["description"]
    )
    assert "verifies" in schemas["ReplaceIngredient"]["properties"]["ingredient_id"]["description"]
    assert "reviewed alias" in schemas["AddIngredient"]["properties"]["display_name"]["description"]
    ingredient_response = schemas["RecipeIngredientResponse"]["properties"]
    assert (
        "Required curated catalog identity" in ingredient_response["ingredient_id"]["description"]
    )
    assert (
        "does not define ingredient identity" in ingredient_response["display_name"]["description"]
    )
