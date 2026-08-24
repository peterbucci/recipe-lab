from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, delete, func, select
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.main import create_app
from app.models import PreferenceEvent, RecipeRating, RecipeSave, RecipeVersion, User
from app.seeds.identifiers import seed_uuid
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
PASTA_ROOT_ID = seed_uuid(
    DATASET_ID,
    "recipe-version",
    "tomato-basil-spaghetti-v1",
)
MEMBER_A_ID = UUID("78000000-0000-4000-8000-000000000001")
MEMBER_B_ID = UUID("78000000-0000-4000-8000-000000000002")
INCOMPLETE_MEMBER_ID = UUID("78000000-0000-4000-8000-000000000003")
MEMBER_IDS = (MEMBER_A_ID, MEMBER_B_ID, INCOMPLETE_MEMBER_ID)


@dataclass(frozen=True, slots=True)
class MemberActivityApi:
    anonymous: TestClient
    member_a: TestClient
    member_b: TestClient
    incomplete: TestClient
    member_a_credentials: MemberCredentials
    member_b_credentials: MemberCredentials
    engine: Engine


def _clear_members(engine: Engine) -> None:
    with Session(bind=engine) as session, session.begin():
        session.execute(delete(PreferenceEvent).where(PreferenceEvent.user_id.in_(MEMBER_IDS)))
        session.execute(delete(RecipeRating).where(RecipeRating.user_id.in_(MEMBER_IDS)))
        session.execute(delete(RecipeSave).where(RecipeSave.user_id.in_(MEMBER_IDS)))
        session.execute(delete(User).where(User.id.in_(MEMBER_IDS)))


@pytest.fixture
def member_activity_api(seeded_api_engine: Engine) -> Iterator[MemberActivityApi]:
    _clear_members(seeded_api_engine)
    member_a = create_member_credentials(
        seeded_api_engine,
        user_id=MEMBER_A_ID,
        handle="member_alpha",
        display_name="Member Alpha",
    )
    member_b = create_member_credentials(
        seeded_api_engine,
        user_id=MEMBER_B_ID,
        handle="member_bravo",
        display_name="Member Bravo",
    )
    incomplete = create_member_credentials(
        seeded_api_engine,
        user_id=INCOMPLETE_MEMBER_ID,
        handle=None,
        display_name="Incomplete Member",
    )
    application = create_app()

    def override_session() -> Iterator[Session]:
        with Session(bind=seeded_api_engine) as session:
            yield session

    application.dependency_overrides[get_session] = override_session
    try:
        with (
            TestClient(application) as anonymous_client,
            TestClient(application) as member_a_client,
            TestClient(application) as member_b_client,
            TestClient(application) as incomplete_client,
        ):
            authenticate_client(member_a_client, member_a)
            authenticate_client(member_b_client, member_b)
            authenticate_client(incomplete_client, incomplete)
            yield MemberActivityApi(
                anonymous=anonymous_client,
                member_a=member_a_client,
                member_b=member_b_client,
                incomplete=incomplete_client,
                member_a_credentials=member_a,
                member_b_credentials=member_b,
                engine=seeded_api_engine,
            )
    finally:
        application.dependency_overrides.clear()
        _clear_members(seeded_api_engine)


def _headers(action_id: UUID | None = None) -> dict[str, str]:
    return {"Idempotency-Key": str(action_id or uuid4())}


def _json_object(value: object) -> dict[str, Any]:
    return cast(dict[str, Any], value)


def _activity_counts(engine: Engine) -> tuple[int, int, int, int]:
    with Session(bind=engine) as session:
        return cast(
            tuple[int, int, int, int],
            tuple(
                session.scalar(select(func.count()).select_from(model)) or 0
                for model in (PreferenceEvent, RecipeSave, RecipeRating, RecipeVersion)
            ),
        )


def _fork_payload() -> dict[str, object]:
    return {
        "title": "Member fork",
        "description": "A member-owned variant.",
        "servings": "8.00",
        "ingredient_edits": [],
        "instruction_edits": [],
    }


