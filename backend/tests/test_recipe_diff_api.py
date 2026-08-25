from collections.abc import Iterator
from decimal import Decimal
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.main import create_app
from app.seeds.identifiers import measurement_uuid, seed_uuid

DATASET_ID = "recipe-lab-demo-v1"

CARROT_ROOT_KEY = "carrot-walnut-snack-cake-v1"
CARROT_PECAN_KEY = "lower-sugar-pecan-carrot-cake-v2"
CARROT_ORANGE_KEY = "orange-raisin-carrot-cake-v3"
PASTA_ROOT_KEY = "tomato-basil-spaghetti-v1"
PASTA_THIRD_KEY = "mushroom-whole-wheat-spaghetti-v3"

CARROT_ROOT_ID = seed_uuid(DATASET_ID, "recipe-version", CARROT_ROOT_KEY)
CARROT_PECAN_ID = seed_uuid(DATASET_ID, "recipe-version", CARROT_PECAN_KEY)
CARROT_ORANGE_ID = seed_uuid(DATASET_ID, "recipe-version", CARROT_ORANGE_KEY)
CARROT_LINEAGE_ID = seed_uuid(DATASET_ID, "recipe-lineage", CARROT_ROOT_KEY)
PASTA_ROOT_ID = seed_uuid(DATASET_ID, "recipe-version", PASTA_ROOT_KEY)
PASTA_THIRD_ID = seed_uuid(DATASET_ID, "recipe-version", PASTA_THIRD_KEY)
PASTA_LINEAGE_ID = seed_uuid(DATASET_ID, "recipe-lineage", PASTA_ROOT_KEY)

WALNUT_ID = seed_uuid(DATASET_ID, "ingredient", "walnut")
PECAN_ID = seed_uuid(DATASET_ID, "ingredient", "pecan")
SUGAR_ID = seed_uuid(DATASET_ID, "ingredient", "granulated-sugar")

ROOT_NUTS_ROW_ID = seed_uuid(
    DATASET_ID,
    "recipe-ingredient",
    f"{CARROT_ROOT_KEY}:nuts",
)
PECAN_NUTS_ROW_ID = seed_uuid(
    DATASET_ID,
    "recipe-ingredient",
    f"{CARROT_PECAN_KEY}:nuts",
)
ROOT_SUGAR_ROW_ID = seed_uuid(
    DATASET_ID,
    "recipe-ingredient",
    f"{CARROT_ROOT_KEY}:sugar",
)
PECAN_SUGAR_ROW_ID = seed_uuid(
    DATASET_ID,
    "recipe-ingredient",
    f"{CARROT_PECAN_KEY}:sugar",
)

MISSING_TARGET_ID = uuid4()
MISSING_BASE_ID = uuid4()


@pytest.fixture
def diff_client(seeded_api_engine: Engine) -> Iterator[TestClient]:
    application = create_app()

    def override_session() -> Iterator[Session]:
        with Session(bind=seeded_api_engine) as session:
            yield session

    application.dependency_overrides[get_session] = override_session
    try:
        with TestClient(application) as client:
            yield client
    finally:
        application.dependency_overrides.clear()


def _json_object(value: object) -> dict[str, Any]:
    return cast(dict[str, Any], value)


def _version_reference(version_id: UUID, version_number: int, title: str) -> dict[str, Any]:
    return {
        "id": str(version_id),
        "version_number": version_number,
        "title": title,
    }


def _ingredient_snapshot(
    *,
    row_id: UUID,
    ingredient_id: UUID,
    canonical_name: str,
    display_name: str,
    quantity: str | None,
    unit: str | None,
    preparation_notes: str | None,
    display_order: int,
) -> dict[str, Any]:
    assert quantity is not None
    assert unit is not None
    unit_id = measurement_uuid("unit", unit)
    return {
        "id": str(row_id),
        "ingredient_id": str(ingredient_id),
        "canonical_name": canonical_name,
        "display_name": display_name,
        "measure": {
            "kind": "exact",
            "value": quantity,
            "unit": {
                "id": str(unit_id),
                "key": unit,
                "dimension": "mass",
                "canonical_label": "gram",
                "plural_label": "grams",
                "symbol": "g",
                "display_style": "symbol",
                "active": True,
            },
            "display_unit": "g",
            "display": f"{format(Decimal(quantity).normalize(), 'f')} g",
            "package_size_id": None,
        },
        "preparation_notes": preparation_notes,
        "display_order": display_order,
    }


