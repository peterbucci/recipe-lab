import json
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, delete, func, or_, select
from sqlalchemy.orm import Session

import app.api.routes.interactions as interaction_routes
import app.api.routes.recipes as recipe_routes
from app.api.dependencies import get_session
from app.core.demo_identity import (
    DEMO_USER_CREATED_AT,
    DEMO_USER_DISPLAY_NAME,
    DEMO_USER_EMAIL,
    DEMO_USER_ID,
)
from app.main import create_app
from app.models import (
    PreferenceEvent,
    RecipeIngredient,
    RecipeInstruction,
    RecipeRating,
    RecipeSave,
    RecipeVersion,
    User,
)
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


def _action_headers(action_id: UUID | None = None) -> dict[str, str]:
    return {"Idempotency-Key": str(action_id or uuid4())}


def _fork_payload(*, title: str = "Preference Event Carrot Cake") -> dict[str, object]:
    return {
        "title": title,
        "description": "A variant used to verify preference-event semantics.",
        "servings": "8.00",
        "ingredient_edits": [],
        "instruction_edits": [],
    }


def _clear_demo_activity(engine: Engine) -> None:
    with Session(bind=engine) as session, session.begin():
        fork_ids = list(
            session.scalars(
                select(RecipeVersion.id).where(RecipeVersion.created_by_user_id == DEMO_USER_ID)
            )
        )
        event_filter = PreferenceEvent.user_id == DEMO_USER_ID
        if fork_ids:
            event_filter = or_(
                event_filter,
                PreferenceEvent.recipe_version_id.in_(fork_ids),
                PreferenceEvent.related_recipe_version_id.in_(fork_ids),
            )
        session.execute(delete(PreferenceEvent).where(event_filter))
        session.execute(delete(RecipeRating).where(RecipeRating.user_id == DEMO_USER_ID))
        session.execute(delete(RecipeSave).where(RecipeSave.user_id == DEMO_USER_ID))
        if fork_ids:
            session.execute(
                delete(RecipeIngredient).where(RecipeIngredient.recipe_version_id.in_(fork_ids))
            )
            session.execute(
                delete(RecipeInstruction).where(RecipeInstruction.recipe_version_id.in_(fork_ids))
            )
            session.execute(delete(RecipeVersion).where(RecipeVersion.id.in_(fork_ids)))


@pytest.fixture(autouse=True)
def clean_demo_activity(seeded_api_engine: Engine) -> Iterator[None]:
    _clear_demo_activity(seeded_api_engine)
    try:
        yield
    finally:
        _clear_demo_activity(seeded_api_engine)


@pytest.fixture
def preference_client(seeded_api_engine: Engine) -> Iterator[TestClient]:
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


def _event_count(engine: Engine) -> int:
    with Session(bind=engine) as session:
        return session.scalar(select(func.count()).select_from(PreferenceEvent)) or 0


def _demo_fork_count(engine: Engine) -> int:
    with Session(bind=engine) as session:
        return (
            session.scalar(
                select(func.count())
                .select_from(RecipeVersion)
                .where(RecipeVersion.created_by_user_id == DEMO_USER_ID)
            )
            or 0
        )


