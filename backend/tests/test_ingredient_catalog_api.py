from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from threading import Barrier
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from alembic import command
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import Engine, delete, func, select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.core.security import AUTH_CSRF_COOKIE_NAME, AUTH_SESSION_COOKIE_NAME
from app.models import (
    CatalogCurator,
    Ingredient,
    IngredientAlias,
    IngredientCatalogAuditEvent,
    IngredientCatalogName,
    IngredientCatalogRequest,
)
from app.schemas.ingredient_catalog import MemberIngredientCatalogRequestResponse
from app.seeds import load_bundled_catalog, seed_catalog
from app.seeds.identifiers import seed_uuid
from tests.application import application_with_database
from tests.conftest import make_alembic_config
from tests.member_session import (
    MemberCredentials,
    authenticate_client,
    create_member_credentials,
)

DATASET_ID = "recipe-lab-demo-v1"
CHICKPEA_ID = seed_uuid(DATASET_ID, "ingredient", "chickpea")
MEMBER_ID = UUID("79000000-0000-4000-8000-000000000001")
OTHER_MEMBER_ID = UUID("79000000-0000-4000-8000-000000000002")
CURATOR_ID = UUID("79000000-0000-4000-8000-000000000003")
INCOMPLETE_ID = UUID("79000000-0000-4000-8000-000000000004")
PEER_CURATOR_ID = UUID("79000000-0000-4000-8000-000000000005")


@dataclass(frozen=True, slots=True)
class CatalogApi:
    application: FastAPI
    anonymous: TestClient
    member: TestClient
    other_member: TestClient
    curator: TestClient
    peer_curator: TestClient
    incomplete: TestClient
    member_credentials: MemberCredentials
    engine: Engine


@pytest.fixture
def catalog_api(empty_postgres_engine: Engine) -> Iterator[CatalogApi]:
    config = make_alembic_config()
    with empty_postgres_engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
    with Session(bind=empty_postgres_engine) as session, session.begin():
        seed_catalog(session, load_bundled_catalog())

    member = create_member_credentials(
        empty_postgres_engine,
        user_id=MEMBER_ID,
        handle="catalog_member",
        display_name="Catalog Member",
    )
    other_member = create_member_credentials(
        empty_postgres_engine,
        user_id=OTHER_MEMBER_ID,
        handle="other_catalog_member",
        display_name="Other Catalog Member",
    )
    curator = create_member_credentials(
        empty_postgres_engine,
        user_id=CURATOR_ID,
        handle="catalog_curator",
        display_name="Catalog Curator",
    )
    peer_curator = create_member_credentials(
        empty_postgres_engine,
        user_id=PEER_CURATOR_ID,
        handle="peer_catalog_curator",
        display_name="Peer Catalog Curator",
    )
    incomplete = create_member_credentials(
        empty_postgres_engine,
        user_id=INCOMPLETE_ID,
        handle=None,
        display_name="Incomplete Catalog Member",
    )
    with Session(bind=empty_postgres_engine) as session, session.begin():
        session.add_all(
            [
                CatalogCurator(user_id=CURATOR_ID),
                CatalogCurator(user_id=PEER_CURATOR_ID, granted_by_user_id=CURATOR_ID),
            ]
        )

    with application_with_database(
        empty_postgres_engine,
        expire_on_commit=False,
    ) as application:
        with (
            TestClient(application) as anonymous_client,
            TestClient(application) as member_client,
            TestClient(application) as other_member_client,
            TestClient(application) as curator_client,
            TestClient(application) as peer_curator_client,
            TestClient(application) as incomplete_client,
        ):
            authenticate_client(member_client, member)
            authenticate_client(other_member_client, other_member)
            authenticate_client(curator_client, curator)
            authenticate_client(peer_curator_client, peer_curator)
            authenticate_client(incomplete_client, incomplete)
            yield CatalogApi(
                application=application,
                anonymous=anonymous_client,
                member=member_client,
                other_member=other_member_client,
                curator=curator_client,
                peer_curator=peer_curator_client,
                incomplete=incomplete_client,
                member_credentials=member,
                engine=empty_postgres_engine,
            )


def _json_object(value: object) -> dict[str, Any]:
    return cast(dict[str, Any], value)


def _submit(
    client: TestClient,
    name: str,
    context: str | None = None,
) -> dict[str, Any]:
    response = client.post(
        "/api/ingredient-requests",
        json={"proposed_name": name, "context": context},
    )
    assert response.status_code == 201, response.text
    return _json_object(response.json())


def _approve(
    catalog_api: CatalogApi,
    request_id: str,
    *,
    canonical_name: str,
    aliases: list[str] | None = None,
) -> dict[str, Any]:
    response = catalog_api.curator.post(
        f"/api/ingredient-requests/{request_id}/review",
        json={
            "decision": "approve",
            "canonical_name": canonical_name,
            "aliases": aliases or [],
            "reason": "Reviewed as a distinct catalog ingredient.",
            "provenance": "Member request reviewed by Recipe Lab catalog curator.",
        },
    )
    assert response.status_code == 200, response.text
    return _json_object(response.json())