def _expected_carrot_pecan_diff() -> dict[str, Any]:
    root_nuts = _ingredient_snapshot(
        row_id=ROOT_NUTS_ROW_ID,
        ingredient_id=WALNUT_ID,
        canonical_name="Walnut",
        display_name="Walnut",
        quantity="100.0000",
        unit="g",
        preparation_notes="roughly chopped",
        display_order=5,
    )
    pecan_nuts = _ingredient_snapshot(
        row_id=PECAN_NUTS_ROW_ID,
        ingredient_id=PECAN_ID,
        canonical_name="Pecan",
        display_name="Pecan",
        quantity="100.0000",
        unit="g",
        preparation_notes="roughly chopped",
        display_order=5,
    )
    root_sugar = _ingredient_snapshot(
        row_id=ROOT_SUGAR_ROW_ID,
        ingredient_id=SUGAR_ID,
        canonical_name="Granulated sugar",
        display_name="White sugar",
        quantity="180.0000",
        unit="g",
        preparation_notes=None,
        display_order=2,
    )
    pecan_sugar = _ingredient_snapshot(
        row_id=PECAN_SUGAR_ROW_ID,
        ingredient_id=SUGAR_ID,
        canonical_name="Granulated sugar",
        display_name="White sugar",
        quantity="140.0000",
        unit="g",
        preparation_notes=None,
        display_order=2,
    )
    return {
        "lineage_id": str(CARROT_LINEAGE_ID),
        "base_version": _version_reference(
            CARROT_ROOT_ID,
            1,
            "Carrot Walnut Snack Cake",
        ),
        "target_version": _version_reference(
            CARROT_PECAN_ID,
            2,
            "Lower-Sugar Pecan Carrot Cake",
        ),
        "metadata_changes": [
            {
                "field": "title",
                "before": "Carrot Walnut Snack Cake",
                "after": "Lower-Sugar Pecan Carrot Cake",
            },
            {
                "field": "description",
                "before": ("A simple spiced carrot cake with walnuts and an unfrosted finish."),
                "after": (
                    "The carrot snack cake with less sugar and pecans replacing the walnuts."
                ),
            },
        ],
        "ingredients": {
            "added": [],
            "removed": [],
            "replaced": [
                {
                    "before": root_nuts,
                    "after": pecan_nuts,
                    "changed_fields": ["ingredient", "display_name"],
                }
            ],
            "modified": [
                {
                    "before": root_sugar,
                    "after": pecan_sugar,
                    "changed_fields": ["measure"],
                }
            ],
        },
        "instructions": {"added": [], "removed": [], "modified": []},
        "has_changes": True,
    }


def test_seeded_carrot_diff_uses_parent_by_default_and_matches_golden_contract(
    diff_client: TestClient,
) -> None:
    response = diff_client.get(f"/api/recipes/{CARROT_PECAN_ID}/diff")

    assert response.status_code == 200
    assert response.json() == _expected_carrot_pecan_diff()


def test_explicit_parent_produces_the_same_seeded_carrot_diff(
    diff_client: TestClient,
) -> None:
    implicit = diff_client.get(f"/api/recipes/{CARROT_PECAN_ID}/diff")
    explicit = diff_client.get(
        f"/api/recipes/{CARROT_PECAN_ID}/diff",
        params={"base_version_id": str(CARROT_ROOT_ID)},
    )

    assert implicit.status_code == 200
    assert explicit.status_code == 200
    assert explicit.json() == _expected_carrot_pecan_diff()
    assert explicit.json() == implicit.json()


def test_same_version_comparison_returns_a_machine_readable_no_change_result(
    diff_client: TestClient,
) -> None:
    response = diff_client.get(
        f"/api/recipes/{CARROT_PECAN_ID}/diff",
        params={"base_version_id": str(CARROT_PECAN_ID)},
    )

    assert response.status_code == 200
    assert response.json() == {
        "lineage_id": str(CARROT_LINEAGE_ID),
        "base_version": _version_reference(
            CARROT_PECAN_ID,
            2,
            "Lower-Sugar Pecan Carrot Cake",
        ),
        "target_version": _version_reference(
            CARROT_PECAN_ID,
            2,
            "Lower-Sugar Pecan Carrot Cake",
        ),
        "metadata_changes": [],
        "ingredients": {"added": [], "removed": [], "replaced": [], "modified": []},
        "instructions": {"added": [], "removed": [], "modified": []},
        "has_changes": False,
    }


@pytest.mark.parametrize(
    ("target_id", "base_id", "expected_lineage_id"),
    [
        pytest.param(
            CARROT_ORANGE_ID,
            CARROT_PECAN_ID,
            CARROT_LINEAGE_ID,
            id="sibling-versions",
        ),
        pytest.param(
            CARROT_ROOT_ID,
            CARROT_PECAN_ID,
            CARROT_LINEAGE_ID,
            id="reverse-parent-child",
        ),
        pytest.param(
            PASTA_THIRD_ID,
            PASTA_ROOT_ID,
            PASTA_LINEAGE_ID,
            id="deep-same-lineage",
        ),
    ],
)
def test_explicit_comparisons_support_any_direction_within_one_lineage(
    diff_client: TestClient,
    target_id: UUID,
    base_id: UUID,
    expected_lineage_id: UUID,
) -> None:
    response = diff_client.get(
        f"/api/recipes/{target_id}/diff",
        params={"base_version_id": str(base_id)},
    )

    assert response.status_code == 200
    body = _json_object(response.json())
    assert body["lineage_id"] == str(expected_lineage_id)
    assert body["base_version"]["id"] == str(base_id)
    assert body["target_version"]["id"] == str(target_id)
    assert body["has_changes"] is True


