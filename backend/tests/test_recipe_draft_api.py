from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from threading import Barrier
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.main import create_app
from app.models import (
    IngredientPackageSize,
    MeasurementUnit,
    RecipeCategory,
    RecipeDraft,
    RecipeIngredient,
    RecipeLineage,
    RecipeVersion,
    RecipeVersionPublication,
)
from app.seeds import load_bundled_catalog, seed_catalog
from app.seeds.identifiers import action_uuid, measurement_uuid, seed_uuid
from app.services.recipe_drafts import (
    create_recipe_draft,
    recipe_draft_creation_request_fingerprint,
)
from tests.conftest import make_alembic_config
from tests.member_session import authenticate_client, create_member_credentials

DATASET_ID = "recipe-lab-demo-v1"
CARROT_ROOT_ID = seed_uuid(
    DATASET_ID,
    "recipe-version",
    "carrot-walnut-snack-cake-v1",
)
CHICKPEA_ID = seed_uuid(DATASET_ID, "ingredient", "chickpea")
WALNUT_ID = seed_uuid(DATASET_ID, "ingredient", "walnut")
GRAM_ID = measurement_uuid("unit", "g")
CAN_ID = measurement_uuid("unit", "can")
CELSIUS_ID = measurement_uuid("unit", "celsius")
MIX_ID = action_uuid("action-type", "mix")
MEMBER_ID = UUID("7b000000-0000-4000-8000-000000000001")
OTHER_MEMBER_ID = UUID("7b000000-0000-4000-8000-000000000002")
BREAKFAST_CATEGORY_ID = seed_uuid(DATASET_ID, "recipe-category", "breakfast")
DESSERTS_CATEGORY_ID = seed_uuid(DATASET_ID, "recipe-category", "desserts")
VEGETARIAN_CATEGORY_ID = seed_uuid(DATASET_ID, "recipe-category", "vegetarian")
QUICK_EASY_CATEGORY_ID = seed_uuid(DATASET_ID, "recipe-category", "quick-easy")


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


def _creation_headers(action_id: UUID | None = None) -> dict[str, str]:
    return {"Idempotency-Key": str(action_id or uuid4())}