@pytest.mark.parametrize(
    ("request_status", "resolved_ingredient_id", "resolved_ingredient"),
    [
        (
            "pending",
            CHICKPEA_ID,
            {"id": CHICKPEA_ID, "canonical_name": "Chickpea", "aliases": []},
        ),
        (
            "rejected",
            None,
            {"id": CHICKPEA_ID, "canonical_name": "Chickpea", "aliases": []},
        ),
        ("approved", None, None),
        (
            "duplicate",
            MEMBER_ID,
            {"id": CHICKPEA_ID, "canonical_name": "Chickpea", "aliases": []},
        ),
    ],
)
def test_member_request_schema_rejects_inconsistent_catalog_resolutions(
    request_status: str,
    resolved_ingredient_id: UUID | None,
    resolved_ingredient: dict[str, object] | None,
) -> None:
    with pytest.raises(ValidationError):
        MemberIngredientCatalogRequestResponse.model_validate(
            {
                "id": uuid4(),
                "proposed_name": "Untrusted request text",
                "context": None,
                "status": request_status,
                "created_at": "2026-08-24T12:00:00Z",
                "reviewed_at": None,
                "decision_reason": None,
                "resolved_ingredient_id": resolved_ingredient_id,
                "resolved_ingredient": resolved_ingredient,
            }
        )


def test_public_catalog_search_is_literal_paginated_and_deduplicates_alias_matches(
    catalog_api: CatalogApi,
) -> None:
    alias_response = catalog_api.anonymous.get(
        "/api/ingredients",
        params={"q": "  GARBANZO  ", "page_size": 100},
    )
    literal_percent = catalog_api.anonymous.get(
        "/api/ingredients",
        params={"q": "%", "page_size": 100},
    )
    first_page = catalog_api.anonymous.get(
        "/api/ingredients",
        params={"page": 1, "page_size": 5},
    )
    second_page = catalog_api.anonymous.get(
        "/api/ingredients",
        params={"page": 2, "page_size": 5},
    )

    assert alias_response.status_code == 200
    alias_page = _json_object(alias_response.json())
    assert alias_page["total"] == 1
    assert alias_page["items"] == [
        {
            "id": str(CHICKPEA_ID),
            "canonical_name": "Chickpea",
            "aliases": ["Garbanzo bean", "Garbanzo beans"],
        }
    ]
    assert _json_object(literal_percent.json())["items"] == []
    page_one = _json_object(first_page.json())
    page_two = _json_object(second_page.json())
    assert page_one["page"] == 1
    assert page_one["page_size"] == 5
    assert page_one["total_pages"] >= 2
    names = [item["canonical_name"] for item in [*page_one["items"], *page_two["items"]]]
    assert names == sorted(names, key=lambda value: (value.casefold(), value))
    assert len({item["id"] for item in [*page_one["items"], *page_two["items"]]}) == 10

    for params in (
        {"q": ""},
        {"q": "x" * 101},
        {"page": 0},
        {"page_size": 101},
    ):
        assert catalog_api.anonymous.get("/api/ingredients", params=params).status_code == 422
    literal_underscore = catalog_api.anonymous.get(
        "/api/ingredients",
        params={"q": "ingredient_that_does_not_exist", "page_size": 100},
    )
    assert _json_object(literal_underscore.json())["items"] == []


def test_request_submission_requires_member_csrf_and_stays_out_of_catalog(
    catalog_api: CatalogApi,
) -> None:
    anonymous = catalog_api.anonymous.post(
        "/api/ingredient-requests",
        json={"proposed_name": "Romanesco leaf", "context": None},
    )
    incomplete = catalog_api.incomplete.post(
        "/api/ingredient-requests",
        json={"proposed_name": "Romanesco leaf", "context": None},
    )
    created = catalog_api.member.post(
        "/api/ingredient-requests",
        json={
            "proposed_name": "  Romanesco leaf  ",
            "context": "  Used as a braising green.  ",
        },
    )

    assert anonymous.status_code == 401
    assert incomplete.status_code == 403
    assert _json_object(incomplete.json())["error"]["code"] == "account_setup_required"
    assert created.status_code == 201
    body = _json_object(created.json())
    assert body == {
        "id": body["id"],
        "proposed_name": "Romanesco leaf",
        "context": "Used as a braising green.",
        "status": "pending",
        "created_at": body["created_at"],
        "reviewed_at": None,
        "decision_reason": None,
        "resolved_ingredient_id": None,
        "resolved_ingredient": None,
    }
    assert created.headers["location"] == f"/api/ingredient-requests/{body['id']}"
    assert created.headers["cache-control"] == "private, no-store"
    assert {value.strip() for value in created.headers["vary"].split(",")} >= {
        "Cookie",
        "Origin",
    }
    detail = catalog_api.member.get(created.headers["location"])
    hidden_from_other_member = catalog_api.other_member.get(created.headers["location"])
    assert detail.status_code == 200
    assert detail.json() == body
    assert hidden_from_other_member.status_code == 404

    search = catalog_api.anonymous.get("/api/ingredients", params={"q": "Romanesco leaf"})
    assert _json_object(search.json())["items"] == []
    with Session(bind=catalog_api.engine) as session:
        assert session.scalar(select(func.count()).select_from(IngredientCatalogRequest)) == 1
        events = list(session.scalars(select(IngredientCatalogAuditEvent)))
        assert [event.event_type for event in events] == ["submitted"]