def test_anonymous_reads_are_public_but_every_mutation_is_rejected_without_rows(
    member_activity_api: MemberActivityApi,
) -> None:
    before = _activity_counts(member_activity_api.engine)

    browse = member_activity_api.anonymous.get("/api/recipes")
    detail = member_activity_api.anonymous.get(f"/api/recipes/{CARROT_ROOT_ID}")
    comparison = member_activity_api.anonymous.get(
        f"/api/recipes/{CARROT_ROOT_ID}/diff",
        params={"base_version_id": str(CARROT_ROOT_ID)},
    )
    recommendations = member_activity_api.anonymous.get("/api/recommendations")
    repeated_recommendations = member_activity_api.anonymous.get("/api/recommendations")

    assert browse.status_code == 200
    assert detail.status_code == 200
    assert _json_object(detail.json())["viewer_state"] is None
    assert comparison.status_code == 200
    assert recommendations.status_code == 200
    assert recommendations.content == repeated_recommendations.content
    assert _json_object(recommendations.json())["personalized"] is False
    assert recommendations.headers["cache-control"] == "private, no-store"
    assert "Cookie" in recommendations.headers["vary"]

    mutations = [
        member_activity_api.anonymous.post(
            f"/api/recipes/{CARROT_ROOT_ID}/view",
            headers=_headers(),
        ),
        member_activity_api.anonymous.put(
            f"/api/recipes/{CARROT_ROOT_ID}/save",
            headers=_headers(),
        ),
        member_activity_api.anonymous.delete(
            f"/api/recipes/{CARROT_ROOT_ID}/save",
            headers=_headers(),
        ),
        member_activity_api.anonymous.put(
            f"/api/recipes/{CARROT_ROOT_ID}/rating",
            headers=_headers(),
            json={"rating": 5},
        ),
        member_activity_api.anonymous.post(
            f"/api/recipes/{CARROT_ROOT_ID}/variants",
            headers=_headers(),
            json=_fork_payload(),
        ),
    ]
    assert {response.status_code for response in mutations} == {401}
    assert _activity_counts(member_activity_api.engine) == before


def test_member_scoped_state_and_idempotency_are_isolated_by_member_and_operation(
    member_activity_api: MemberActivityApi,
) -> None:
    shared_action_id = uuid4()
    first_save = member_activity_api.member_a.put(
        f"/api/recipes/{CARROT_ROOT_ID}/save",
        headers=_headers(shared_action_id),
    )
    second_member_save = member_activity_api.member_b.put(
        f"/api/recipes/{CARROT_ROOT_ID}/save",
        headers=_headers(shared_action_id),
    )
    cross_operation_rating = member_activity_api.member_a.put(
        f"/api/recipes/{CARROT_ROOT_ID}/rating",
        headers=_headers(shared_action_id),
        json={"rating": 5},
    )
    exact_retry = member_activity_api.member_a.put(
        f"/api/recipes/{CARROT_ROOT_ID}/rating",
        headers=_headers(shared_action_id),
        json={"rating": 5},
    )
    semantic_conflict = member_activity_api.member_a.delete(
        f"/api/recipes/{CARROT_ROOT_ID}/save",
        headers=_headers(shared_action_id),
    )

    assert first_save.status_code == 200
    assert second_member_save.status_code == 200
    assert cross_operation_rating.status_code == 200
    assert exact_retry.status_code == 200
    assert semantic_conflict.status_code == 409

    member_b_before_rating = _json_object(
        member_activity_api.member_b.get(f"/api/recipes/{CARROT_ROOT_ID}").json()
    )["viewer_state"]
    assert member_b_before_rating == {
        "recipe_version_id": str(CARROT_ROOT_ID),
        "saved": True,
        "rating": None,
    }
    member_b_rating = member_activity_api.member_b.put(
        f"/api/recipes/{CARROT_ROOT_ID}/rating",
        headers=_headers(),
        json={"rating": 2},
    )
    assert member_b_rating.status_code == 200

    member_a_state = _json_object(
        member_activity_api.member_a.get(f"/api/recipes/{CARROT_ROOT_ID}").json()
    )["viewer_state"]
    member_b_state = _json_object(
        member_activity_api.member_b.get(f"/api/recipes/{CARROT_ROOT_ID}").json()
    )["viewer_state"]
    assert member_a_state["rating"] == 5
    assert member_b_state["rating"] == 2

    with Session(bind=member_activity_api.engine) as session:
        events = list(
            session.scalars(
                select(PreferenceEvent).where(PreferenceEvent.action_id == shared_action_id)
            )
        )
        assert {(event.user_id, event.event_type) for event in events} == {
            (MEMBER_A_ID, "save"),
            (MEMBER_B_ID, "save"),
            (MEMBER_A_ID, "rating"),
        }
        assert all(event.id != event.action_id for event in events)