def test_owner_scoped_revisioned_crud_and_immediate_discard(draft_api: DraftApi) -> None:
    assert (
        draft_api.anonymous.post(
            "/api/recipe-drafts",
            headers=_creation_headers(),
            json={"source_version_id": None},
        ).status_code
        == 401
    )

    creation_action_id = uuid4()
    created = draft_api.member.post(
        "/api/recipe-drafts",
        headers=_creation_headers(creation_action_id),
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
        headers=_creation_headers(),
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
    replay_after_discard = draft_api.member.post(
        "/api/recipe-drafts",
        headers=_creation_headers(creation_action_id),
        json={"source_version_id": None},
    )
    assert replay_after_discard.status_code == 409
    assert _json_object(_json_object(replay_after_discard.json())["error"])["code"] == (
        "idempotency_key_conflict"
    )
    with Session(bind=draft_api.engine) as session:
        shell = session.scalar(select(RecipeDraft).where(RecipeDraft.id == draft_id))
        assert shell is not None
        assert shell.status == "discarded"
        assert shell.creation_action_id == creation_action_id
        assert shell.title == ""
        assert shell.description is None
        assert shell.servings is None


def test_creation_requires_uuid_key_and_replays_one_actor_scoped_intent(
    draft_api: DraftApi,
) -> None:
    missing = draft_api.member.post(
        "/api/recipe-drafts",
        json={"source_version_id": None},
    )
    malformed = draft_api.member.post(
        "/api/recipe-drafts",
        headers={"Idempotency-Key": "not-a-uuid"},
        json={"source_version_id": None},
    )
    assert missing.status_code == malformed.status_code == 422
    assert recipe_draft_creation_request_fingerprint(None) != (
        recipe_draft_creation_request_fingerprint(CARROT_ROOT_ID)
    )

    action_id = uuid4()
    created = draft_api.member.post(
        "/api/recipe-drafts",
        headers=_creation_headers(action_id),
        json={"source_version_id": None},
    )
    replayed = draft_api.member.post(
        "/api/recipe-drafts",
        headers=_creation_headers(action_id),
        json={"source_version_id": None},
    )
    assert created.status_code == replayed.status_code == 201
    assert created.json() == replayed.json()

    changed_intent = draft_api.member.post(
        "/api/recipe-drafts",
        headers=_creation_headers(action_id),
        json={"source_version_id": str(CARROT_ROOT_ID)},
    )
    assert changed_intent.status_code == 409
    assert _json_object(_json_object(changed_intent.json())["error"])["code"] == (
        "idempotency_key_conflict"
    )

    other_actor = draft_api.other_member.post(
        "/api/recipe-drafts",
        headers=_creation_headers(action_id),
        json={"source_version_id": None},
    )
    assert other_actor.status_code == 201
    assert _json_object(other_actor.json())["id"] != _json_object(created.json())["id"]

    with Session(bind=draft_api.engine) as session:
        bound = list(
            session.scalars(select(RecipeDraft).where(RecipeDraft.creation_action_id == action_id))
        )
        assert len(bound) == 2
        assert {draft.author_user_id for draft in bound} == {MEMBER_ID, OTHER_MEMBER_ID}
        assert all(
            draft.creation_request_fingerprint is not None
            and len(draft.creation_request_fingerprint) == 64
            and draft.creation_request_fingerprint == draft.creation_request_fingerprint.casefold()
            for draft in bound
        )


def test_concurrent_identical_creation_retries_copy_one_source_draft(
    draft_api: DraftApi,
) -> None:
    action_id = uuid4()
    barrier = Barrier(3)

    def create() -> tuple[int, object]:
        barrier.wait()
        response = draft_api.member.post(
            "/api/recipe-drafts",
            headers=_creation_headers(action_id),
            json={"source_version_id": str(CARROT_ROOT_ID)},
        )
        return response.status_code, response.json()

    with ThreadPoolExecutor(max_workers=2) as executor:
        requests = [executor.submit(create) for _index in range(2)]
        barrier.wait()
        responses = [request.result(timeout=20) for request in requests]

    assert responses[0][0] == responses[1][0] == 201
    assert responses[0][1] == responses[1][1]
    assert len(cast(list[object], _json_object(responses[0][1])["ingredients"])) == 9
    with Session(bind=draft_api.engine) as session:
        count = session.scalar(
            select(func.count())
            .select_from(RecipeDraft)
            .where(
                RecipeDraft.author_user_id == MEMBER_ID,
                RecipeDraft.creation_action_id == action_id,
            )
        )
        assert count == 1


def test_repository_creation_race_reuses_one_bound_shell(draft_api: DraftApi) -> None:
    action_id = uuid4()
    barrier = Barrier(3)

    def store() -> UUID:
        with Session(bind=draft_api.engine, expire_on_commit=False) as session, session.begin():
            barrier.wait()
            draft = create_recipe_draft(
                session,
                author_user_id=MEMBER_ID,
                creation_action_id=action_id,
                source_version_id=CARROT_ROOT_ID,
            )
            assert draft is not None
            return draft.id

    with ThreadPoolExecutor(max_workers=2) as executor:
        requests = [executor.submit(store) for _index in range(2)]
        barrier.wait()
        draft_ids = [request.result(timeout=20) for request in requests]

    assert draft_ids[0] == draft_ids[1]
    detail = draft_api.member.get(f"/api/recipe-drafts/{draft_ids[0]}")
    assert detail.status_code == 200
    assert len(cast(list[object], _json_object(detail.json())["ingredients"])) == 9


def test_creation_replay_precedes_source_visibility_recheck(draft_api: DraftApi) -> None:
    action_id = uuid4()
    created = draft_api.member.post(
        "/api/recipe-drafts",
        headers=_creation_headers(action_id),
        json={"source_version_id": str(CARROT_ROOT_ID)},
    )
    assert created.status_code == 201

    with Session(bind=draft_api.engine) as session, session.begin():
        publication = session.get(RecipeVersionPublication, CARROT_ROOT_ID)
        assert publication is not None
        withdrawn_at = datetime.now(UTC)
        publication.state = "author_withdrawn"
        publication.author_withdrawn_at = withdrawn_at
        publication.state_changed_at = withdrawn_at

    replayed = draft_api.member.post(
        "/api/recipe-drafts",
        headers=_creation_headers(action_id),
        json={"source_version_id": str(CARROT_ROOT_ID)},
    )
    assert replayed.status_code == 201
    assert replayed.json() == created.json()

    new_attempt = draft_api.member.post(
        "/api/recipe-drafts",
        headers=_creation_headers(),
        json={"source_version_id": str(CARROT_ROOT_ID)},
    )
    assert new_attempt.status_code == 404
    assert _json_object(_json_object(new_attempt.json())["error"])["code"] == (
        "recipe_source_not_found"
    )


def test_exact_source_clone_and_curated_full_replacement(draft_api: DraftApi) -> None:
    created = draft_api.member.post(
        "/api/recipe-drafts",
        headers=_creation_headers(),
        json={"source_version_id": str(CARROT_ROOT_ID)},
    )
    assert created.status_code == 201
    body = _json_object(created.json())
    assert body["source_version_id"] == str(CARROT_ROOT_ID)
    assert len(cast(list[object], body["ingredients"])) == 9
    assert len(cast(list[object], body["instructions"])) == 4
    assert body["categories"] == [
        {
            "id": str(DESSERTS_CATEGORY_ID),
            "name": "Desserts",
            "slug": "desserts",
        },
        {
            "id": str(VEGETARIAN_CATEGORY_ID),
            "name": "Vegetarian",
            "slug": "vegetarian",
        },
    ]
    assert all(_json_object(item)["selection"] for item in cast(list[object], body["ingredients"]))

    draft_id = body["id"]
    payload = {
        "revision": 1,
        "title": "Structured private chickpea draft",
        "description": "Saved without publishing.",
        "servings": "2.00",
        "category_ids": [str(QUICK_EASY_CATEGORY_ID), str(BREAKFAST_CATEGORY_ID)],
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
    assert detail["categories"] == [
        {
            "id": str(BREAKFAST_CATEGORY_ID),
            "name": "Breakfast",
            "slug": "breakfast",
        },
        {
            "id": str(QUICK_EASY_CATEGORY_ID),
            "name": "Quick & Easy",
            "slug": "quick-easy",
        },
    ]
    ingredient = _json_object(cast(list[object], detail["ingredients"])[0])
    assert _json_object(ingredient["selection"])["kind"] == "catalog"
    action = _json_object(
        cast(list[object], _json_object(cast(list[object], detail["instructions"])[0])["actions"])[
            0
        ]
    )
    assert action["ingredient_occurrence_ids"] == [ingredient["id"]]


def test_source_clone_preserves_historical_package_metadata_but_rejects_reselection(
    draft_api: DraftApi,
) -> None:
    package_size_id = uuid4()
    source_lineage_id = uuid4()
    source_version_id = uuid4()
    with Session(bind=draft_api.engine) as session, session.begin():
        package_unit = session.get(MeasurementUnit, CAN_ID)
        assert package_unit is not None
        session.add(
            IngredientPackageSize(
                id=package_size_id,
                ingredient_id=WALNUT_ID,
                package_unit_id=CAN_ID,
                content_unit_id=GRAM_ID,
                content_value=Decimal("400.000000"),
                label="400 g historical draft test can",
                active=True,
                provenance="Reviewed historical draft-copy regression fixture.",
            )
        )
        session.add(
            RecipeLineage(
                id=source_lineage_id,
                created_by_user_id=MEMBER_ID,
            )
        )
        session.flush()
        session.add(
            RecipeVersion(
                id=source_version_id,
                lineage_id=source_lineage_id,
                parent_version_id=None,
                created_by_user_id=MEMBER_ID,
                version_number=1,
                title="Historical package metadata source",
                description=None,
                servings=Decimal("1.00"),
            )
        )
        session.flush()
        session.add(
            RecipeIngredient(
                recipe_version_id=source_version_id,
                ingredient_id=WALNUT_ID,
                name="Walnut",
                measure_mode="exact",
                quantity_min=Decimal("1.0000"),
                quantity_max=None,
                measurement_unit_id=CAN_ID,
                unit_display="can",
                package_size_id=package_size_id,
                preparation_notes=None,
                display_order=0,
            )
        )
        session.flush()
        package_unit.active = False
        package_size = session.get(IngredientPackageSize, package_size_id)
        assert package_size is not None
        package_size.active = False
        session.flush()
        session.add(
            RecipeVersionPublication(
                recipe_version_id=source_version_id,
                actor_user_id=MEMBER_ID,
                state_changed_by_user_id=MEMBER_ID,
            )
        )

    copied = draft_api.member.post(
        "/api/recipe-drafts",
        headers=_creation_headers(),
        json={"source_version_id": str(source_version_id)},
    )
    assert copied.status_code == 201, copied.text
    copied_walnut = next(
        _json_object(item)
        for item in cast(list[object], _json_object(copied.json())["ingredients"])
        if _json_object(_json_object(_json_object(item)["selection"])["ingredient"])["id"]
        == str(WALNUT_ID)
    )
    copied_measure = _json_object(copied_walnut["measure"])
    assert copied_measure["package_size_id"] == str(package_size_id)
    assert _json_object(copied_measure["unit"])["id"] == str(CAN_ID)
    assert _json_object(copied_measure["unit"])["active"] is False

    blank = draft_api.member.post(
        "/api/recipe-drafts",
        headers=_creation_headers(),
        json={"source_version_id": None},
    )
    assert blank.status_code == 201
    blank_id = _json_object(blank.json())["id"]
    rejected = draft_api.member.put(
        f"/api/recipe-drafts/{blank_id}",
        json={
            **_blank_update(revision=1, title="Inactive package unit selection"),
            "ingredients": [
                {
                    "ref": "walnut-slot",
                    "selection": {
                        "kind": "catalog",
                        "ingredient_id": str(WALNUT_ID),
                        "display_name": "Walnut",
                    },
                    "measure": {
                        "kind": "exact",
                        "value": "1.0000",
                        "unit_id": str(CAN_ID),
                        "package_size_id": str(package_size_id),
                    },
                    "preparation_notes": None,
                }
            ],
        },
    )
    assert rejected.status_code == 422
    unchanged = _json_object(draft_api.member.get(f"/api/recipe-drafts/{blank_id}").json())
    assert unchanged["revision"] == 1
    assert unchanged["ingredients"] == []


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
        headers=_creation_headers(),
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

    preflight = draft_api.member.post(
        f"/api/recipe-drafts/{draft_id}/duplicate-preflights",
        headers={"Idempotency-Key": str(uuid4())},
        json={"revision": 2},
    )
    assert preflight.status_code == 422
    with Session(bind=draft_api.engine) as session:
        assert (
            session.scalar(
                select(RecipeVersion).where(RecipeVersion.title == "Waiting for catalog review")
            )
            is None
        )


def test_unknown_curated_identities_are_rejected_without_mutation(
    draft_api: DraftApi,
) -> None:
    created = draft_api.member.post(
        "/api/recipe-drafts",
        headers=_creation_headers(),
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
            **_blank_update(revision=1, title="Unknown recipe category"),
            "category_ids": [str(uuid4())],
        },
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
        {
            **_blank_update(revision=1, title="Wrong action measure dimension"),
            "ingredients": [valid_ingredient],
            "instructions": [
                {
                    "ref": "instruction",
                    "text": "Use a temperature where a duration is required.",
                    "actions": [
                        {
                            "action_type_id": str(MIX_ID),
                            "ingredient_refs": ["ingredient-slot"],
                            "duration": {
                                "kind": "exact",
                                "value": "1.0000",
                                "unit_id": str(CELSIUS_ID),
                            },
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


def test_recipe_category_authoring_enforces_active_unique_bounded_ids(
    draft_api: DraftApi,
) -> None:
    created = draft_api.member.post(
        "/api/recipe-drafts",
        headers=_creation_headers(),
        json={"source_version_id": None},
    )
    assert created.status_code == 201
    draft_id = _json_object(created.json())["id"]

    category_ids = [
        str(BREAKFAST_CATEGORY_ID),
        str(DESSERTS_CATEGORY_ID),
        str(VEGETARIAN_CATEGORY_ID),
        str(QUICK_EASY_CATEGORY_ID),
    ]
    duplicate = draft_api.member.put(
        f"/api/recipe-drafts/{draft_id}",
        json={
            **_blank_update(revision=1, title="Duplicate categories"),
            "category_ids": [category_ids[0], category_ids[0]],
        },
    )
    over_capacity = draft_api.member.put(
        f"/api/recipe-drafts/{draft_id}",
        json={
            **_blank_update(revision=1, title="Too many categories"),
            "category_ids": category_ids,
        },
    )
    assert duplicate.status_code == over_capacity.status_code == 422
    assert _json_object(_json_object(duplicate.json())["error"])["code"] == ("validation_error")
    assert _json_object(_json_object(over_capacity.json())["error"])["code"] == ("validation_error")

    try:
        with Session(bind=draft_api.engine) as session, session.begin():
            category = session.get(RecipeCategory, BREAKFAST_CATEGORY_ID)
            assert category is not None
            category.active = False

        inactive = draft_api.member.put(
            f"/api/recipe-drafts/{draft_id}",
            json={
                **_blank_update(revision=1, title="Inactive category"),
                "category_ids": [str(BREAKFAST_CATEGORY_ID)],
            },
        )
        assert inactive.status_code == 422
        assert _json_object(_json_object(inactive.json())["error"])["code"] == (
            "invalid_recipe_draft"
        )
    finally:
        with Session(bind=draft_api.engine) as session, session.begin():
            category = session.get(RecipeCategory, BREAKFAST_CATEGORY_ID)
            assert category is not None
            category.active = True

    unchanged = _json_object(draft_api.member.get(f"/api/recipe-drafts/{draft_id}").json())
    assert unchanged["revision"] == 1
    assert unchanged["categories"] == []
