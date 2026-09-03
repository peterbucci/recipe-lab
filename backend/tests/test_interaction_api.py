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

from app.models import PreferenceEvent, RecipeRating, RecipeSave, User
from app.repositories.interactions import save_recipe
from app.seeds.identifiers import seed_uuid
from tests.application import application_with_database
from tests.member_session import authenticate_client, create_member_credentials

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
MEMBER_USER_ID = UUID("77000000-0000-4000-8000-000000000001")


def _clear_member_interactions(engine: Engine) -> None:
    with Session(bind=engine) as session, session.begin():
        session.execute(delete(PreferenceEvent).where(PreferenceEvent.user_id == MEMBER_USER_ID))
        session.execute(delete(RecipeRating).where(RecipeRating.user_id == MEMBER_USER_ID))
        session.execute(delete(RecipeSave).where(RecipeSave.user_id == MEMBER_USER_ID))


@pytest.fixture
def interaction_client(seeded_api_engine: Engine) -> Iterator[TestClient]:
    _clear_member_interactions(seeded_api_engine)
    credentials = create_member_credentials(seeded_api_engine, user_id=MEMBER_USER_ID)
    try:
        with application_with_database(seeded_api_engine) as application:
            with TestClient(application) as client:
                authenticate_client(client, credentials)
                yield client
    finally:
        _clear_member_interactions(seeded_api_engine)
        with Session(bind=seeded_api_engine) as session, session.begin():
            session.execute(delete(User).where(User.id == MEMBER_USER_ID))


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
                    model.user_id == MEMBER_USER_ID,
                    model.recipe_version_id == recipe_version_id,
                )
            )
            or 0
        )


def test_signed_in_member_gets_private_viewer_state_without_legacy_identity_route(
    interaction_client: TestClient,
) -> None:
    identity_response = interaction_client.get("/api/me")

    assert identity_response.status_code == 404

    detail_response = interaction_client.get(f"/api/recipes/{CARROT_ROOT_ID}")

    assert detail_response.status_code == 200
    detail = _json_object(detail_response.json())
    assert detail["viewer_state"] == _expected_state(
        CARROT_ROOT_ID,
        saved=False,
        rating=None,
    )
    assert detail_response.headers["cache-control"] == "private, no-store"
    assert "Cookie" in detail_response.headers["vary"]


def test_signed_in_member_loads_card_viewer_states_in_one_bounded_request(
    interaction_client: TestClient,
) -> None:
    save_response = interaction_client.put(
        f"/api/recipes/{CARROT_ROOT_ID}/save",
        headers=_action_headers(),
    )
    rating_response = interaction_client.put(
        f"/api/recipes/{CARROT_PECAN_ID}/rating",
        json={"rating": 4},
        headers=_action_headers(),
    )
    assert save_response.status_code == 200
    assert rating_response.status_code == 200

    missing_recipe_id = uuid4()
    response = interaction_client.get(
        "/api/recipes/viewer-states",
        params=[
            ("recipe_version_id", str(CARROT_ROOT_ID)),
            ("recipe_version_id", str(CARROT_PECAN_ID)),
            ("recipe_version_id", str(CARROT_ROOT_ID)),
            ("recipe_version_id", str(missing_recipe_id)),
        ],
    )

    assert response.status_code == 200
    assert response.json() == {
        "items": [
            _expected_state(CARROT_ROOT_ID, saved=True, rating=None),
            _expected_state(CARROT_PECAN_ID, saved=False, rating=4),
            _expected_state(missing_recipe_id, saved=False, rating=None),
        ]
    }
    assert response.headers["cache-control"] == "private, no-store"
    assert "Cookie" in response.headers["vary"]


def test_card_viewer_states_require_a_member_session(
    interaction_client: TestClient,
) -> None:
    interaction_client.cookies.clear()

    response = interaction_client.get(
        "/api/recipes/viewer-states",
        params={"recipe_version_id": str(CARROT_ROOT_ID)},
    )

    assert response.status_code == 401
    assert _json_object(response.json())["error"]["code"] == "authentication_required"


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
                "user_id": MEMBER_USER_ID,
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
                "user_id": MEMBER_USER_ID,
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
                user_id=MEMBER_USER_ID,
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
                "user_id": MEMBER_USER_ID,
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
                "user_id": MEMBER_USER_ID,
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


