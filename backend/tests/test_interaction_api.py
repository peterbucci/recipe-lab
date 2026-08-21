import json
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, delete, func, select
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.core.demo_identity import (
    DEMO_USER_CREATED_AT,
    DEMO_USER_DISPLAY_NAME,
    DEMO_USER_EMAIL,
    DEMO_USER_ID,
)
from app.main import create_app
from app.models import PreferenceEvent, RecipeRating, RecipeSave, User
from app.repositories.interactions import save_recipe
from app.seeds.identifiers import seed_uuid

DATASET_ID = "recipe-lab-demo-v1"
CARROT_ROOT_ID = seed_uuid(
    DATASET_ID,
    "recipe-version",
    "carrot-walnut-snack-cake-v1",
)
CARROT_PECAN_ID = seed_uuid(
    DATASET_ID,
    "recipe-version",
    "lower-sugar-pecan-carrot-cake-v2",
)


def _clear_demo_interactions(engine: Engine) -> None:
    with Session(bind=engine) as session, session.begin():
        session.execute(delete(PreferenceEvent).where(PreferenceEvent.user_id == DEMO_USER_ID))
        session.execute(delete(RecipeRating).where(RecipeRating.user_id == DEMO_USER_ID))
        session.execute(delete(RecipeSave).where(RecipeSave.user_id == DEMO_USER_ID))


@pytest.fixture
def interaction_client(seeded_api_engine: Engine) -> Iterator[TestClient]:
    _clear_demo_interactions(seeded_api_engine)
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
        _clear_demo_interactions(seeded_api_engine)


def _json_object(response_json: object) -> dict[str, Any]:
    return cast(dict[str, Any], response_json)


def _action_headers(action_id: UUID | None = None) -> dict[str, str]:
    return {"Idempotency-Key": str(action_id or uuid4())}


def _expected_state(
    recipe_version_id: UUID,
    *,
    saved: bool,
    rating: int | None,
) -> dict[str, object]:
    return {
        "recipe_version_id": str(recipe_version_id),
        "user": {
            "id": str(DEMO_USER_ID),
            "display_name": DEMO_USER_DISPLAY_NAME,
            "identity_mode": "shared_demo",
        },
        "saved": saved,
        "rating": rating,
    }


def _interaction_count(
    engine: Engine,
    model: type[RecipeSave] | type[RecipeRating],
    *,
    recipe_version_id: UUID,
) -> int:
    with Session(bind=engine) as session:
        return (
            session.scalar(
                select(func.count())
                .select_from(model)
                .where(
                    model.user_id == DEMO_USER_ID,
                    model.recipe_version_id == recipe_version_id,
                )
            )
            or 0
        )


def test_current_demo_identity_and_recipe_viewer_state_are_explicit(
    interaction_client: TestClient,
) -> None:
    identity_response = interaction_client.get("/api/me")

    assert identity_response.status_code == 200
    assert identity_response.json() == {
        "id": str(DEMO_USER_ID),
        "display_name": DEMO_USER_DISPLAY_NAME,
        "identity_mode": "shared_demo",
    }
    assert "email" not in _json_object(identity_response.json())

    detail_response = interaction_client.get(f"/api/recipes/{CARROT_ROOT_ID}")

    assert detail_response.status_code == 200
    detail = _json_object(detail_response.json())
    assert detail["viewer_state"] == _expected_state(
        CARROT_ROOT_ID,
        saved=False,
        rating=None,
    )