def test_request_input_is_bounded_and_csrf_failure_creates_no_rows(
    catalog_api: CatalogApi,
) -> None:
    with TestClient(catalog_api.application) as wrong_csrf:
        wrong_csrf.cookies.set(
            AUTH_SESSION_COOKIE_NAME,
            catalog_api.member_credentials.session_token,
        )
        wrong_csrf.cookies.set(
            AUTH_CSRF_COOKIE_NAME,
            catalog_api.member_credentials.csrf_token,
        )
        wrong_csrf.headers.update(
            {"Origin": "http://localhost:3000", "X-CSRF-Token": "wrong-token"}
        )
        csrf_response = wrong_csrf.post(
            "/api/ingredient-requests",
            json={"proposed_name": "CSRF herb", "context": None},
        )

    invalid_payloads = [
        {"proposed_name": "x" * 201, "context": None},
        {"proposed_name": "Bounded herb", "context": "x" * 501},
        {"proposed_name": "Nul\x00herb", "context": None},
        {"proposed_name": "Extra herb", "context": None, "untrusted": True},
    ]
    invalid_responses = [
        catalog_api.member.post("/api/ingredient-requests", json=payload)
        for payload in invalid_payloads
    ]

    assert csrf_response.status_code == 403
    assert _json_object(csrf_response.json())["error"]["code"] == "invalid_csrf"
    assert {response.status_code for response in invalid_responses} == {422}
    with Session(bind=catalog_api.engine) as session:
        assert session.scalar(select(func.count()).select_from(IngredientCatalogRequest)) == 0
        assert session.scalar(select(func.count()).select_from(IngredientCatalogAuditEvent)) == 0


def test_normalized_catalog_and_open_request_candidates_conflict_without_auto_identity(
    catalog_api: CatalogApi,
) -> None:
    existing_alias = catalog_api.member.post(
        "/api/ingredient-requests",
        json={"proposed_name": "Ｇａｒｂａｎｚｏ   beans", "context": None},
    )
    first = catalog_api.member.post(
        "/api/ingredient-requests",
        json={"proposed_name": "Dragon fruit leaf", "context": None},
    )
    normalized_duplicate = catalog_api.other_member.post(
        "/api/ingredient-requests",
        json={"proposed_name": "ＤＲＡＧＯＮ   fruit leaf", "context": None},
    )
    compatibility_expansion = "\ufdfa" * 200
    expanded = catalog_api.member.post(
        "/api/ingredient-requests",
        json={"proposed_name": compatibility_expansion, "context": None},
    )

    assert existing_alias.status_code == 409
    assert _json_object(existing_alias.json())["error"]["code"] == ("ingredient_request_conflict")
    assert "no ingredient identity was inferred" in existing_alias.text
    assert first.status_code == 201
    assert normalized_duplicate.status_code == 409
    assert expanded.status_code == 201
    with Session(bind=catalog_api.engine) as session:
        expanded_request = session.get(
            IngredientCatalogRequest,
            UUID(_json_object(expanded.json())["id"]),
        )
        assert expanded_request is not None
        assert len(expanded_request.normalized_name) > 600
        assert len(expanded_request.normalized_name_digest) == 64


def test_concurrent_normalized_submissions_create_one_pending_request(
    catalog_api: CatalogApi,
) -> None:
    barrier = Barrier(2)

    def submit(client: TestClient, name: str) -> int:
        barrier.wait()
        response = client.post(
            "/api/ingredient-requests",
            json={"proposed_name": name, "context": None},
        )
        return int(response.status_code)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(submit, catalog_api.member, "Race herb"),
            executor.submit(submit, catalog_api.other_member, "ＲＡＣＥ   herb"),
        ]
        statuses = sorted(future.result() for future in futures)

    assert statuses == [201, 409]
    with Session(bind=catalog_api.engine) as session:
        requests = list(
            session.scalars(
                select(IngredientCatalogRequest).where(
                    IngredientCatalogRequest.normalized_name == "race herb"
                )
            )
        )
        assert len(requests) == 1


