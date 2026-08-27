from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.main import create_app
from app.models import RecipeDraft
from app.seeds import load_bundled_catalog, seed_catalog
from app.seeds.identifiers import action_uuid, measurement_uuid, seed_uuid
from tests.conftest import make_alembic_config
from tests.member_session import authenticate_client, create_member_credentials

DATASET_ID = "recipe-lab-demo-v1"
CARROT_ROOT_ID = seed_uuid(
    DATASET_ID,
    "recipe-version",
    "carrot-walnut-snack-cake-v1",
)
CHICKPEA_ID = seed_uuid(DATASET_ID, "ingredient", "chickpea")
GRAM_ID = measurement_uuid("unit", "g")
MIX_ID = action_uuid("action-type", "mix")
MEMBER_ID = UUID("7b000000-0000-4000-8000-000000000001")
OTHER_MEMBER_ID = UUID("7b000000-0000-4000-8000-000000000002")


@dataclass(frozen=True, slots=True)
class DraftApi:
    engine: Engine
    anonymous: TestClient
    member: TestClient
    other_member: TestClient


@pytest.fixture
def draft_api(empty_postgres_engine: Engine) -> Iterator[DraftApi]:
    config = make_alembic_config()
    with empty_postgres_engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
    with Session(bind=empty_postgres_engine) as session, session.begin():
        seed_catalog(session, load_bundled_catalog())

    member_credentials = create_member_credentials(
        empty_postgres_engine,
        user_id=MEMBER_ID,
        handle="draft_member",
        display_name="Draft Member",
    )
    other_credentials = create_member_credentials(
        empty_postgres_engine,
        user_id=OTHER_MEMBER_ID,
        handle="other_draft_member",
        display_name="Other Draft Member",
    )
    application = create_app()

    def override_session() -> Iterator[Session]:
        with Session(bind=empty_postgres_engine, expire_on_commit=False) as session:
            yield session

    application.dependency_overrides[get_session] = override_session
    try:
        with (
            TestClient(application) as anonymous,
            TestClient(application) as member,
            TestClient(application) as other_member,
        ):
            authenticate_client(member, member_credentials)
            authenticate_client(other_member, other_credentials)
            yield DraftApi(
                engine=empty_postgres_engine,
                anonymous=anonymous,
                member=member,
                other_member=other_member,
            )
    finally:
        application.dependency_overrides.clear()


def _json_object(value: object) -> dict[str, Any]:
    return cast(dict[str, Any], value)


def _blank_update(*, revision: int, title: str) -> dict[str, object]:
    return {
        "revision": revision,
        "title": title,
        "description": None,
        "servings": None,
        "ingredients": [],
        "instructions": [],
    }