def test_save_and_unsave_are_retry_safe_and_database_unique(
    interaction_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    save_action_id = uuid4()
    first_save = interaction_client.put(
        f"/api/recipes/{CARROT_ROOT_ID}/save",
        headers=_action_headers(save_action_id),
    )
    assert first_save.status_code == 200
    assert first_save.json() == _expected_state(CARROT_ROOT_ID, saved=True, rating=None)

    with Session(bind=seeded_api_engine) as session:
        saved_row = session.get(
            RecipeSave,
            {
                "user_id": DEMO_USER_ID,
                "recipe_version_id": CARROT_ROOT_ID,
            },
        )
        assert saved_row is not None
        first_created_at = saved_row.created_at

    second_save = interaction_client.put(
        f"/api/recipes/{CARROT_ROOT_ID}/save",
        headers=_action_headers(save_action_id),
    )
    assert second_save.status_code == 200
    assert second_save.json() == _expected_state(CARROT_ROOT_ID, saved=True, rating=None)
    assert (
        _interaction_count(
            seeded_api_engine,
            RecipeSave,
            recipe_version_id=CARROT_ROOT_ID,
        )
        == 1
    )
    with Session(bind=seeded_api_engine) as session:
        saved_row = session.get(
            RecipeSave,
            {
                "user_id": DEMO_USER_ID,
                "recipe_version_id": CARROT_ROOT_ID,
            },
        )
        assert saved_row is not None
        assert saved_row.created_at == first_created_at

    unsave_action_id = uuid4()
    first_unsave = interaction_client.delete(
        f"/api/recipes/{CARROT_ROOT_ID}/save",
        headers=_action_headers(unsave_action_id),
    )
    second_unsave = interaction_client.delete(
        f"/api/recipes/{CARROT_ROOT_ID}/save",
        headers=_action_headers(unsave_action_id),
    )

    assert first_unsave.status_code == 200
    assert first_unsave.json() == _expected_state(CARROT_ROOT_ID, saved=False, rating=None)
    assert second_unsave.status_code == 200
    assert second_unsave.json() == _expected_state(CARROT_ROOT_ID, saved=False, rating=None)
    assert (
        _interaction_count(
            seeded_api_engine,
            RecipeSave,
            recipe_version_id=CARROT_ROOT_ID,
        )
        == 0
    )


def test_concurrent_saves_from_separate_sessions_leave_one_row(
    interaction_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    start = Barrier(2)

    def attempt_save() -> None:
        with Session(bind=seeded_api_engine) as session, session.begin():
            start.wait(timeout=5)
            save_recipe(
                session,
                user_id=DEMO_USER_ID,
                recipe_version_id=CARROT_ROOT_ID,
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(attempt_save) for _ in range(2)]
        for future in futures:
            future.result(timeout=10)

    assert (
        _interaction_count(
            seeded_api_engine,
            RecipeSave,
            recipe_version_id=CARROT_ROOT_ID,
        )
        == 1
    )
    detail_response = interaction_client.get(f"/api/recipes/{CARROT_ROOT_ID}")
    assert detail_response.status_code == 200
    assert _json_object(detail_response.json())["viewer_state"] == _expected_state(
        CARROT_ROOT_ID,
        saved=True,
        rating=None,
    )


def test_rating_create_retry_and_update_keep_one_current_state_row(
    interaction_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    rating_action_id = uuid4()
    first_rating = interaction_client.put(
        f"/api/recipes/{CARROT_ROOT_ID}/rating",
        json={"rating": 2},
        headers=_action_headers(rating_action_id),
    )
    assert first_rating.status_code == 200
    assert first_rating.json() == _expected_state(CARROT_ROOT_ID, saved=False, rating=2)

    with Session(bind=seeded_api_engine) as session:
        rating_row = session.get(
            RecipeRating,
            {
                "user_id": DEMO_USER_ID,
                "recipe_version_id": CARROT_ROOT_ID,
            },
        )
        assert rating_row is not None
        first_created_at = rating_row.created_at

    repeated_rating = interaction_client.put(
        f"/api/recipes/{CARROT_ROOT_ID}/rating",
        json={"rating": 2},
        headers=_action_headers(rating_action_id),
    )
    updated_rating = interaction_client.put(
        f"/api/recipes/{CARROT_ROOT_ID}/rating",
        json={"rating": 5},
        headers=_action_headers(),
    )

    assert repeated_rating.status_code == 200
    assert repeated_rating.json() == _expected_state(CARROT_ROOT_ID, saved=False, rating=2)
    assert updated_rating.status_code == 200
    assert updated_rating.json() == _expected_state(CARROT_ROOT_ID, saved=False, rating=5)
    assert (
        _interaction_count(
            seeded_api_engine,
            RecipeRating,
            recipe_version_id=CARROT_ROOT_ID,
        )
        == 1
    )
    with Session(bind=seeded_api_engine) as session:
        rating_row = session.get(
            RecipeRating,
            {
                "user_id": DEMO_USER_ID,
                "recipe_version_id": CARROT_ROOT_ID,
            },
        )
        assert rating_row is not None
        assert rating_row.rating == 5
        assert rating_row.created_at == first_created_at

    detail_response = interaction_client.get(f"/api/recipes/{CARROT_ROOT_ID}")
    assert detail_response.status_code == 200
    detail = _json_object(detail_response.json())
    assert detail["average_rating"] == 5
    assert detail["rating_count"] == 1
    assert detail["viewer_state"] == _expected_state(
        CARROT_ROOT_ID,
        saved=False,
        rating=5,
    )


@pytest.mark.parametrize(
    "invalid_rating",
    [True, "5", 5.0, None, 0, 6],
    ids=["boolean", "string", "float", "null", "below-range", "above-range"],
)
def test_rating_rejects_non_strict_or_out_of_range_values_without_changing_state(
    interaction_client: TestClient,
    seeded_api_engine: Engine,
    invalid_rating: object,
) -> None:
    initial_response = interaction_client.put(
        f"/api/recipes/{CARROT_ROOT_ID}/rating",
        json={"rating": 3},
        headers=_action_headers(),
    )
    assert initial_response.status_code == 200

    response = interaction_client.put(
        f"/api/recipes/{CARROT_ROOT_ID}/rating",
        json={"rating": invalid_rating},
        headers=_action_headers(),
    )

    assert response.status_code == 422
    error = _json_object(response.json())["error"]
    assert error["code"] == "validation_error"
    assert error["issues"]
    with Session(bind=seeded_api_engine) as session:
        rating_row = session.get(
            RecipeRating,
            {
                "user_id": DEMO_USER_ID,
                "recipe_version_id": CARROT_ROOT_ID,
            },
        )
        assert rating_row is not None
        assert rating_row.rating == 3


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"rating": 4, "user_id": "00000000-0000-0000-0000-000000000000"},
    ],
    ids=["missing-rating", "client-controlled-user"],
)
def test_rating_rejects_incomplete_or_identity_overriding_payloads(
    interaction_client: TestClient,
    seeded_api_engine: Engine,
    payload: dict[str, object],
) -> None:
    response = interaction_client.put(
        f"/api/recipes/{CARROT_ROOT_ID}/rating",
        json=payload,
        headers=_action_headers(),
    )

    assert response.status_code == 422
    error = _json_object(response.json())["error"]
    assert error["code"] == "validation_error"
    assert error["issues"]
    assert (
        _interaction_count(
            seeded_api_engine,
            RecipeRating,
            recipe_version_id=CARROT_ROOT_ID,
        )
        == 0
    )