def test_concurrent_approvals_serialize_one_catalog_identity_and_one_conflict(
    catalog_api: CatalogApi,
) -> None:
    first = _submit(catalog_api.member, "Parallel catalog request alpha")
    second = _submit(catalog_api.other_member, "Parallel catalog request beta")
    barrier = Barrier(2)

    def approve(client: TestClient, request_id: str) -> tuple[int, dict[str, Any]]:
        barrier.wait()
        response = client.post(
            f"/api/ingredient-requests/{request_id}/review",
            json={
                "decision": "approve",
                "canonical_name": "Parallel kale",
                "aliases": ["Parallel greens"],
                "reason": "Concurrent curator review.",
                "provenance": "RCP-25A concurrency regression.",
            },
        )
        return int(response.status_code), _json_object(response.json())

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(approve, catalog_api.curator, first["id"]),
            executor.submit(approve, catalog_api.peer_curator, second["id"]),
        ]
        outcomes = [future.result() for future in futures]

    assert sorted(status for status, _body in outcomes) == [200, 409]
    success = next(body for status, body in outcomes if status == 200)
    conflict = next(body for status, body in outcomes if status == 409)
    assert success["status"] == "approved"
    assert conflict["error"]["code"] == "ingredient_catalog_conflict"
    assert "matches existing candidate" in conflict["error"]["message"]

    request_ids = [UUID(first["id"]), UUID(second["id"])]
    with Session(bind=catalog_api.engine) as session:
        requests = [session.get(IngredientCatalogRequest, request_id) for request_id in request_ids]
        assert all(request is not None for request in requests)
        reviewed_requests = [request for request in requests if request is not None]
        approved = [request for request in reviewed_requests if request.status == "approved"]
        pending = [request for request in reviewed_requests if request.status == "pending"]
        assert len(approved) == 1
        assert len(pending) == 1
        assert approved[0].resolved_ingredient_id is not None
        assert approved[0].reviewer_user_id in {CURATOR_ID, PEER_CURATOR_ID}
        assert pending[0].resolved_ingredient_id is None
        assert pending[0].reviewer_user_id is None
        assert pending[0].reviewed_at is None
        assert pending[0].decision_reason is None

        ingredients = list(
            session.scalars(
                select(Ingredient).where(
                    func.lower(func.btrim(Ingredient.canonical_name)) == "parallel kale"
                )
            )
        )
        aliases = list(
            session.scalars(
                select(IngredientAlias).where(
                    func.lower(func.btrim(IngredientAlias.alias)) == "parallel greens"
                )
            )
        )
        assert len(ingredients) == 1
        assert len(aliases) == 1
        assert aliases[0].ingredient_id == ingredients[0].id
        assert approved[0].resolved_ingredient_id == ingredients[0].id
        namespace_rows = list(
            session.scalars(
                select(IngredientCatalogName).where(
                    IngredientCatalogName.normalized_name.in_(["parallel kale", "parallel greens"])
                )
            )
        )
        assert {row.name_kind for row in namespace_rows} == {"canonical", "alias"}
        assert {
            row.canonical_ingredient_id or row.ingredient_alias_id for row in namespace_rows
        } == {ingredients[0].id, aliases[0].id}

        events = list(
            session.scalars(
                select(IngredientCatalogAuditEvent).where(
                    IngredientCatalogAuditEvent.request_id.in_(request_ids)
                )
            )
        )
        assert sorted(event.event_type for event in events) == [
            "approved",
            "submitted",
            "submitted",
        ]
        approval_event = next(event for event in events if event.event_type == "approved")
        assert approval_event.request_id == approved[0].id
        assert approval_event.actor_user_id == approved[0].reviewer_user_id
        assert approval_event.payload["ingredient_id"] == str(ingredients[0].id)


def test_only_curator_can_approve_and_catalog_audit_is_append_only(
    catalog_api: CatalogApi,
) -> None:
    pending = _submit(catalog_api.member, "Celtuce", "A long-stem lettuce.")
    forbidden = catalog_api.other_member.post(
        f"/api/ingredient-requests/{pending['id']}/review",
        json={
            "decision": "reject",
            "reason": "Not authorized to make this decision.",
        },
    )
    approved = _approve(
        catalog_api,
        pending["id"],
        canonical_name="Celtuce",
        aliases=["Stem lettuce"],
    )

    assert forbidden.status_code == 403
    assert _json_object(forbidden.json())["error"]["code"] == "catalog_curator_required"
    assert approved["status"] == "approved"
    assert approved["reviewer_user_id"] == str(CURATOR_ID)
    assert approved["resolved_ingredient_id"] is not None
    assert approved["approved_canonical_name"] == "Celtuce"
    assert approved["approved_aliases"] == ["Stem lettuce"]
    assert approved["approval_provenance"]
    assert approved["reviewed_at"] is not None
    assert approved["decision_reason"] == "Reviewed as a distinct catalog ingredient."

    alias_search = catalog_api.anonymous.get(
        "/api/ingredients",
        params={"q": "stem lettuce"},
    )
    result = _json_object(alias_search.json())["items"]
    assert result == [
        {
            "id": approved["resolved_ingredient_id"],
            "canonical_name": "Celtuce",
            "aliases": ["Stem lettuce"],
        }
    ]
    repeated = catalog_api.curator.post(
        f"/api/ingredient-requests/{pending['id']}/review",
        json={"decision": "reject", "reason": "Conflicting retry."},
    )
    assert repeated.status_code == 409
    assert _json_object(repeated.json())["error"]["code"] == ("ingredient_request_already_reviewed")

    with Session(bind=catalog_api.engine) as session:
        events = list(
            session.scalars(
                select(IngredientCatalogAuditEvent)
                .where(IngredientCatalogAuditEvent.request_id == UUID(pending["id"]))
                .order_by(IngredientCatalogAuditEvent.created_at)
            )
        )
        assert [event.event_type for event in events] == ["submitted", "approved"]
        assert events[-1].payload["aliases"] == ["Stem lettuce"]
        assert events[-1].actor_user_id == CURATOR_ID
        assert events[-1].payload["provenance"] == (
            "Member request reviewed by Recipe Lab catalog curator."
        )
        with pytest.raises(DBAPIError, match="append-only"):
            session.execute(
                update(IngredientCatalogAuditEvent)
                .where(IngredientCatalogAuditEvent.id == events[-1].id)
                .values(event_type="rejected")
            )
            session.flush()

    with Session(bind=catalog_api.engine) as session:
        with pytest.raises(DBAPIError, match="append-only"):
            session.execute(text("TRUNCATE TABLE ingredient_catalog_audit_events"))

    with Session(bind=catalog_api.engine) as session:
        with pytest.raises(DBAPIError, match="append-only"):
            session.execute(
                delete(IngredientCatalogAuditEvent).where(
                    IngredientCatalogAuditEvent.request_id == UUID(pending["id"])
                )
            )

    with Session(bind=catalog_api.engine) as session:
        preserved_events = list(
            session.scalars(
                select(IngredientCatalogAuditEvent)
                .where(IngredientCatalogAuditEvent.request_id == UUID(pending["id"]))
                .order_by(IngredientCatalogAuditEvent.created_at)
            )
        )
        assert [event.event_type for event in preserved_events] == ["submitted", "approved"]