def test_owner_scoped_revisioned_crud_and_immediate_discard(draft_api: DraftApi) -> None:
    assert (
        draft_api.anonymous.post(
            "/api/recipe-drafts",
            json={"source_version_id": None},
        ).status_code
        == 401
    )

    created = draft_api.member.post(
        "/api/recipe-drafts",
        json={"source_version_id": None},
    )
    assert created.status_code == 201
    assert created.headers["cache-control"] == "private, no-store"
    assert "Cookie" in created.headers["vary"]
    body = _json_object(created.json())
    draft_id = body["id"]
    assert body == {
        **body,
        "source_version_id": None,
        "status": "active",
        "revision": 1,
        "title": "",
        "description": None,
        "servings": None,
        "ingredients": [],
        "instructions": [],
    }
    assert created.headers["location"] == f"/api/recipe-drafts/{draft_id}"
    owner_detail = draft_api.member.get(created.headers["location"])
    assert owner_detail.status_code == 200
    assert owner_detail.json() == body
    assert draft_api.other_member.get(created.headers["location"]).status_code == 404

    malicious_create = draft_api.member.post(
        "/api/recipe-drafts",
        json={
            "source_version_id": None,
            "author_user_id": str(OTHER_MEMBER_ID),
            "owner_user_id": str(OTHER_MEMBER_ID),
        },
    )
    assert malicious_create.status_code == 422

    malicious_update = draft_api.member.put(
        f"/api/recipe-drafts/{draft_id}",
        json={
            **_blank_update(revision=1, title="Attempted owner reassignment"),
            "author_user_id": str(OTHER_MEMBER_ID),
            "owner_user_id": str(OTHER_MEMBER_ID),
        },
    )
    assert malicious_update.status_code == 422
    unchanged = _json_object(draft_api.member.get(f"/api/recipe-drafts/{draft_id}").json())
    assert unchanged["revision"] == 1
    assert unchanged["title"] == ""

    assert draft_api.other_member.get(f"/api/recipe-drafts/{draft_id}").status_code == 404
    assert (
        draft_api.other_member.put(
            f"/api/recipe-drafts/{draft_id}",
            json=_blank_update(revision=1, title="Cross-owner overwrite"),
        ).status_code
        == 404
    )
    assert (
        draft_api.other_member.delete(
            f"/api/recipe-drafts/{draft_id}",
            params={"revision": 1},
        ).status_code
        == 404
    )
    other_list = draft_api.other_member.get("/api/recipe-drafts")
    assert other_list.status_code == 200
    assert _json_object(other_list.json())["items"] == []

    saved = draft_api.member.put(
        f"/api/recipe-drafts/{draft_id}",
        json=_blank_update(revision=1, title="Private work in progress"),
    )
    assert saved.status_code == 200
    assert _json_object(saved.json())["revision"] == 2

    stale = draft_api.member.put(
        f"/api/recipe-drafts/{draft_id}",
        json=_blank_update(revision=1, title="Stale overwrite"),
    )
    assert stale.status_code == 409
    assert _json_object(_json_object(stale.json())["error"])["code"] == (
        "recipe_draft_revision_conflict"
    )
    current = draft_api.member.get(f"/api/recipe-drafts/{draft_id}")
    assert _json_object(current.json())["title"] == "Private work in progress"

    assert (
        draft_api.member.delete(
            f"/api/recipe-drafts/{draft_id}",
            params={"revision": 1},
        ).status_code
        == 409
    )
    discarded = draft_api.member.delete(
        f"/api/recipe-drafts/{draft_id}",
        params={"revision": 2},
    )
    assert discarded.status_code == 204
    assert discarded.headers["cache-control"] == "private, no-store"
    assert draft_api.member.get(f"/api/recipe-drafts/{draft_id}").status_code == 404
    with Session(bind=draft_api.engine) as session:
        assert session.scalar(select(RecipeDraft).where(RecipeDraft.id == draft_id)) is None


def test_exact_source_clone_and_curated_full_replacement(draft_api: DraftApi) -> None:
    created = draft_api.member.post(
        "/api/recipe-drafts",
        json={"source_version_id": str(CARROT_ROOT_ID)},
    )
    assert created.status_code == 201
    body = _json_object(created.json())
    assert body["source_version_id"] == str(CARROT_ROOT_ID)
    assert len(cast(list[object], body["ingredients"])) == 9
    assert len(cast(list[object], body["instructions"])) == 4
    assert all(_json_object(item)["selection"] for item in cast(list[object], body["ingredients"]))

    draft_id = body["id"]
    payload = {
        "revision": 1,
        "title": "Structured private chickpea draft",
        "description": "Saved without publishing.",
        "servings": "2.00",
        "ingredients": [
            {
                "ref": "chickpea-slot",
                "selection": {
                    "kind": "catalog",
                    "ingredient_id": str(CHICKPEA_ID),
                    "display_name": "Chickpea",
                },
                "measure": {
                    "kind": "exact",
                    "value": "100.0000",
                    "unit_id": str(GRAM_ID),
                },
                "preparation_notes": "drained",
            }
        ],
        "instructions": [
            {
                "ref": "mix-step",
                "text": "Mix the chickpeas.",
                "actions": [
                    {
                        "action_type_id": str(MIX_ID),
                        "ingredient_refs": ["chickpea-slot"],
                        "duration": None,
                        "temperature": None,
                    }
                ],
            }
        ],
    }
    saved = draft_api.member.put(f"/api/recipe-drafts/{draft_id}", json=payload)
    assert saved.status_code == 200
    detail = _json_object(saved.json())
    assert detail["revision"] == 2
    ingredient = _json_object(cast(list[object], detail["ingredients"])[0])
    assert _json_object(ingredient["selection"])["kind"] == "catalog"
    action = _json_object(
        cast(list[object], _json_object(cast(list[object], detail["instructions"])[0])["actions"])[
            0
        ]
    )
    assert action["ingredient_occurrence_ids"] == [ingredient["id"]]