def test_root_without_an_explicit_base_returns_a_clear_error(
    diff_client: TestClient,
) -> None:
    response = diff_client.get(f"/api/recipes/{CARROT_ROOT_ID}/diff")

    assert response.status_code == 422
    assert response.json() == {
        "error": {
            "code": "recipe_has_no_parent",
            "message": f"Recipe version {CARROT_ROOT_ID} has no parent to compare.",
            "issues": [],
        }
    }


@pytest.mark.parametrize(
    ("path", "expected_status", "expected_code", "has_validation_issues"),
    [
        pytest.param(
            f"/api/recipes/{MISSING_TARGET_ID}/diff",
            404,
            "recipe_not_found",
            False,
            id="missing-target",
        ),
        pytest.param(
            f"/api/recipes/{CARROT_PECAN_ID}/diff?base_version_id={MISSING_BASE_ID}",
            404,
            "recipe_not_found",
            False,
            id="missing-base",
        ),
        pytest.param(
            "/api/recipes/not-a-uuid/diff",
            422,
            "invalid_identifier",
            True,
            id="malformed-target",
        ),
        pytest.param(
            f"/api/recipes/{CARROT_PECAN_ID}/diff?base_version_id=not-a-uuid",
            422,
            "invalid_identifier",
            True,
            id="malformed-base",
        ),
        pytest.param(
            f"/api/recipes/{CARROT_PECAN_ID}/diff?base_version_id={PASTA_ROOT_ID}",
            422,
            "recipe_lineage_mismatch",
            False,
            id="different-lineages",
        ),
    ],
)
def test_diff_failures_use_the_documented_error_envelope(
    diff_client: TestClient,
    path: str,
    expected_status: int,
    expected_code: str,
    has_validation_issues: bool,
) -> None:
    response = diff_client.get(path)

    assert response.status_code == expected_status
    error = _json_object(response.json())["error"]
    assert error["code"] == expected_code
    assert error["message"]
    assert bool(error["issues"]) is has_validation_issues


def test_repeated_diff_requests_serialize_identically(diff_client: TestClient) -> None:
    path = f"/api/recipes/{CARROT_ORANGE_ID}/diff?base_version_id={CARROT_PECAN_ID}"

    bodies = []
    for _attempt in range(3):
        response = diff_client.get(path)
        assert response.status_code == 200
        bodies.append(response.json())

    assert bodies[1:] == bodies[:1] * 2


def test_diff_reads_use_bounded_queries_and_do_not_load_interactions_or_users(
    diff_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    statements: list[str] = []

    def capture_statement(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(" ".join(statement.casefold().split()))

    event.listen(seeded_api_engine, "before_cursor_execute", capture_statement)
    try:
        response = diff_client.get(f"/api/recipes/{CARROT_PECAN_ID}/diff")
    finally:
        event.remove(seeded_api_engine, "before_cursor_execute", capture_statement)

    assert response.status_code == 200
    assert len(statements) == 5
    assert any("recipe_version_ingredients" in statement for statement in statements)
    assert any("recipe_version_instructions" in statement for statement in statements)
    assert any("ingredient_substitutions" in statement for statement in statements)
    for excluded_table in ("recipe_ratings", "recipe_saves", "users"):
        assert all(excluded_table not in statement for statement in statements)


def test_openapi_documents_recipe_diff_contract(diff_client: TestClient) -> None:
    document = _json_object(diff_client.get("/openapi.json").json())
    paths = cast(dict[str, Any], document["paths"])
    schemas = cast(dict[str, Any], cast(dict[str, Any], document["components"])["schemas"])

    operation = paths["/api/recipes/{recipe_version_id}/diff"]["get"]
    assert operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/RecipeDiffResponse"
    )
    for status_code in ("404", "422"):
        assert operation["responses"][status_code]["content"]["application/json"]["schema"][
            "$ref"
        ].endswith("/ErrorResponse")

    parameters = {
        (parameter["name"], parameter["in"]): parameter for parameter in operation["parameters"]
    }
    assert parameters[("recipe_version_id", "path")]["required"] is True
    assert parameters[("recipe_version_id", "path")]["schema"]["format"] == "uuid"
    base_parameter = parameters[("base_version_id", "query")]
    assert base_parameter["required"] is False
    assert any(option.get("format") == "uuid" for option in base_parameter["schema"]["anyOf"])

    assert {
        "RecipeDiffResponse",
        "RecipeFieldChange",
        "RecipeIngredientDiff",
        "RecipeIngredientPairChange",
        "RecipeInstructionDiff",
        "RecipeInstructionPairChange",
    } <= set(schemas)
    response_schema = schemas["RecipeDiffResponse"]
    assert {
        "lineage_id",
        "base_version",
        "target_version",
        "metadata_changes",
        "ingredients",
        "instructions",
        "has_changes",
    } == set(response_schema["properties"])
    assert response_schema["properties"]["lineage_id"]["format"] == "uuid"
    assert schemas["RecipeIngredientPairChange"]["properties"]["changed_fields"]["minItems"] == 1
    assert schemas["RecipeInstructionPairChange"]["properties"]["changed_fields"]["minItems"] == 1