def test_approval_rechecks_normalized_catalog_and_pending_request_candidates(
    catalog_api: CatalogApi,
) -> None:
    first = _submit(catalog_api.member, "Ice lettuce")
    other_pending = _submit(catalog_api.other_member, "Moon spinach")
    leapfrog = catalog_api.curator.post(
        f"/api/ingredient-requests/{first['id']}/review",
        json={
            "decision": "approve",
            "canonical_name": "ＭＯＯＮ   spinach",
            "aliases": [],
            "reason": "Attempted approval.",
            "provenance": "Test review.",
        },
    )
    catalog_collision = catalog_api.curator.post(
        f"/api/ingredient-requests/{first['id']}/review",
        json={
            "decision": "approve",
            "canonical_name": "Ice lettuce",
            "aliases": ["Ｇａｒｂａｎｚｏ   beans"],
            "reason": "Attempted approval.",
            "provenance": "Test review.",
        },
    )

    assert leapfrog.status_code == 409
    assert "another pending request" in leapfrog.text
    assert catalog_collision.status_code == 409
    assert "matches existing candidate" in catalog_collision.text
    with Session(bind=catalog_api.engine) as session:
        first_request = session.get(IngredientCatalogRequest, UUID(first["id"]))
        second_request = session.get(IngredientCatalogRequest, UUID(other_pending["id"]))
        assert first_request is not None
        assert second_request is not None
        assert first_request.status == "pending"
        assert second_request.status == "pending"
        assert (
            session.scalar(
                select(func.count())
                .select_from(Ingredient)
                .where(Ingredient.canonical_name.ilike("ice%"))
            )
            == 0
        )
        assert list(
            session.scalars(
                select(IngredientCatalogAuditEvent.event_type).where(
                    IngredientCatalogAuditEvent.request_id == UUID(first["id"])
                )
            )
        ) == ["submitted"]


def test_reject_and_duplicate_decisions_are_terminal_and_resolve_safely(
    catalog_api: CatalogApi,
) -> None:
    source = _submit(catalog_api.member, "Moon melon")
    approved = _approve(catalog_api, source["id"], canonical_name="Moon melon")
    duplicate = _submit(catalog_api.member, "Moon melon variety")
    duplicate_response = catalog_api.curator.post(
        f"/api/ingredient-requests/{duplicate['id']}/review",
        json={
            "decision": "duplicate",
            "reason": "The approved request already covers this item.",
            "request_id": source["id"],
            "ingredient_id": None,
        },
    )
    rejected = _submit(catalog_api.other_member, "Unsafe vague ingredient")
    reject_response = catalog_api.curator.post(
        f"/api/ingredient-requests/{rejected['id']}/review",
        json={"decision": "reject", "reason": "The proposed name is too vague."},
    )

    assert duplicate_response.status_code == 200
    duplicate_body = _json_object(duplicate_response.json())
    assert duplicate_body["status"] == "duplicate"
    assert duplicate_body["duplicate_of_request_id"] == source["id"]
    assert duplicate_body["resolved_ingredient_id"] == approved["resolved_ingredient_id"]
    assert reject_response.status_code == 200
    assert _json_object(reject_response.json())["status"] == "rejected"
    assert _json_object(reject_response.json())["resolved_ingredient_id"] is None

    for name in ("Moon melon variety", "Unsafe vague ingredient"):
        response = catalog_api.anonymous.get("/api/ingredients", params={"q": name})
        assert _json_object(response.json())["items"] == []

    invalid_chain = _submit(catalog_api.other_member, "Another moon melon")
    invalid_response = catalog_api.curator.post(
        f"/api/ingredient-requests/{invalid_chain['id']}/review",
        json={
            "decision": "duplicate",
            "reason": "Do not create duplicate chains.",
            "request_id": duplicate["id"],
            "ingredient_id": None,
        },
    )
    assert invalid_response.status_code == 409
    assert "not an approved request" in invalid_response.text