def test_each_signed_in_recommendation_profile_uses_only_that_members_history(
    member_activity_api: MemberActivityApi,
) -> None:
    assert (
        member_activity_api.member_a.put(
            f"/api/recipes/{CARROT_ROOT_ID}/save",
            headers=_headers(),
        ).status_code
        == 200
    )
    assert (
        member_activity_api.member_b.put(
            f"/api/recipes/{PASTA_ROOT_ID}/save",
            headers=_headers(),
        ).status_code
        == 200
    )

    member_a = _json_object(
        member_activity_api.member_a.get("/api/recommendations", params={"limit": 50}).json()
    )
    member_b = _json_object(
        member_activity_api.member_b.get("/api/recommendations", params={"limit": 50}).json()
    )
    member_a_ids = {item["recipe"]["id"] for item in member_a["items"]}
    member_b_ids = {item["recipe"]["id"] for item in member_b["items"]}

    assert member_a["personalized"] is True
    assert member_b["personalized"] is True
    assert str(CARROT_ROOT_ID) not in member_a_ids
    assert str(PASTA_ROOT_ID) in member_a_ids
    assert str(PASTA_ROOT_ID) not in member_b_ids
    assert str(CARROT_ROOT_ID) in member_b_ids


def test_actor_spoof_payloads_and_incomplete_accounts_cannot_mutate(
    member_activity_api: MemberActivityApi,
) -> None:
    before = _activity_counts(member_activity_api.engine)
    spoofed_mutations = [
        member_activity_api.member_a.post(
            f"/api/recipes/{CARROT_ROOT_ID}/view",
            headers=_headers(),
            json={"user_id": str(MEMBER_B_ID)},
        ),
        member_activity_api.member_a.put(
            f"/api/recipes/{CARROT_ROOT_ID}/save",
            headers=_headers(),
            json={"author_user_id": str(MEMBER_B_ID)},
        ),
        member_activity_api.member_a.request(
            "DELETE",
            f"/api/recipes/{CARROT_ROOT_ID}/save",
            headers=_headers(),
            json={"user_id": str(MEMBER_B_ID)},
        ),
        member_activity_api.member_a.put(
            f"/api/recipes/{CARROT_ROOT_ID}/rating",
            headers=_headers(),
            json={"rating": 5, "user_id": str(MEMBER_B_ID)},
        ),
        member_activity_api.member_a.post(
            f"/api/recipes/{CARROT_ROOT_ID}/variants",
            headers=_headers(),
            json={**_fork_payload(), "created_by_user_id": str(MEMBER_B_ID)},
        ),
    ]
    assert {response.status_code for response in spoofed_mutations} == {422}

    incomplete_view = member_activity_api.incomplete.post(
        f"/api/recipes/{CARROT_ROOT_ID}/view",
        headers=_headers(),
    )
    incomplete_fork = member_activity_api.incomplete.post(
        f"/api/recipes/{CARROT_ROOT_ID}/variants",
        headers=_headers(),
        json=_fork_payload(),
    )
    assert incomplete_view.status_code == 403
    assert incomplete_fork.status_code == 403
    assert _json_object(incomplete_view.json())["error"]["code"] == "account_setup_required"
    assert _json_object(incomplete_fork.json())["error"]["code"] == "account_setup_required"
    assert _activity_counts(member_activity_api.engine) == before