def test_rating_removal_retry_clears_current_state_and_public_aggregate(
    interaction_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    initial_rating = interaction_client.put(
        f"/api/recipes/{CARROT_ROOT_ID}/rating",
        json={"rating": 4},
        headers=_action_headers(),
    )
    assert initial_rating.status_code == 200

    removal_action_id = uuid4()
    first_removal = interaction_client.delete(
        f"/api/recipes/{CARROT_ROOT_ID}/rating",
        headers=_action_headers(removal_action_id),
    )
    repeated_removal = interaction_client.delete(
        f"/api/recipes/{CARROT_ROOT_ID}/rating",
        headers=_action_headers(removal_action_id),
    )

    expected_state = _expected_state(CARROT_ROOT_ID, saved=False, rating=None)
    assert first_removal.status_code == 200
    assert first_removal.json() == expected_state
    assert repeated_removal.status_code == 200
    assert repeated_removal.json() == expected_state
    assert (
        _interaction_count(
            seeded_api_engine,
            RecipeRating,
            recipe_version_id=CARROT_ROOT_ID,
        )
        == 0
    )

    conflicting_reuse = interaction_client.put(
        f"/api/recipes/{CARROT_ROOT_ID}/rating",
        json={"rating": 5},
        headers=_action_headers(removal_action_id),
    )
    assert conflicting_reuse.status_code == 409
    assert _json_object(conflicting_reuse.json())["error"]["code"] == ("idempotency_key_conflict")

    with Session(bind=seeded_api_engine) as session:
        rating_events = list(
            session.scalars(
                select(PreferenceEvent).where(
                    PreferenceEvent.user_id == MEMBER_USER_ID,
                    PreferenceEvent.recipe_version_id == CARROT_ROOT_ID,
                    PreferenceEvent.event_type == "rating",
                )
            )
        )
    assert len(rating_events) == 2
    assert sum(event.rating_value == 4 for event in rating_events) == 1
    assert sum(event.rating_value is None for event in rating_events) == 1

    detail_response = interaction_client.get(f"/api/recipes/{CARROT_ROOT_ID}")
    assert detail_response.status_code == 200
    detail = _json_object(detail_response.json())
    assert detail["average_rating"] is None
    assert detail["rating_count"] == 0
    assert detail["viewer_state"] == expected_state


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
                "user_id": MEMBER_USER_ID,
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
        ("DELETE", "rating", None),
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
    correlation_id = response.headers["X-Correlation-ID"]
    assert response.json() == {
        "error": {
            "code": "recipe_not_found",
            "message": "The recipe was not found or is not publicly available.",
            "issues": [],
            "correlation_id": correlation_id,
        }
    }


@pytest.mark.parametrize(
    ("method", "suffix", "payload"),
    [
        ("PUT", "save", None),
        ("DELETE", "save", None),
        ("PUT", "rating", {"rating": 4}),
        ("DELETE", "rating", None),
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


def test_missing_session_member_leaves_public_reads_available_and_rejects_writes(
    interaction_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    with Session(bind=seeded_api_engine) as session, session.begin():
        session.execute(delete(User).where(User.id == MEMBER_USER_ID))

    identity_response = interaction_client.get("/api/me")
    detail_response = interaction_client.get(f"/api/recipes/{CARROT_ROOT_ID}")
    save_response = interaction_client.put(
        f"/api/recipes/{CARROT_ROOT_ID}/save",
        headers=_action_headers(),
    )

    assert identity_response.status_code == 404
    assert detail_response.status_code == 200
    assert _json_object(detail_response.json())["viewer_state"] is None
    assert save_response.status_code == 401
    assert _json_object(save_response.json())["error"]["code"] == "authentication_required"


@pytest.mark.parametrize(
    ("suffix", "method"),
    [
        ("save", "PUT"),
        ("save", "DELETE"),
        ("rating", "PUT"),
        ("rating", "DELETE"),
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


def test_openapi_documents_member_viewer_state_and_interactions(
    interaction_client: TestClient,
) -> None:
    document = _json_object(interaction_client.get("/openapi.json").json())
    paths = cast(dict[str, Any], document["paths"])
    schemas = cast(dict[str, Any], cast(dict[str, Any], document["components"])["schemas"])

    assert {
        "/api/recipes/{recipe_version_id}",
        "/api/recipes/{recipe_version_id}/save",
        "/api/recipes/{recipe_version_id}/rating",
    } <= set(paths)
    assert "/api/me" not in paths
    assert {
        "RecipeViewerStateResponse",
        "RatingUpdateRequest",
    } <= set(schemas)

    viewer_state_schema = schemas["RecipeViewerStateResponse"]
    assert {"recipe_version_id", "saved", "rating"} == set(viewer_state_schema["required"])
    assert "user" not in viewer_state_schema["properties"]
    assert "viewer_state" in schemas["RecipeDetailResponse"]["required"]

    rating_schema = schemas["RatingUpdateRequest"]["properties"]["rating"]
    assert rating_schema["type"] == "integer"
    assert rating_schema["minimum"] == 1
    assert rating_schema["maximum"] == 5
    assert schemas["RatingUpdateRequest"]["required"] == ["rating"]

    assert {"put", "delete"} <= set(paths["/api/recipes/{recipe_version_id}/save"])
    assert {"put", "delete"} <= set(paths["/api/recipes/{recipe_version_id}/rating"])
    for path, method in [
        ("/api/recipes/{recipe_version_id}/save", "put"),
        ("/api/recipes/{recipe_version_id}/save", "delete"),
        ("/api/recipes/{recipe_version_id}/rating", "put"),
        ("/api/recipes/{recipe_version_id}/rating", "delete"),
    ]:
        responses = paths[path][method]["responses"]
        for status_code in ("401", "403", "422"):
            assert responses[status_code]["content"]["application/json"]["schema"]["$ref"].endswith(
                "/ErrorResponse"
            )

    assert '"user_id"' not in json.dumps(document)