def test_member_request_history_is_private_filterable_and_returns_trusted_resolutions(
    catalog_api: CatalogApi,
) -> None:
    approved_request = _submit(catalog_api.member, "Trackable approval herb")
    approved = _approve(
        catalog_api,
        approved_request["id"],
        canonical_name="Trackable herb",
        aliases=["Zesty track leaf", "Alias track leaf"],
    )
    duplicate_request = _submit(catalog_api.member, "Trackable herb duplicate request")
    duplicate_response = catalog_api.curator.post(
        f"/api/ingredient-requests/{duplicate_request['id']}/review",
        json={
            "decision": "duplicate",
            "reason": "The curated trackable herb already covers this request.",
            "ingredient_id": approved["resolved_ingredient_id"],
            "request_id": None,
        },
    )
    rejected_request = _submit(catalog_api.member, "Unclear tracking ingredient")
    rejected_response = catalog_api.curator.post(
        f"/api/ingredient-requests/{rejected_request['id']}/review",
        json={"decision": "reject", "reason": "The proposed ingredient is too vague."},
    )
    pending_request = _submit(catalog_api.member, "Pending tracking herb")
    other_request = _submit(catalog_api.other_member, "Other member private herb")
    assert duplicate_response.status_code == 200
    assert rejected_response.status_code == 200

    assert catalog_api.anonymous.get("/api/ingredient-requests/mine").status_code == 401
    incomplete = catalog_api.incomplete.get("/api/ingredient-requests/mine")
    assert incomplete.status_code == 403
    assert _json_object(incomplete.json())["error"]["code"] == "account_setup_required"

    history_response = catalog_api.member.get(
        "/api/ingredient-requests/mine",
        params={"page": 1, "page_size": 100},
    )
    assert history_response.status_code == 200
    assert history_response.headers["cache-control"] == "private, no-store"
    assert {value.strip() for value in history_response.headers["vary"].split(",")} >= {
        "Cookie",
        "Origin",
    }
    history = _json_object(history_response.json())
    assert history["total"] == 4
    assert history["total_pages"] == 1
    assert history["page"] == 1
    assert history["page_size"] == 100
    assert other_request["id"] not in {item["id"] for item in history["items"]}
    assert "@" not in history_response.text

    items = {item["status"]: item for item in history["items"]}
    assert set(items) == {"pending", "approved", "rejected", "duplicate"}
    safe_member_fields = {
        "id",
        "proposed_name",
        "context",
        "status",
        "created_at",
        "reviewed_at",
        "decision_reason",
        "resolved_ingredient_id",
        "resolved_ingredient",
    }
    assert all(set(item) == safe_member_fields for item in history["items"])

    expected_resolution = {
        "id": approved["resolved_ingredient_id"],
        "canonical_name": "Trackable herb",
        "aliases": ["Alias track leaf", "Zesty track leaf"],
    }
    for request_status in ("approved", "duplicate"):
        assert items[request_status]["resolved_ingredient_id"] == expected_resolution["id"]
        assert items[request_status]["resolved_ingredient"] == expected_resolution
    for request_status in ("pending", "rejected"):
        assert items[request_status]["resolved_ingredient_id"] is None
        assert items[request_status]["resolved_ingredient"] is None

    first_page = catalog_api.member.get(
        "/api/ingredient-requests/mine",
        params={"page": 1, "page_size": 1},
    )
    first_page_body = _json_object(first_page.json())
    assert first_page_body["total"] == 4
    assert first_page_body["total_pages"] == 4
    assert first_page_body["items"][0]["id"] == pending_request["id"]

    reviewed_page = catalog_api.member.get(
        "/api/ingredient-requests/mine",
        params={"reviewed_only": True, "page": 1, "page_size": 2},
    )
    reviewed_page_body = _json_object(reviewed_page.json())
    assert reviewed_page.status_code == 200
    assert reviewed_page_body["total"] == 3
    assert reviewed_page_body["total_pages"] == 2
    assert all(item["reviewed_at"] is not None for item in reviewed_page_body["items"])
    assert pending_request["id"] not in {item["id"] for item in reviewed_page_body["items"]}
    assert [item["reviewed_at"] for item in reviewed_page_body["items"]] == sorted(
        (item["reviewed_at"] for item in reviewed_page_body["items"]),
        reverse=True,
    )

    expected_ids = {
        "pending": pending_request["id"],
        "approved": approved_request["id"],
        "rejected": rejected_request["id"],
        "duplicate": duplicate_request["id"],
    }
    for request_status, expected_id in expected_ids.items():
        filtered = catalog_api.member.get(
            "/api/ingredient-requests/mine",
            params={"status": request_status, "page": 1, "page_size": 1},
        )
        filtered_body = _json_object(filtered.json())
        assert filtered.status_code == 200
        assert filtered_body["total"] == 1
        assert filtered_body["items"][0]["id"] == expected_id

    resolved_search = catalog_api.member.get(
        "/api/ingredient-requests/mine",
        params={"status": "duplicate", "q": "alias track leaf"},
    )
    assert resolved_search.status_code == 200
    assert [item["id"] for item in _json_object(resolved_search.json())["items"]] == [
        duplicate_request["id"]
    ]
    assert (
        _json_object(
            catalog_api.member.get(
                "/api/ingredient-requests/mine",
                params={"q": "%", "page_size": 100},
            ).json()
        )["items"]
        == []
    )
    for invalid_params in ({"status": "unknown"}, {"q": ""}, {"q": "x" * 101}):
        assert (
            catalog_api.member.get(
                "/api/ingredient-requests/mine",
                params=invalid_params,
            ).status_code
            == 422
        )

    other_history = _json_object(
        catalog_api.other_member.get("/api/ingredient-requests/mine").json()
    )
    assert other_history["total"] == 1
    assert [item["id"] for item in other_history["items"]] == [other_request["id"]]
    approved_detail_path = f"/api/ingredient-requests/{approved_request['id']}"
    approved_detail = catalog_api.member.get(approved_detail_path)
    assert approved_detail.status_code == 200
    assert approved_detail.headers["cache-control"] == "private, no-store"
    assert {value.strip() for value in approved_detail.headers["vary"].split(",")} >= {
        "Cookie",
        "Origin",
    }
    assert _json_object(approved_detail.json())["resolved_ingredient"] == expected_resolution
    hidden_detail = catalog_api.other_member.get(approved_detail_path)
    assert hidden_detail.status_code == 404
    assert _json_object(hidden_detail.json())["error"]["code"] == "ingredient_request_not_found"