def test_explicit_view_action_is_timestamped_and_exact_replays_are_deduplicated(
    preference_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    detail_response = preference_client.get(f"/api/recipes/{CARROT_ROOT_ID}")
    assert detail_response.status_code == 200
    assert _event_count(seeded_api_engine) == 0

    action_id = uuid4()
    first = preference_client.post(
        f"/api/recipes/{CARROT_ROOT_ID}/view",
        headers=_action_headers(action_id),
    )
    assert first.status_code == 204
    assert first.content == b""

    with Session(bind=seeded_api_engine) as session:
        event = session.get(PreferenceEvent, action_id)
        assert event is not None
        assert event.user_id == DEMO_USER_ID
        assert event.recipe_version_id == CARROT_ROOT_ID
        assert event.event_type == "view"
        assert event.saved_value is None
        assert event.rating_value is None
        assert event.related_recipe_version_id is None
        assert event.request_fingerprint is None
        assert event.occurred_at.tzinfo is not None
        assert event.occurred_at.utcoffset() is not None
        occurred_at = event.occurred_at

    replay = preference_client.post(
        f"/api/recipes/{CARROT_ROOT_ID}/view",
        headers=_action_headers(action_id),
    )
    assert replay.status_code == 204
    assert _event_count(seeded_api_engine) == 1
    with Session(bind=seeded_api_engine) as session:
        event = session.get(PreferenceEvent, action_id)
        assert event is not None
        assert event.occurred_at == occurred_at

    second_action_id = uuid4()
    second = preference_client.post(
        f"/api/recipes/{CARROT_ROOT_ID}/view",
        headers=_action_headers(second_action_id),
    )
    assert second.status_code == 204
    assert _event_count(seeded_api_engine) == 2


def test_action_keys_are_required_and_conflicting_reuse_does_not_change_state(
    preference_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    missing_header = preference_client.put(f"/api/recipes/{CARROT_ROOT_ID}/save")
    malformed_header = preference_client.put(
        f"/api/recipes/{CARROT_ROOT_ID}/save",
        headers={"Idempotency-Key": "not-a-uuid"},
    )
    missing_recipe_action_id = uuid4()
    missing_recipe = preference_client.post(
        f"/api/recipes/{uuid4()}/view",
        headers=_action_headers(missing_recipe_action_id),
    )

    assert missing_header.status_code == 422
    assert malformed_header.status_code == 422
    assert missing_recipe.status_code == 404
    assert _event_count(seeded_api_engine) == 0

    action_id = uuid4()
    saved = preference_client.put(
        f"/api/recipes/{CARROT_ROOT_ID}/save",
        headers=_action_headers(action_id),
    )
    conflict = preference_client.delete(
        f"/api/recipes/{CARROT_ROOT_ID}/save",
        headers=_action_headers(action_id),
    )
    missing_recipe_conflict = preference_client.put(
        f"/api/recipes/{uuid4()}/save",
        headers=_action_headers(action_id),
    )

    assert saved.status_code == 200
    assert conflict.status_code == 409
    assert conflict.json() == {
        "error": {
            "code": "idempotency_key_conflict",
            "message": ("The Idempotency-Key has already been used for a different recipe action."),
            "issues": [],
        }
    }
    assert missing_recipe_conflict.status_code == 409
    assert (
        _json_object(missing_recipe_conflict.json())["error"]["code"] == "idempotency_key_conflict"
    )
    with Session(bind=seeded_api_engine) as session:
        assert session.get(PreferenceEvent, action_id) is not None
        assert (
            session.get(
                RecipeSave,
                {"user_id": DEMO_USER_ID, "recipe_version_id": CARROT_ROOT_ID},
            )
            is not None
        )
    assert _event_count(seeded_api_engine) == 1


def test_save_and_rating_actions_record_typed_history_without_reapplying_old_retries(
    preference_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    save_action_id = uuid4()
    unsave_action_id = uuid4()
    rating_two_action_id = uuid4()
    rating_five_action_id = uuid4()

    assert (
        preference_client.put(
            f"/api/recipes/{CARROT_ROOT_ID}/save",
            headers=_action_headers(save_action_id),
        ).status_code
        == 200
    )
    assert (
        preference_client.delete(
            f"/api/recipes/{CARROT_ROOT_ID}/save",
            headers=_action_headers(unsave_action_id),
        ).status_code
        == 200
    )
    assert (
        preference_client.put(
            f"/api/recipes/{CARROT_ROOT_ID}/rating",
            headers=_action_headers(rating_two_action_id),
            json={"rating": 2},
        ).status_code
        == 200
    )
    assert (
        preference_client.put(
            f"/api/recipes/{CARROT_ROOT_ID}/rating",
            headers=_action_headers(rating_five_action_id),
            json={"rating": 5},
        ).status_code
        == 200
    )

    old_retry = preference_client.put(
        f"/api/recipes/{CARROT_ROOT_ID}/rating",
        headers=_action_headers(rating_two_action_id),
        json={"rating": 2},
    )
    assert old_retry.status_code == 200
    assert _json_object(old_retry.json())["rating"] == 5

    with Session(bind=seeded_api_engine) as session:
        save_event = session.get(PreferenceEvent, save_action_id)
        unsave_event = session.get(PreferenceEvent, unsave_action_id)
        rating_two_event = session.get(PreferenceEvent, rating_two_action_id)
        rating_five_event = session.get(PreferenceEvent, rating_five_action_id)
        assert save_event is not None
        assert save_event.event_type == "save"
        assert save_event.saved_value is True
        assert unsave_event is not None
        assert unsave_event.event_type == "save"
        assert unsave_event.saved_value is False
        assert rating_two_event is not None
        assert rating_two_event.event_type == "rating"
        assert rating_two_event.rating_value == 2
        assert rating_five_event is not None
        assert rating_five_event.event_type == "rating"
        assert rating_five_event.rating_value == 5
        rating = session.get(
            RecipeRating,
            {"user_id": DEMO_USER_ID, "recipe_version_id": CARROT_ROOT_ID},
        )
        assert rating is not None
        assert rating.rating == 5
        assert (
            session.get(
                RecipeSave,
                {"user_id": DEMO_USER_ID, "recipe_version_id": CARROT_ROOT_ID},
            )
            is None
        )
    assert _event_count(seeded_api_engine) == 4


def test_fork_action_replay_returns_the_original_child_and_conflicts_on_payload_change(
    preference_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    action_id = uuid4()
    payload = _fork_payload()
    first = preference_client.post(
        f"/api/recipes/{CARROT_ROOT_ID}/variants",
        headers=_action_headers(action_id),
        json=payload,
    )
    equivalent_retry_payload = {**payload, "servings": "8.0"}
    replay = preference_client.post(
        f"/api/recipes/{CARROT_ROOT_ID}/variants",
        headers=_action_headers(action_id),
        json=equivalent_retry_payload,
    )

    assert first.status_code == 201
    assert replay.status_code == 201
    first_child_id = UUID(_json_object(first.json())["id"])
    assert _json_object(replay.json())["id"] == str(first_child_id)
    assert first.headers["location"] == replay.headers["location"]
    assert _demo_fork_count(seeded_api_engine) == 1
    assert _event_count(seeded_api_engine) == 1

    with Session(bind=seeded_api_engine) as session:
        event = session.get(PreferenceEvent, action_id)
        assert event is not None
        assert event.user_id == DEMO_USER_ID
        assert event.recipe_version_id == CARROT_ROOT_ID
        assert event.event_type == "fork"
        assert event.related_recipe_version_id == first_child_id
        assert event.request_fingerprint is not None
        assert len(event.request_fingerprint) == 64
        assert event.request_fingerprint == event.request_fingerprint.casefold()

    conflict = preference_client.post(
        f"/api/recipes/{CARROT_ROOT_ID}/variants",
        headers=_action_headers(action_id),
        json=_fork_payload(title="Changed after the first action"),
    )
    assert conflict.status_code == 409
    assert _json_object(conflict.json())["error"]["code"] == "idempotency_key_conflict"
    assert _demo_fork_count(seeded_api_engine) == 1
    assert _event_count(seeded_api_engine) == 1


def test_concurrent_fork_retries_create_one_child_and_one_event(
    seeded_api_engine: Engine,
) -> None:
    start = Barrier(2)
    action_id = uuid4()
    payload = _fork_payload(title="Concurrent Preference Event Cake")

    def submit() -> tuple[int, str, str]:
        application = create_app()

        def override_session() -> Iterator[Session]:
            with Session(bind=seeded_api_engine) as session:
                yield session

        application.dependency_overrides[get_session] = override_session
        with TestClient(application) as client:
            start.wait(timeout=10)
            response = client.post(
                f"/api/recipes/{CARROT_ROOT_ID}/variants",
                headers=_action_headers(action_id),
                json=payload,
            )
            return (
                response.status_code,
                _json_object(response.json())["id"],
                response.headers["location"],
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(submit) for _ in range(2)]
        results = [future.result(timeout=30) for future in futures]

    assert {result[0] for result in results} == {201}
    assert len({result[1] for result in results}) == 1
    assert len({result[2] for result in results}) == 1
    assert _demo_fork_count(seeded_api_engine) == 1
    assert _event_count(seeded_api_engine) == 1


def test_event_failure_rolls_back_current_state_and_immutable_fork(
    monkeypatch: pytest.MonkeyPatch,
    preference_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    def fail_event(*_args: object, **_kwargs: object) -> PreferenceEvent:
        raise RuntimeError("Injected preference-event write failure.")

    monkeypatch.setattr(interaction_routes, "record_preference_event", fail_event)
    with pytest.raises(RuntimeError, match="Injected preference-event write failure"):
        preference_client.put(
            f"/api/recipes/{CARROT_ROOT_ID}/save",
            headers=_action_headers(),
        )

    with Session(bind=seeded_api_engine) as session:
        assert (
            session.get(
                RecipeSave,
                {"user_id": DEMO_USER_ID, "recipe_version_id": CARROT_ROOT_ID},
            )
            is None
        )
    assert _event_count(seeded_api_engine) == 0

    monkeypatch.setattr(recipe_routes, "record_preference_event", fail_event)
    with pytest.raises(RuntimeError, match="Injected preference-event write failure"):
        preference_client.post(
            f"/api/recipes/{CARROT_ROOT_ID}/variants",
            headers=_action_headers(),
            json=_fork_payload(),
        )

    assert _demo_fork_count(seeded_api_engine) == 0
    assert _event_count(seeded_api_engine) == 0


def test_missing_demo_identity_records_no_event(
    preference_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    with Session(bind=seeded_api_engine) as session, session.begin():
        session.execute(delete(User).where(User.id == DEMO_USER_ID))

    action_id = uuid4()
    try:
        response = preference_client.post(
            f"/api/recipes/{CARROT_ROOT_ID}/view",
            headers=_action_headers(action_id),
        )
        assert response.status_code == 503
        assert _event_count(seeded_api_engine) == 0
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


def test_cors_and_openapi_document_only_the_bounded_action_contract(
    preference_client: TestClient,
) -> None:
    preflight = preference_client.options(
        f"/api/recipes/{CARROT_ROOT_ID}/view",
        headers={
            "Origin": "http://127.0.0.1:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "idempotency-key",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == "http://127.0.0.1:3000"
    assert "idempotency-key" in preflight.headers["access-control-allow-headers"].casefold()

    document = _json_object(preference_client.get("/openapi.json").json())
    paths = cast(dict[str, Any], document["paths"])
    schemas = cast(dict[str, Any], cast(dict[str, Any], document["components"])["schemas"])
    action_operations = [
        paths["/api/recipes/{recipe_version_id}/view"]["post"],
        paths["/api/recipes/{recipe_version_id}/save"]["put"],
        paths["/api/recipes/{recipe_version_id}/save"]["delete"],
        paths["/api/recipes/{recipe_version_id}/rating"]["put"],
        paths["/api/recipes/{recipe_version_id}/variants"]["post"],
    ]
    for operation in action_operations:
        idempotency_parameter = next(
            parameter
            for parameter in operation["parameters"]
            if parameter["name"] == "Idempotency-Key"
        )
        assert idempotency_parameter["in"] == "header"
        assert idempotency_parameter["required"] is True
        assert idempotency_parameter["schema"]["format"] == "uuid"
        assert operation["responses"]["409"]["content"]["application/json"]["schema"][
            "$ref"
        ].endswith("/ErrorResponse")

    assert paths["/api/recipes/{recipe_version_id}/view"]["post"]["responses"]["204"]["description"]
    assert not any("preference" in path.casefold() for path in paths)
    assert not any("PreferenceEvent" in schema_name for schema_name in schemas)
    serialized = json.dumps(document)
    for private_field in (
        "event_type",
        "saved_value",
        "rating_value",
        "related_recipe_version_id",
        "request_fingerprint",
    ):
        assert f'"{private_field}"' not in serialized
