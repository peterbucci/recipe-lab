from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any, cast
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, delete, event
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.homepage_content import FEATURED_RECIPE_VERSION_IDS
from app.main import create_app
from app.models import CookingActionType, RecipeCategory, RecipeRating, RecipeSave, User
from app.seeds.identifiers import action_uuid, seed_uuid
from app.services.recipe_visibility import set_authored_recipe_visibility

DATASET_ID = "recipe-lab-demo-v1"
CARROT_ROOT_ID = seed_uuid(
    DATASET_ID,
    "recipe-version",
    "carrot-walnut-snack-cake-v1",
)
BANANA_ROOT_ID = seed_uuid(
    DATASET_ID,
    "recipe-version",
    "banana-oat-pancakes-v1",
)
CARROT_PECAN_ID = seed_uuid(
    DATASET_ID,
    "recipe-version",
    "lower-sugar-pecan-carrot-cake-v2",
)
CARROT_ORANGE_ID = seed_uuid(
    DATASET_ID,
    "recipe-version",
    "orange-raisin-carrot-cake-v3",
)
CARROT_LINEAGE_ID = seed_uuid(
    DATASET_ID,
    "recipe-lineage",
    "carrot-walnut-snack-cake-v1",
)
CATALOG_AUTHOR_ID = seed_uuid(DATASET_ID, "user", "catalog-author")
PASTA_ROOT_ID = seed_uuid(
    DATASET_ID,
    "recipe-version",
    "tomato-basil-spaghetti-v1",
)
PASTA_SECOND_ID = seed_uuid(
    DATASET_ID,
    "recipe-version",
    "whole-wheat-spinach-spaghetti-v2",
)
PASTA_THIRD_ID = seed_uuid(
    DATASET_ID,
    "recipe-version",
    "mushroom-whole-wheat-spaghetti-v3",
)
BREAKFAST_CATEGORY_ID = seed_uuid(DATASET_ID, "recipe-category", "breakfast")
QUICK_EASY_CATEGORY_ID = seed_uuid(DATASET_ID, "recipe-category", "quick-easy")


@pytest.fixture
def api_client(seeded_api_engine: Engine) -> Iterator[TestClient]:
    application = create_app()

    def override_session() -> Iterator[Session]:
        with Session(bind=seeded_api_engine) as session:
            yield session

    application.dependency_overrides[get_session] = override_session
    with TestClient(application) as client:
        yield client
    application.dependency_overrides.clear()


def _json_object(response_json: object) -> dict[str, Any]:
    return cast(dict[str, Any], response_json)