def test_member_history_search_does_not_probe_curator_only_approval_snapshots(
    catalog_api: CatalogApi,
) -> None:
    request = _submit(catalog_api.member, "Snapshot privacy herb")
    approved = _approve(
        catalog_api,
        request["id"],
        canonical_name="Current privacy herb",
        aliases=["Retired private snapshot alias"],
    )
    with Session(bind=catalog_api.engine) as session, session.begin():
        retired_alias = session.scalar(
            select(IngredientAlias).where(
                IngredientAlias.ingredient_id == UUID(approved["resolved_ingredient_id"]),
                IngredientAlias.alias == "Retired private snapshot alias",
            )
        )
        assert retired_alias is not None
        session.delete(retired_alias)

    member_search = catalog_api.member.get(
        "/api/ingredient-requests/mine",
        params={"status": "approved", "q": "Retired private snapshot alias"},
    )
    assert member_search.status_code == 200
    assert _json_object(member_search.json())["items"] == []

    curator_search = catalog_api.curator.get(
        "/api/ingredient-requests",
        params={"status": "approved", "q": "Retired private snapshot alias"},
    )
    assert curator_search.status_code == 200
    assert [item["id"] for item in _json_object(curator_search.json())["items"]] == [request["id"]]

    member_detail = catalog_api.member.get(f"/api/ingredient-requests/{request['id']}")
    assert member_detail.status_code == 200
    assert _json_object(member_detail.json())["resolved_ingredient"] == {
        "id": approved["resolved_ingredient_id"],
        "canonical_name": "Current privacy herb",
        "aliases": [],
    }
    assert "approved_aliases" not in _json_object(member_detail.json())


def test_curator_session_capability_tracks_the_narrow_database_grant(
    catalog_api: CatalogApi,
) -> None:
    assert catalog_api.curator.get("/api/auth/session").json()["capabilities"] == {
        "review_ingredient_requests": True,
        "moderate_recipe_reports": False,
    }
    assert catalog_api.member.get("/api/auth/session").json()["capabilities"] == {
        "review_ingredient_requests": False,
        "moderate_recipe_reports": False,
    }
    assert catalog_api.incomplete.get("/api/auth/session").json()["capabilities"] == {
        "review_ingredient_requests": False,
        "moderate_recipe_reports": False,
    }

    with Session(bind=catalog_api.engine) as session, session.begin():
        grant = session.get(CatalogCurator, CURATOR_ID)
        assert grant is not None
        session.delete(grant)
        session.add(CatalogCurator(user_id=MEMBER_ID, granted_by_user_id=PEER_CURATOR_ID))

    assert catalog_api.curator.get("/api/auth/session").json()["capabilities"] == {
        "review_ingredient_requests": False,
        "moderate_recipe_reports": False,
    }
    assert catalog_api.member.get("/api/auth/session").json()["capabilities"] == {
        "review_ingredient_requests": True,
        "moderate_recipe_reports": False,
    }