@pytest.mark.parametrize(
    ("method", "suffix", "payload"),
    [
        ("PUT", "save", None),
        ("DELETE", "save", None),
        ("PUT", "rating", {"rating": 4}),
    ],
)
def test_interaction_writes_reject_missing_recipe_versions(
    interaction_client: TestClient,
    method: str,
    suffix: str,
    payload: dict[str, object] | None,
) -> None:
    missing_id = uuid4()
    path = f"/api/recipes/{missing_id}/{suffix}"
    response = (
        interaction_client.request(method, path, headers=_action_headers())
        if payload is None
        else interaction_client.request(
            method,
            path,
            json=payload,
            headers=_action_headers(),
        )
    )

    assert response.status_code == 404
    assert response.json() == {
        "error": {
            "code": "recipe_not_found",
            "message": f"Recipe version {missing_id} was not found.",
            "issues": [],
        }
    }


@pytest.mark.parametrize(
    ("method", "suffix", "payload"),
    [
        ("PUT", "save", None),
        ("DELETE", "save", None),
        ("PUT", "rating", {"rating": 4}),
    ],
)
def test_interaction_writes_reject_malformed_recipe_identifiers(
    interaction_client: TestClient,
    method: str,
    suffix: str,
    payload: dict[str, object] | None,
) -> None:
    path = f"/api/recipes/not-a-uuid/{suffix}"
    response = (
        interaction_client.request(method, path, headers=_action_headers())
        if payload is None
        else interaction_client.request(
            method,
            path,
            json=payload,
            headers=_action_headers(),
        )
    )

    assert response.status_code == 422
    error = _json_object(response.json())["error"]
    assert error["code"] == "invalid_identifier"
    assert error["issues"]


