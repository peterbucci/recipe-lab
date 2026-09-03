import json
from collections.abc import Iterator
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, delete, func, or_, select
from sqlalchemy.orm import Session

import app.api.routes.interactions as interaction_routes
from app.models import (
    PreferenceEvent,
    RecipeIngredient,
    RecipeInstruction,
    RecipeInstructionAction,
    RecipeInstructionActionInput,
    RecipeInstructionActionMeasure,
    RecipeRating,
    RecipeSave,
    RecipeVersion,
    User,
)
from app.seeds.identifiers import seed_uuid
from tests.application import application_with_database
from tests.member_session import (
    MemberCredentials,
    authenticate_client,
    create_member_credentials,
)

DATASET_ID = "recipe-lab-demo-v1"
CARROT_ROOT_ID = seed_uuid(
    DATASET_ID,
    "recipe-version",
    "carrot-walnut-snack-cake-v1",
)
MEMBER_USER_ID = UUID("77000000-0000-4000-8000-000000000003")


def _action_headers(action_id: UUID | None = None) -> dict[str, str]:
    return {"Idempotency-Key": str(action_id or uuid4())}


def _clear_member_activity(engine: Engine) -> None:
    with Session(bind=engine) as session, session.begin():
        fork_ids = list(
            session.scalars(
                select(RecipeVersion.id).where(RecipeVersion.created_by_user_id == MEMBER_USER_ID)
            )
        )
        event_filter = PreferenceEvent.user_id == MEMBER_USER_ID
        if fork_ids:
            event_filter = or_(
                event_filter,
                PreferenceEvent.recipe_version_id.in_(fork_ids),
                PreferenceEvent.related_recipe_version_id.in_(fork_ids),
            )
        session.execute(delete(PreferenceEvent).where(event_filter))
        session.execute(delete(RecipeRating).where(RecipeRating.user_id == MEMBER_USER_ID))
        session.execute(delete(RecipeSave).where(RecipeSave.user_id == MEMBER_USER_ID))
        if fork_ids:
            action_ids = select(RecipeInstructionAction.id).where(
                RecipeInstructionAction.recipe_version_id.in_(fork_ids)
            )
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
            session.execute(delete(RecipeVersion).where(RecipeVersion.id.in_(fork_ids)))


@pytest.fixture(autouse=True)
def clean_member_activity(seeded_api_engine: Engine) -> Iterator[None]:
    _clear_member_activity(seeded_api_engine)
    try:
        yield
    finally:
        _clear_member_activity(seeded_api_engine)


@pytest.fixture(autouse=True)
def test_member_credentials(
    seeded_api_engine: Engine,
    clean_member_activity: None,
) -> Iterator[MemberCredentials]:
    credentials = create_member_credentials(seeded_api_engine, user_id=MEMBER_USER_ID)
    try:
        yield credentials
    finally:
        _clear_member_activity(seeded_api_engine)
        with Session(bind=seeded_api_engine) as session, session.begin():
            session.execute(delete(User).where(User.id == MEMBER_USER_ID))


@pytest.fixture
def preference_client(
    seeded_api_engine: Engine,
    test_member_credentials: MemberCredentials,
) -> Iterator[TestClient]:
    with application_with_database(seeded_api_engine) as application:
        with TestClient(application) as client:
            authenticate_client(client, test_member_credentials)
            yield client


def _json_object(value: object) -> dict[str, Any]:
    return cast(dict[str, Any], value)


def _event_count(engine: Engine) -> int:
    with Session(bind=engine) as session:
        return session.scalar(select(func.count()).select_from(PreferenceEvent)) or 0


def _event_by_action(
    session: Session,
    action_id: UUID,
    *,
    event_type: str | None = None,
) -> PreferenceEvent | None:
    statement = select(PreferenceEvent).where(
        PreferenceEvent.user_id == MEMBER_USER_ID,
        PreferenceEvent.action_id == action_id,
    )
    if event_type is not None:
        statement = statement.where(PreferenceEvent.event_type == event_type)
    return session.scalar(statement)


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
        event = _event_by_action(session, action_id, event_type="view")
        assert event is not None
        assert event.user_id == MEMBER_USER_ID
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
        event = _event_by_action(session, action_id, event_type="view")
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
    conflict_correlation_id = conflict.headers["X-Correlation-ID"]
    assert conflict.json() == {
        "error": {
            "code": "idempotency_key_conflict",
            "message": "The Idempotency-Key conflicts with an earlier action in this operation.",
            "issues": [],
            "correlation_id": conflict_correlation_id,
        }
    }
    assert missing_recipe_conflict.status_code == 409
    assert (
        _json_object(missing_recipe_conflict.json())["error"]["code"] == "idempotency_key_conflict"
    )
    with Session(bind=seeded_api_engine) as session:
        assert _event_by_action(session, action_id, event_type="save") is not None
        assert (
            session.get(
                RecipeSave,
                {"user_id": MEMBER_USER_ID, "recipe_version_id": CARROT_ROOT_ID},
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
        save_event = _event_by_action(session, save_action_id, event_type="save")
        unsave_event = _event_by_action(session, unsave_action_id, event_type="save")
        rating_two_event = _event_by_action(session, rating_two_action_id, event_type="rating")
        rating_five_event = _event_by_action(session, rating_five_action_id, event_type="rating")
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
            {"user_id": MEMBER_USER_ID, "recipe_version_id": CARROT_ROOT_ID},
        )
        assert rating is not None
        assert rating.rating == 5
        assert (
            session.get(
                RecipeSave,
                {"user_id": MEMBER_USER_ID, "recipe_version_id": CARROT_ROOT_ID},
            )
            is None
        )
    assert _event_count(seeded_api_engine) == 4


def test_event_failure_rolls_back_current_interaction_state(
    monkeypatch: pytest.MonkeyPatch,
    preference_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    def fail_event(*_args: object, **_kwargs: object) -> PreferenceEvent:
        raise RuntimeError("Injected preference-event write failure.")

    monkeypatch.setattr(interaction_routes, "record_preference_event", fail_event)
    failed = preference_client.put(
        f"/api/recipes/{CARROT_ROOT_ID}/save",
        headers=_action_headers(),
    )
    assert failed.status_code == 500
    assert _json_object(_json_object(failed.json())["error"])["code"] == "internal_error"

    with Session(bind=seeded_api_engine) as session:
        assert (
            session.get(
                RecipeSave,
                {"user_id": MEMBER_USER_ID, "recipe_version_id": CARROT_ROOT_ID},
            )
            is None
        )
    assert _event_count(seeded_api_engine) == 0


def test_missing_session_member_records_no_event(
    preference_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    with Session(bind=seeded_api_engine) as session, session.begin():
        session.execute(delete(User).where(User.id == MEMBER_USER_ID))

    action_id = uuid4()
    response = preference_client.post(
        f"/api/recipes/{CARROT_ROOT_ID}/view",
        headers=_action_headers(action_id),
    )
    assert response.status_code == 401
    assert _event_count(seeded_api_engine) == 0


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