def test_curator_queue_filters_pending_first_and_detail_surfaces_safe_candidates(
    catalog_api: CatalogApi,
) -> None:
    pending = _submit(
        catalog_api.member,
        "Chickpea flour",
        "Useful for a gluten-free batter.",
    )
    approved_request = _submit(catalog_api.other_member, "Chickpea meal")
    approved = _approve(
        catalog_api,
        approved_request["id"],
        canonical_name="Chickpea meal",
        aliases=["Ground chickpea meal"],
    )
    rejected = _submit(catalog_api.other_member, "Vague chickpea item")
    reject_response = catalog_api.curator.post(
        f"/api/ingredient-requests/{rejected['id']}/review",
        json={"decision": "reject", "reason": "The proposed name is not specific enough."},
    )
    duplicate = _submit(catalog_api.other_member, "Chickpea meal variation")
    duplicate_response = catalog_api.curator.post(
        f"/api/ingredient-requests/{duplicate['id']}/review",
        json={
            "decision": "duplicate",
            "reason": "The reviewed chickpea meal identity already covers this request.",
            "ingredient_id": approved["resolved_ingredient_id"],
            "request_id": None,
        },
    )
    assert reject_response.status_code == 200
    assert duplicate_response.status_code == 200

    queue = catalog_api.curator.get(
        "/api/ingredient-requests",
        params={"page": 1, "page_size": 20},
    )
    assert queue.status_code == 200
    queue_items = _json_object(queue.json())["items"]
    statuses = [item["status"] for item in queue_items]
    first_terminal = next(
        (index for index, request_status in enumerate(statuses) if request_status != "pending"),
        len(statuses),
    )
    assert all(request_status == "pending" for request_status in statuses[:first_terminal])
    assert pending["id"] in [item["id"] for item in queue_items[:first_terminal]]

    approved_name_search = catalog_api.curator.get(
        "/api/ingredient-requests",
        params={
            "status": "approved",
            "q": "ground chickpea",
            "page": 1,
            "page_size": 1,
        },
    )
    assert approved_name_search.status_code == 200
    approved_name_page = _json_object(approved_name_search.json())
    assert approved_name_page["total"] == 1
    assert approved_name_page["total_pages"] == 1
    assert [item["id"] for item in approved_name_page["items"]] == [approved_request["id"]]

    literal_wildcard = catalog_api.curator.get(
        "/api/ingredient-requests",
        params={"q": "%", "page_size": 100},
    )
    assert literal_wildcard.status_code == 200
    assert _json_object(literal_wildcard.json())["items"] == []
    for invalid_q in ("", "x" * 101):
        assert (
            catalog_api.curator.get(
                "/api/ingredient-requests",
                params={"q": invalid_q},
            ).status_code
            == 422
        )
    assert (
        catalog_api.anonymous.get(
            "/api/ingredient-requests",
            params={"q": "chickpea"},
        ).status_code
        == 401
    )
    assert (
        catalog_api.other_member.get(
            "/api/ingredient-requests",
            params={"q": "chickpea"},
        ).status_code
        == 403
    )

    expected_ids = {
        "pending": pending["id"],
        "approved": approved_request["id"],
        "rejected": rejected["id"],
        "duplicate": duplicate["id"],
    }
    for request_status, expected_id in expected_ids.items():
        filtered = catalog_api.curator.get(
            "/api/ingredient-requests",
            params={"status": request_status, "page": 1, "page_size": 1},
        )
        assert filtered.status_code == 200
        filtered_body = _json_object(filtered.json())
        assert filtered_body["items"][0]["id"] == expected_id
        assert filtered_body["items"][0]["status"] == request_status
        assert filtered_body["page_size"] == 1

    detail_path = f"/api/ingredient-requests/{pending['id']}/review"
    assert catalog_api.anonymous.get(detail_path).status_code == 401
    forbidden = catalog_api.other_member.get(detail_path)
    assert forbidden.status_code == 403
    assert _json_object(forbidden.json())["error"]["code"] == "catalog_curator_required"

    detail_response = catalog_api.curator.get(detail_path)
    assert detail_response.status_code == 200
    assert detail_response.headers["cache-control"] == "private, no-store"
    detail = _json_object(detail_response.json())
    assert detail["requester"] == {
        "id": str(MEMBER_ID),
        "handle": "catalog_member",
        "display_name": "Catalog Member",
    }
    assert "@" not in detail_response.text
    chickpea_candidates = [
        candidate
        for candidate in detail["catalog_candidates"]
        if candidate["id"] == str(CHICKPEA_ID)
    ]
    assert chickpea_candidates == [
        {
            "id": str(CHICKPEA_ID),
            "canonical_name": "Chickpea",
            "aliases": ["Garbanzo bean", "Garbanzo beans"],
        }
    ]
    related = {candidate["id"]: candidate for candidate in detail["request_candidates"]}
    assert related[approved_request["id"]]["status"] == "approved"
    assert related[approved_request["id"]]["approved_canonical_name"] == "Chickpea meal"
    assert all(candidate["status"] in {"pending", "approved"} for candidate in related.values())
    assert detail["updated_at"]


def test_catalog_openapi_documents_stable_ids_requests_and_curator_review(
    catalog_api: CatalogApi,
) -> None:
    document = _json_object(catalog_api.anonymous.get("/openapi.json").json())
    paths = cast(dict[str, Any], document["paths"])
    schemas = cast(dict[str, Any], cast(dict[str, Any], document["components"])["schemas"])

    assert set(paths["/api/ingredients"]) == {"get"}
    assert set(paths["/api/ingredient-requests"]) == {"get", "post"}
    assert set(paths["/api/ingredient-requests/mine"]) == {"get"}
    assert set(paths["/api/ingredient-requests/{request_id}"]) == {"get"}
    assert set(paths["/api/ingredient-requests/{request_id}/review"]) == {"get", "post"}
    queue_parameters = {
        parameter["name"]: parameter
        for parameter in paths["/api/ingredient-requests"]["get"]["parameters"]
    }
    query_variants = queue_parameters["q"]["schema"]["anyOf"]
    query_schema = next(variant for variant in query_variants if variant.get("type") == "string")
    assert query_schema["maxLength"] == 100
    mine_parameters = {
        parameter["name"]: parameter
        for parameter in paths["/api/ingredient-requests/mine"]["get"]["parameters"]
    }
    mine_query_variants = mine_parameters["q"]["schema"]["anyOf"]
    mine_query_schema = next(
        variant for variant in mine_query_variants if variant.get("type") == "string"
    )
    assert mine_query_schema["maxLength"] == 100
    mine_status_variants = mine_parameters["status"]["schema"]["anyOf"]
    mine_status_schema = next(variant for variant in mine_status_variants if "enum" in variant)
    assert set(mine_status_schema["enum"]) == {
        "pending",
        "approved",
        "rejected",
        "duplicate",
    }
    assert mine_parameters["page_size"]["schema"]["maximum"] == 100
    catalog_item = schemas["IngredientCatalogItem"]["properties"]
    assert "Stable curated ingredient identity" in catalog_item["id"]["description"]
    member_request = schemas["MemberIngredientCatalogRequestResponse"]["properties"]
    assert set(member_request["status"]["enum"]) == {
        "pending",
        "approved",
        "rejected",
        "duplicate",
    }
    resolution_variants = member_request["resolved_ingredient"]["anyOf"]
    assert {"$ref": "#/components/schemas/IngredientCatalogItem"} in resolution_variants
    assert "never becomes selectable" in member_request["resolved_ingredient"]["description"]