def test_viewer_state_is_isolated_by_user_and_recipe_version(
    interaction_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    other_user_id = uuid4()
    with Session(bind=seeded_api_engine) as session, session.begin():
        session.add(
            User(
                id=other_user_id,
                email=f"{other_user_id}@example.com",
                display_name="Interaction isolation user",
            )
        )
        session.flush()
        session.add_all(
            [
                RecipeSave(
                    user_id=other_user_id,
                    recipe_version_id=CARROT_ROOT_ID,
                ),
                RecipeRating(
                    user_id=other_user_id,
                    recipe_version_id=CARROT_ROOT_ID,
                    rating=2,
                ),
            ]
        )

    try:
        save_response = interaction_client.put(
            f"/api/recipes/{CARROT_ROOT_ID}/save",
            headers=_action_headers(),
        )
        rating_response = interaction_client.put(
            f"/api/recipes/{CARROT_ROOT_ID}/rating",
            json={"rating": 4},
            headers=_action_headers(),
        )
        assert save_response.status_code == 200
        assert rating_response.status_code == 200

        root_detail = _json_object(interaction_client.get(f"/api/recipes/{CARROT_ROOT_ID}").json())
        pecan_detail = _json_object(
            interaction_client.get(f"/api/recipes/{CARROT_PECAN_ID}").json()
        )

        assert root_detail["average_rating"] == 3
        assert root_detail["rating_count"] == 2
        assert root_detail["viewer_state"] == _expected_state(
            CARROT_ROOT_ID,
            saved=True,
            rating=4,
        )
        assert pecan_detail["viewer_state"] == _expected_state(
            CARROT_PECAN_ID,
            saved=False,
            rating=None,
        )
        assert pecan_detail["average_rating"] is None
        assert pecan_detail["rating_count"] == 0
    finally:
        with Session(bind=seeded_api_engine) as session, session.begin():
            session.execute(delete(User).where(User.id == other_user_id))


def test_missing_demo_user_returns_a_stable_service_error(
    interaction_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    with Session(bind=seeded_api_engine) as session, session.begin():
        session.execute(delete(User).where(User.id == DEMO_USER_ID))

    expected_error = {
        "error": {
            "code": "demo_user_unavailable",
            "message": "The demo user is unavailable. Load the bundled seed data and try again.",
            "issues": [],
        }
    }
    try:
        identity_response = interaction_client.get("/api/me")
        detail_response = interaction_client.get(f"/api/recipes/{CARROT_ROOT_ID}")
        save_response = interaction_client.put(
            f"/api/recipes/{CARROT_ROOT_ID}/save",
            headers=_action_headers(),
        )

        assert identity_response.status_code == 503
        assert identity_response.json() == expected_error
        assert detail_response.status_code == 503
        assert detail_response.json() == expected_error
        assert save_response.status_code == 503
        assert save_response.json() == expected_error
    finally:
        with Session(bind=seeded_api_engine) as session, session.begin():
            session.add(
                User(
                    id=DEMO_USER_ID,
                    email=DEMO_USER_EMAIL,
                    display_name=DEMO_USER_DISPLAY_NAME,
                    created_at=DEMO_USER_CREATED_AT,
                )
            )


@pytest.mark.parametrize(
    ("suffix", "method"),
    [
        ("save", "PUT"),
        ("save", "DELETE"),
        ("rating", "PUT"),
    ],
)
def test_direct_browser_interaction_writes_allow_the_loopback_frontend_origin(
    interaction_client: TestClient,
    suffix: str,
    method: str,
) -> None:
    response = interaction_client.options(
        f"/api/recipes/{CARROT_ROOT_ID}/{suffix}",
        headers={
            "Origin": "http://127.0.0.1:3000",
            "Access-Control-Request-Method": method,
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:3000"
    assert method in response.headers["access-control-allow-methods"]
    assert "content-type" in response.headers["access-control-allow-headers"].casefold()


def test_openapi_documents_demo_identity_viewer_state_and_interactions(
    interaction_client: TestClient,
) -> None:
    document = _json_object(interaction_client.get("/openapi.json").json())
    paths = cast(dict[str, Any], document["paths"])
    schemas = cast(dict[str, Any], cast(dict[str, Any], document["components"])["schemas"])

    assert {
        "/api/me",
        "/api/recipes/{recipe_version_id}",
        "/api/recipes/{recipe_version_id}/save",
        "/api/recipes/{recipe_version_id}/rating",
    } <= set(paths)
    assert {
        "DemoUserResponse",
        "RecipeViewerStateResponse",
        "RatingUpdateRequest",
    } <= set(schemas)

    demo_user_schema = schemas["DemoUserResponse"]
    assert {"id", "display_name", "identity_mode"} == set(demo_user_schema["required"])
    assert "email" not in demo_user_schema["properties"]
    assert demo_user_schema["properties"]["identity_mode"]["const"] == "shared_demo"

    viewer_state_schema = schemas["RecipeViewerStateResponse"]
    assert {"recipe_version_id", "user", "saved", "rating"} == set(viewer_state_schema["required"])
    assert "viewer_state" in schemas["RecipeDetailResponse"]["required"]

    rating_schema = schemas["RatingUpdateRequest"]["properties"]["rating"]
    assert rating_schema["type"] == "integer"
    assert rating_schema["minimum"] == 1
    assert rating_schema["maximum"] == 5
    assert schemas["RatingUpdateRequest"]["required"] == ["rating"]

    assert {"put", "delete"} <= set(paths["/api/recipes/{recipe_version_id}/save"])
    assert "put" in paths["/api/recipes/{recipe_version_id}/rating"]
    for path, method in [
        ("/api/me", "get"),
        ("/api/recipes/{recipe_version_id}", "get"),
        ("/api/recipes/{recipe_version_id}/save", "put"),
        ("/api/recipes/{recipe_version_id}/save", "delete"),
        ("/api/recipes/{recipe_version_id}/rating", "put"),
    ]:
        responses = paths[path][method]["responses"]
        assert responses["503"]["content"]["application/json"]["schema"]["$ref"].endswith(
            "/ErrorResponse"
        )

    assert '"user_id"' not in json.dumps(document)