@contextmanager
def _read_statement_counter(engine: Engine) -> Iterator[list[str]]:
    statements: list[str] = []

    def capture(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        normalized = statement.lstrip().upper()
        if normalized.startswith(("SELECT", "WITH")):
            statements.append(" ".join(statement.casefold().split()))

    event.listen(engine, "before_cursor_execute", capture)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", capture)


def _page(client: TestClient, **params: object) -> dict[str, Any]:
    response = client.get("/api/recipes", params=cast(dict[str, Any], params))
    assert response.status_code == 200
    return _json_object(response.json())


def test_browse_defaults_list_every_version_in_stable_order(api_client: TestClient) -> None:
    first_page = _page(api_client)

    assert first_page["page"] == 1
    assert first_page["page_size"] == 20
    assert first_page["total"] == 34
    assert first_page["total_pages"] == 2
    items = cast(list[dict[str, Any]], first_page["items"])
    assert len(items) == 20
    assert set(items[0]) == {
        "id",
        "lineage_id",
        "parent_version_id",
        "version_number",
        "title",
        "description",
        "servings",
        "created_at",
        "published_at",
        "author",
        "parent",
        "categories",
        "average_rating",
        "rating_count",
        "save_count",
    }
    assert set(items[0]["author"]) == {"id", "handle", "display_name"}
    assert all(item["average_rating"] is None for item in items)
    assert all(item["rating_count"] == 0 for item in items)
    assert all(item["save_count"] == 0 for item in items)

    all_items = cast(list[dict[str, Any]], _page(api_client, page_size=100)["items"])
    order_keys = [
        (
            item["title"].casefold(),
            item["title"],
            item["version_number"],
            item["id"],
        )
        for item in all_items
    ]
    assert order_keys == sorted(order_keys)
    assert len({item["id"] for item in all_items}) == 34


def test_newest_browse_uses_recipe_id_as_the_stable_publication_tie_break(
    api_client: TestClient,
) -> None:
    items = cast(
        list[dict[str, Any]],
        _page(api_client, sort="newest", page_size=100)["items"],
    )

    assert [item["id"] for item in items] == sorted(item["id"] for item in items)
    assert {item["published_at"] for item in items} == {"2026-08-20T00:00:00Z"}


def test_browse_recipes_include_anonymous_rating_and_save_totals(
    api_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    recipe_version_id = CARROT_ROOT_ID
    user_ids = [uuid4(), uuid4()]
    with Session(bind=seeded_api_engine) as session, session.begin():
        session.add_all(
            [
                User(
                    id=user_id,
                    email=f"{user_id}@example.com",
                    display_name=f"Catalog recipe member {index}",
                )
                for index, user_id in enumerate(user_ids, start=1)
            ]
        )
        session.flush()
        session.add_all(
            [
                RecipeRating(
                    user_id=user_ids[0],
                    recipe_version_id=recipe_version_id,
                    rating=4,
                ),
                RecipeRating(
                    user_id=user_ids[1],
                    recipe_version_id=recipe_version_id,
                    rating=5,
                ),
                RecipeSave(user_id=user_ids[0], recipe_version_id=recipe_version_id),
                RecipeSave(user_id=user_ids[1], recipe_version_id=recipe_version_id),
            ]
        )

    try:
        items = cast(
            list[dict[str, Any]],
            _page(api_client, q="Carrot Walnut", page_size=100)["items"],
        )

        recipe = next(item for item in items if item["id"] == str(recipe_version_id))
        assert recipe["average_rating"] == 4.5
        assert recipe["rating_count"] == 2
        assert recipe["save_count"] == 2
        assert "ratings" not in recipe
        assert "saves" not in recipe
        assert "users" not in recipe
    finally:
        with Session(bind=seeded_api_engine) as session, session.begin():
            session.execute(delete(RecipeRating).where(RecipeRating.user_id.in_(user_ids)))
            session.execute(delete(RecipeSave).where(RecipeSave.user_id.in_(user_ids)))
            session.execute(delete(User).where(User.id.in_(user_ids)))


def test_browse_card_engagement_queries_are_bounded(
    api_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    with _read_statement_counter(seeded_api_engine) as statements:
        response = api_client.get("/api/recipes", params={"page_size": 100})

    assert response.status_code == 200
    assert len(statements) <= 6
    assert sum("from recipe_ratings" in statement for statement in statements) == 1
    assert sum("from recipe_saves" in statement for statement in statements) == 1


def test_featured_recipes_are_global_editorial_public_summaries(
    api_client: TestClient,
) -> None:
    response = api_client.get("/api/recipes/featured")

    assert response.status_code == 200
    body = _json_object(response.json())
    items = cast(list[dict[str, Any]], body["items"])
    assert [item["id"] for item in items] == [
        str(recipe_version_id) for recipe_version_id in FEATURED_RECIPE_VERSION_IDS
    ]
    assert [item["title"] for item in items] == [
        "Banana Oat Pancakes",
        "Red Lentil Coconut Stew",
        "Lemon Herb Chickpea Quinoa Bowl",
        "Carrot Walnut Snack Cake",
    ]
    assert set(body) == {"items"}
    assert all("score" not in item and "reason" not in item for item in items)
    assert all(item["published_at"] == "2026-08-20T00:00:00Z" for item in items)
    assert all(item["average_rating"] is None for item in items)
    assert all(item["rating_count"] == 0 for item in items)
    assert all(item["save_count"] == 0 for item in items)


def test_featured_recipes_include_anonymous_rating_and_save_totals(
    api_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    recipe_version_id = FEATURED_RECIPE_VERSION_IDS[0]
    user_ids = [uuid4(), uuid4()]
    with Session(bind=seeded_api_engine) as session, session.begin():
        session.add_all(
            [
                User(
                    id=user_id,
                    email=f"{user_id}@example.com",
                    display_name=f"Featured recipe member {index}",
                )
                for index, user_id in enumerate(user_ids, start=1)
            ]
        )
        session.flush()
        session.add_all(
            [
                RecipeRating(
                    user_id=user_ids[0],
                    recipe_version_id=recipe_version_id,
                    rating=4,
                ),
                RecipeRating(
                    user_id=user_ids[1],
                    recipe_version_id=recipe_version_id,
                    rating=5,
                ),
                RecipeSave(user_id=user_ids[0], recipe_version_id=recipe_version_id),
                RecipeSave(user_id=user_ids[1], recipe_version_id=recipe_version_id),
            ]
        )

    try:
        response = api_client.get("/api/recipes/featured")

        assert response.status_code == 200
        items = cast(list[dict[str, Any]], _json_object(response.json())["items"])
        featured = next(item for item in items if item["id"] == str(recipe_version_id))
        assert featured["average_rating"] == 4.5
        assert featured["rating_count"] == 2
        assert featured["save_count"] == 2
        assert "ratings" not in featured
        assert "saves" not in featured
        assert "users" not in featured
    finally:
        with Session(bind=seeded_api_engine) as session, session.begin():
            session.execute(delete(RecipeRating).where(RecipeRating.user_id.in_(user_ids)))
            session.execute(delete(RecipeSave).where(RecipeSave.user_id.in_(user_ids)))
            session.execute(delete(User).where(User.id.in_(user_ids)))


def test_featured_recipes_omit_a_selection_that_is_no_longer_public(
    api_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    withdrawn_id = FEATURED_RECIPE_VERSION_IDS[0]
    try:
        with Session(bind=seeded_api_engine) as session, session.begin():
            set_authored_recipe_visibility(
                session,
                actor_user_id=CATALOG_AUTHOR_ID,
                recipe_version_id=withdrawn_id,
                desired_state="author_withdrawn",
            )

        response = api_client.get("/api/recipes/featured")

        assert response.status_code == 200
        items = cast(list[dict[str, Any]], _json_object(response.json())["items"])
        assert str(withdrawn_id) not in {item["id"] for item in items}
        assert [item["id"] for item in items] == [
            str(recipe_version_id) for recipe_version_id in FEATURED_RECIPE_VERSION_IDS[1:]
        ]
    finally:
        with Session(bind=seeded_api_engine) as session, session.begin():
            set_authored_recipe_visibility(
                session,
                actor_user_id=CATALOG_AUTHOR_ID,
                recipe_version_id=withdrawn_id,
                desired_state="published",
            )


def test_browse_pagination_retains_totals_beyond_the_last_page(
    api_client: TestClient,
) -> None:
    fourth_page = _page(api_client, page=4, page_size=10)
    fifth_page = _page(api_client, page=5, page_size=10)

    assert len(fourth_page["items"]) == 4
    assert fourth_page["total"] == 34
    assert fourth_page["total_pages"] == 4
    assert fifth_page["items"] == []
    assert fifth_page["total"] == 34
    assert fifth_page["total_pages"] == 4


def test_browse_search_is_trimmed_case_insensitive_and_literal(
    api_client: TestClient,
) -> None:
    matches = _page(api_client, q="  CARROT  ", page_size=100)
    titles = {item["title"] for item in matches["items"]}

    assert matches["total"] == 3
    assert titles == {
        "Carrot Walnut Snack Cake",
        "Lower-Sugar Pecan Carrot Cake",
        "Orange Raisin Carrot Cake",
    }
    description_match = _page(api_client, q="THIRD-GENERATION", page_size=100)
    assert description_match["total"] == 1
    assert description_match["items"][0]["title"] == ("Mushroom Whole-Wheat Tomato Spaghetti")
    assert _page(api_client, q="%", page_size=100)["total"] == 0
    assert _page(api_client, q="missing recipe", page_size=100)["total"] == 0


def test_browse_filters_by_alias_lineage_and_variant_kind(api_client: TestClient) -> None:
    canonical = _page(api_client, ingredient="Chickpea", page_size=100)
    alias = _page(api_client, ingredient="  garbanzo BEANS ", page_size=100)

    assert canonical["total"] == 5
    assert alias["total"] == canonical["total"]
    assert {item["id"] for item in alias["items"]} == {item["id"] for item in canonical["items"]}
    assert _page(api_client, ingredient="unknown ingredient")["total"] == 0
    assert _page(api_client, is_variant="true", page_size=100)["total"] == 9
    assert _page(api_client, is_variant="false", page_size=100)["total"] == 25

    carrot_lineage = _page(
        api_client,
        lineage_id=str(CARROT_LINEAGE_ID),
        page_size=100,
    )
    assert carrot_lineage["total"] == 3
    assert {item["id"] for item in carrot_lineage["items"]} == {
        str(CARROT_ROOT_ID),
        str(CARROT_PECAN_ID),
        str(CARROT_ORANGE_ID),
    }
    assert (
        _page(
            api_client,
            lineage_id=str(CARROT_LINEAGE_ID),
            is_variant="true",
            page_size=100,
        )["total"]
        == 2
    )


def test_recipe_categories_are_curated_stable_and_filter_public_browse_exactly(
    api_client: TestClient,
) -> None:
    response = api_client.get("/api/recipe-categories")

    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {
                "id": str(seed_uuid(DATASET_ID, "recipe-category", key)),
                "name": name,
                "slug": slug,
            }
            for key, name, slug in (
                ("breakfast", "Breakfast", "breakfast"),
                ("lunch", "Lunch", "lunch"),
                ("dinner", "Dinner", "dinner"),
                ("desserts", "Desserts", "desserts"),
                ("breads", "Breads", "breads"),
                ("vegetarian", "Vegetarian", "vegetarian"),
                ("quick-easy", "Quick & Easy", "quick-easy"),
            )
        ]
    }

    breakfast = _page(api_client, category="breakfast", page_size=100)
    breakfast_items = cast(list[dict[str, Any]], breakfast["items"])
    assert breakfast["total"] == 7
    assert all(
        "breakfast" in {category["slug"] for category in item["categories"]}
        for item in breakfast_items
    )
    assert _page(api_client, category="not-curated", page_size=100)["items"] == []

    combined = _page(
        api_client,
        category="quick-easy",
        q="spaghetti",
        is_variant="true",
        sort="newest",
        page_size=100,
    )
    assert [item["id"] for item in combined["items"]] == sorted(
        [str(PASTA_SECOND_ID), str(PASTA_THIRD_ID)]
    )
    assert all(
        {category["id"] for category in item["categories"]} >= {str(QUICK_EASY_CATEGORY_ID)}
        for item in combined["items"]
    )


def test_public_category_snapshots_remain_readable_when_authoring_category_is_inactive(
    api_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    try:
        with Session(bind=seeded_api_engine) as session, session.begin():
            category = session.get(RecipeCategory, BREAKFAST_CATEGORY_ID)
            assert category is not None
            category.active = False

        category_items = _json_object(api_client.get("/api/recipe-categories").json())["items"]
        assert str(BREAKFAST_CATEGORY_ID) not in {item["id"] for item in category_items}
        breakfast = _page(api_client, category="breakfast", page_size=100)
        assert breakfast["total"] == 7
    finally:
        with Session(bind=seeded_api_engine) as session, session.begin():
            category = session.get(RecipeCategory, BREAKFAST_CATEGORY_ID)
            assert category is not None
            category.active = True


def test_recipe_detail_returns_ordered_snapshot_and_direct_children(
    api_client: TestClient,
) -> None:
    response = api_client.get(f"/api/recipes/{CARROT_ROOT_ID}")

    assert response.status_code == 200
    detail = _json_object(response.json())
    assert detail["id"] == str(CARROT_ROOT_ID)
    assert detail["lineage_id"] == str(CARROT_LINEAGE_ID)
    assert detail["parent"] is None
    assert detail["servings"] == "8.00"
    assert detail["total_time_minutes"] is None
    assert detail["active_time_minutes"] is None
    assert detail["difficulty"] is None
    assert detail["notes"] is None
    assert detail["average_rating"] is None
    assert detail["rating_count"] == 0
    assert detail["save_count"] == 0
    assert detail["author"] == {
        "id": str(CATALOG_AUTHOR_ID),
        "handle": "recipe-lab-catalog",
        "display_name": "Recipe Lab Demo Catalog",
    }
    children = cast(list[dict[str, Any]], detail["children"])
    assert [child["id"] for child in children] == [
        str(CARROT_PECAN_ID),
        str(CARROT_ORANGE_ID),
    ]

    ingredients = cast(list[dict[str, Any]], detail["ingredients"])
    instructions = cast(list[dict[str, Any]], detail["instructions"])
    assert [item["display_order"] for item in ingredients] == list(range(9))
    assert [item["display_order"] for item in instructions] == list(range(4))
    sugar = next(item for item in ingredients if item["display_name"] == "White sugar")
    assert sugar["canonical_name"] == "Granulated sugar"
    assert sugar["measure"]["kind"] == "exact"
    assert sugar["measure"]["value"] == "180.0000"
    assert sugar["measure"]["unit"]["key"] == "g"
    assert sugar["measure"]["display"] == "180 g"
    assert "quantity" not in sugar
    assert "unit" not in sugar
    assert instructions[0]["text"].startswith("Heat the oven")
    first_actions = cast(list[dict[str, Any]], instructions[0]["actions"])
    assert [action["display_order"] for action in first_actions] == [0, 1, 2]
    assert [action["action_type"]["key"] for action in first_actions] == [
        "preheat",
        "grease",
        "line",
    ]
    assert first_actions[0]["duration"] is None
    assert first_actions[0]["temperature"]["value"] == "180.000000"
    assert first_actions[0]["temperature"]["unit"]["key"] == "celsius"
    oil_occurrence = next(
        item["id"] for item in ingredients if item["display_name"] == "Vegetable oil"
    )
    assert first_actions[1]["ingredient_occurrence_ids"] == [oil_occurrence]


def test_recipe_detail_exposes_reviewed_titles_and_nullable_historical_fallback(
    api_client: TestClient,
) -> None:
    titled_response = api_client.get(f"/api/recipes/{BANANA_ROOT_ID}")
    untitled_response = api_client.get(f"/api/recipes/{CARROT_ROOT_ID}")

    assert titled_response.status_code == untitled_response.status_code == 200
    titled_instructions = cast(
        list[dict[str, Any]],
        _json_object(titled_response.json())["instructions"],
    )
    untitled_instructions = cast(
        list[dict[str, Any]],
        _json_object(untitled_response.json())["instructions"],
    )
    assert [item["title"] for item in titled_instructions] == [
        "Make the batter",
        "Rest the batter and heat the skillet",
        "Cook the pancakes",
    ]
    assert all(item["title"] is None for item in untitled_instructions)


def test_seeded_recipe_detail_select_count_has_a_deterministic_ceiling(
    api_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    captured_runs: list[list[str]] = []

    for _run in range(2):
        with _read_statement_counter(seeded_api_engine) as statements:
            response = api_client.get(f"/api/recipes/{CARROT_ROOT_ID}")
        assert response.status_code == 200
        captured_runs.append(statements)

    counts = [len(statements) for statements in captured_runs]
    assert counts[0] == counts[1]
    assert counts[0] <= 10

    joined_statements = "\n".join(captured_runs[0])
    for expected_table in (
        "recipe_versions",
        "recipe_version_ingredients",
        "recipe_version_instructions",
        "recipe_instruction_actions",
        "recipe_instruction_action_inputs",
        "recipe_instruction_action_measures",
        "recipe_ratings",
    ):
        assert expected_table in joined_statements


def test_inactive_action_type_remains_readable_but_is_not_selectable(
    api_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    action_type_id = action_uuid("action-type", "preheat")
    try:
        with Session(bind=seeded_api_engine) as session, session.begin():
            action_type = session.get(CookingActionType, action_type_id)
            assert action_type is not None
            action_type.active = False

        detail_response = api_client.get(f"/api/recipes/{CARROT_ROOT_ID}")
        catalog_response = api_client.get(
            "/api/cooking-action-types",
            params={"limit": 100},
        )

        assert detail_response.status_code == 200
        instructions = cast(
            list[dict[str, Any]],
            _json_object(detail_response.json())["instructions"],
        )
        preheat = cast(list[dict[str, Any]], instructions[0]["actions"])[0]
        assert preheat["action_type"] == {
            "id": str(action_type_id),
            "key": "preheat",
            "canonical_verb": "preheat",
            "active": False,
        }

        assert catalog_response.status_code == 200
        catalog_items = cast(
            list[dict[str, Any]],
            _json_object(catalog_response.json())["items"],
        )
        assert str(action_type_id) not in {item["id"] for item in catalog_items}
    finally:
        with Session(bind=seeded_api_engine) as session, session.begin():
            action_type = session.get(CookingActionType, action_type_id)
            assert action_type is not None
            action_type.active = True


def test_recipe_detail_summarizes_ratings_without_exposing_users(
    api_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    user_ids = [uuid4(), uuid4()]
    with Session(bind=seeded_api_engine) as session, session.begin():
        session.add_all(
            [
                User(
                    id=user_ids[0],
                    email=f"{user_ids[0]}@example.com",
                    display_name="First test rater",
                ),
                User(
                    id=user_ids[1],
                    email=f"{user_ids[1]}@example.com",
                    display_name="Second test rater",
                ),
            ]
        )
        session.flush()
        session.add_all(
            [
                RecipeRating(
                    user_id=user_ids[0],
                    recipe_version_id=CARROT_ROOT_ID,
                    rating=4,
                ),
                RecipeRating(
                    user_id=user_ids[1],
                    recipe_version_id=CARROT_ROOT_ID,
                    rating=5,
                ),
                RecipeSave(
                    user_id=user_ids[0],
                    recipe_version_id=CARROT_ROOT_ID,
                ),
            ]
        )

    try:
        response = api_client.get(f"/api/recipes/{CARROT_ROOT_ID}")
        assert response.status_code == 200
        detail = _json_object(response.json())
        assert detail["average_rating"] == 4.5
        assert detail["rating_count"] == 2
        assert detail["save_count"] == 1
        assert "ratings" not in detail
        assert "users" not in detail
    finally:
        with Session(bind=seeded_api_engine) as session, session.begin():
            session.execute(delete(RecipeSave).where(RecipeSave.user_id.in_(user_ids)))
            session.execute(delete(RecipeRating).where(RecipeRating.user_id.in_(user_ids)))
            session.execute(delete(User).where(User.id.in_(user_ids)))


def test_recipe_detail_returns_parent_without_transitive_children(
    api_client: TestClient,
) -> None:
    response = api_client.get(f"/api/recipes/{CARROT_PECAN_ID}")

    assert response.status_code == 200
    detail = _json_object(response.json())
    assert detail["parent"] == {
        "id": str(CARROT_ROOT_ID),
        "version_number": 1,
        "title": "Carrot Walnut Snack Cake",
        "author": {
            "id": str(CATALOG_AUTHOR_ID),
            "handle": "recipe-lab-catalog",
            "display_name": "Recipe Lab Demo Catalog",
        },
    }
    assert detail["children"] == []


def test_recipe_detail_exposes_only_direct_children_in_a_deep_lineage(
    api_client: TestClient,
) -> None:
    root = _json_object(api_client.get(f"/api/recipes/{PASTA_ROOT_ID}").json())
    second = _json_object(api_client.get(f"/api/recipes/{PASTA_SECOND_ID}").json())

    assert [child["id"] for child in root["children"]] == [str(PASTA_SECOND_ID)]
    assert str(PASTA_THIRD_ID) not in {child["id"] for child in root["children"]}
    assert second["parent"]["id"] == str(PASTA_ROOT_ID)
    assert [child["id"] for child in second["children"]] == [str(PASTA_THIRD_ID)]


@pytest.mark.parametrize(
    ("path", "expected_code"),
    [
        ("/api/recipes/not-a-uuid", "invalid_identifier"),
        ("/api/recipes?lineage_id=not-a-uuid", "invalid_identifier"),
        ("/api/recipes?page=0", "validation_error"),
        ("/api/recipes?page=1000001", "validation_error"),
        ("/api/recipes?page_size=101", "validation_error"),
        ("/api/recipes?q=%20%20", "validation_error"),
        ("/api/recipes?q=%00", "validation_error"),
        ("/api/recipes?ingredient=%00", "validation_error"),
        ("/api/recipes?category=Breakfast", "validation_error"),
        ("/api/recipes?category=breakfast%20lunch", "validation_error"),
        ("/api/recipes?sort=popular", "validation_error"),
    ],
)
def test_invalid_requests_use_the_documented_error_envelope(
    api_client: TestClient,
    path: str,
    expected_code: str,
) -> None:
    response = api_client.get(path)

    assert response.status_code == 422
    error = _json_object(response.json())["error"]
    assert error["code"] == expected_code
    assert error["message"]
    assert error["issues"]


def test_missing_recipe_uses_the_documented_error_envelope(api_client: TestClient) -> None:
    missing_id = uuid4()
    response = api_client.get(f"/api/recipes/{missing_id}")

    assert response.status_code == 404
    correlation_id = response.headers["X-Correlation-ID"]
    assert response.json() == {
        "error": {
            "code": "recipe_not_found",
            "message": "The recipe was not found or is not publicly available.",
            "issues": [],
            "correlation_id": correlation_id,
        }
    }


def test_openapi_documents_recipe_and_error_schemas(api_client: TestClient) -> None:
    document = _json_object(api_client.get("/openapi.json").json())
    paths = cast(dict[str, Any], document["paths"])
    schemas = cast(dict[str, Any], cast(dict[str, Any], document["components"])["schemas"])

    assert "/api/recipes" in paths
    assert "/api/recipe-categories" in paths
    assert "/api/recipes/featured" in paths
    assert "/api/recipes/{recipe_version_id}" in paths
    assert {
        "RecipePageResponse",
        "RecipeCategoryListResponse",
        "RecipeCategorySummary",
        "FeaturedRecipeListResponse",
        "FeaturedRecipeSummary",
        "RecipeCardSummary",
        "RecipeDetailResponse",
        "RecipeIngredientResponse",
        "ExactMeasureResponse",
        "RangeMeasureResponse",
        "QualitativeMeasureResponse",
        "MeasurementUnitSummary",
        "RecipeInstructionResponse",
        "ErrorResponse",
    } <= set(schemas)
    detail_properties = schemas["RecipeDetailResponse"]["properties"]
    assert detail_properties["average_rating"]["anyOf"][0]["minimum"] == 1
    assert detail_properties["average_rating"]["anyOf"][0]["maximum"] == 5
    assert detail_properties["rating_count"]["minimum"] == 0
    assert detail_properties["save_count"]["minimum"] == 0
    assert {"average_rating", "rating_count", "save_count"} <= set(
        schemas["RecipeDetailResponse"]["required"]
    )

    browse_responses = paths["/api/recipes"]["get"]["responses"]
    category_responses = paths["/api/recipe-categories"]["get"]["responses"]
    featured_responses = paths["/api/recipes/featured"]["get"]["responses"]
    detail_responses = paths["/api/recipes/{recipe_version_id}"]["get"]["responses"]
    assert browse_responses["200"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/RecipePageResponse"
    )
    browse_item_schema = schemas["RecipePageResponse"]["properties"]["items"]["items"]
    assert browse_item_schema["$ref"].endswith("/RecipeCardSummary")
    card_properties = schemas["RecipeCardSummary"]["properties"]
    assert card_properties["average_rating"]["anyOf"][0]["minimum"] == 1
    assert card_properties["average_rating"]["anyOf"][0]["maximum"] == 5
    assert card_properties["rating_count"]["minimum"] == 0
    assert card_properties["save_count"]["minimum"] == 0
    assert {"average_rating", "rating_count", "save_count"} <= set(
        schemas["RecipeCardSummary"]["required"]
    )
    assert browse_responses["422"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/ErrorResponse"
    )
    browse_parameters = {
        parameter["name"]: parameter for parameter in paths["/api/recipes"]["get"]["parameters"]
    }
    assert browse_parameters["page"]["schema"]["minimum"] == 1
    assert browse_parameters["page"]["schema"]["maximum"] == 1_000_000
    assert browse_parameters["page_size"]["schema"]["minimum"] == 1
    assert browse_parameters["page_size"]["schema"]["maximum"] == 100
    assert browse_parameters["category"]["schema"]["anyOf"][0]["pattern"] == (
        "^[a-z0-9]+(?:-[a-z0-9]+)*$"
    )
    sort_schema = browse_parameters["sort"]["schema"]
    assert sort_schema["default"] == "title"
    assert sort_schema["enum"] == ["title", "newest"]
    assert sort_schema["type"] == "string"
    assert featured_responses["200"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/FeaturedRecipeListResponse"
    )
    featured_properties = schemas["FeaturedRecipeSummary"]["properties"]
    assert featured_properties["average_rating"]["anyOf"][0]["minimum"] == 1
    assert featured_properties["average_rating"]["anyOf"][0]["maximum"] == 5
    assert featured_properties["rating_count"]["minimum"] == 0
    assert featured_properties["save_count"]["minimum"] == 0
    assert category_responses["200"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/RecipeCategoryListResponse"
    )
    assert detail_responses["200"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/RecipeDetailResponse"
    )
    assert detail_responses["404"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/ErrorResponse"
    )
    assert detail_responses["422"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/ErrorResponse"
    )