def test_unresolved_requests_remain_separate_and_owner_scoped(draft_api: DraftApi) -> None:
    own_request = draft_api.member.post(
        "/api/ingredient-requests",
        json={"proposed_name": f"Draft herb {uuid4().hex[:8]}", "context": None},
    )
    other_request = draft_api.other_member.post(
        "/api/ingredient-requests",
        json={"proposed_name": f"Other herb {uuid4().hex[:8]}", "context": None},
    )
    assert own_request.status_code == other_request.status_code == 201
    own_request_id = _json_object(own_request.json())["id"]
    other_request_id = _json_object(other_request.json())["id"]

    created = draft_api.member.post(
        "/api/recipe-drafts",
        json={"source_version_id": None},
    )
    draft_id = _json_object(created.json())["id"]
    unresolved_payload = {
        "revision": 1,
        "title": "Waiting for catalog review",
        "description": None,
        "servings": None,
        "ingredients": [
            {
                "ref": "request-slot",
                "selection": {
                    "kind": "request",
                    "ingredient_request_id": own_request_id,
                },
                "measure": {"kind": "qualitative", "value": "unspecified"},
                "preparation_notes": "keep this note",
            }
        ],
        "instructions": [],
    }
    saved = draft_api.member.put(f"/api/recipe-drafts/{draft_id}", json=unresolved_payload)
    assert saved.status_code == 200
    selection = _json_object(
        _json_object(cast(list[object], _json_object(saved.json())["ingredients"])[0])["selection"]
    )
    assert selection["kind"] == "request"
    assert _json_object(selection["request"])["status"] == "pending"
    assert _json_object(selection["request"])["resolved_ingredient"] is None

    cross_owner_payload = {
        **unresolved_payload,
        "revision": 2,
        "ingredients": [
            {
                **cast(list[dict[str, object]], unresolved_payload["ingredients"])[0],
                "selection": {
                    "kind": "request",
                    "ingredient_request_id": other_request_id,
                },
            }
        ],
    }
    cross_owner = draft_api.member.put(
        f"/api/recipe-drafts/{draft_id}",
        json=cross_owner_payload,
    )
    assert cross_owner.status_code == 422

    action_payload = {
        **unresolved_payload,
        "revision": 2,
        "instructions": [
            {
                "ref": "step",
                "text": "Mix the unresolved ingredient.",
                "actions": [
                    {
                        "action_type_id": str(MIX_ID),
                        "ingredient_refs": ["request-slot"],
                        "duration": None,
                        "temperature": None,
                    }
                ],
            }
        ],
    }
    unresolved_action = draft_api.member.put(
        f"/api/recipe-drafts/{draft_id}",
        json=action_payload,
    )
    assert unresolved_action.status_code == 422
    current = _json_object(draft_api.member.get(f"/api/recipe-drafts/{draft_id}").json())
    assert current["revision"] == 2
    assert current["instructions"] == []


def test_unknown_curated_identities_are_rejected_without_mutation(
    draft_api: DraftApi,
) -> None:
    created = draft_api.member.post(
        "/api/recipe-drafts",
        json={"source_version_id": None},
    )
    assert created.status_code == 201
    draft_id = _json_object(created.json())["id"]

    valid_ingredient = {
        "ref": "ingredient-slot",
        "selection": {
            "kind": "catalog",
            "ingredient_id": str(CHICKPEA_ID),
            "display_name": "Chickpea",
        },
        "measure": {"kind": "qualitative", "value": "unspecified"},
        "preparation_notes": None,
    }
    invalid_payloads = [
        {
            **_blank_update(revision=1, title="Unknown ingredient"),
            "ingredients": [
                {
                    **valid_ingredient,
                    "selection": {
                        "kind": "catalog",
                        "ingredient_id": str(uuid4()),
                        "display_name": "Unknown ingredient",
                    },
                }
            ],
        },
        {
            **_blank_update(revision=1, title="Unknown unit"),
            "ingredients": [
                {
                    **valid_ingredient,
                    "measure": {
                        "kind": "exact",
                        "value": "1.0000",
                        "unit_id": str(uuid4()),
                    },
                }
            ],
        },
        {
            **_blank_update(revision=1, title="Unknown action"),
            "ingredients": [valid_ingredient],
            "instructions": [
                {
                    "ref": "instruction",
                    "text": "Use an unknown action.",
                    "actions": [
                        {
                            "action_type_id": str(uuid4()),
                            "ingredient_refs": ["ingredient-slot"],
                            "duration": None,
                            "temperature": None,
                        }
                    ],
                }
            ],
        },
    ]

    for payload in invalid_payloads:
        rejected = draft_api.member.put(
            f"/api/recipe-drafts/{draft_id}",
            json=payload,
        )
        assert rejected.status_code == 422
        assert _json_object(_json_object(rejected.json())["error"])["code"] == (
            "invalid_recipe_draft"
        )

    unchanged = _json_object(draft_api.member.get(f"/api/recipe-drafts/{draft_id}").json())
    assert unchanged["revision"] == 1
    assert unchanged["title"] == ""
    assert unchanged["ingredients"] == []
    assert unchanged["instructions"] == []
