from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from alembic import command
from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import Engine, delete, func, select, update
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.core.security import AUTH_SESSION_COOKIE_NAME
from app.main import create_app
from app.models import (
    USER_STATUS_SUSPENDED,
    CatalogCurator,
    CommunityModerator,
    RecipeLineage,
    RecipeModerationAuditEvent,
    RecipeModerationCase,
    RecipeReport,
    RecipeVersion,
    RecipeVersionPublication,
    User,
)
from app.schemas.recipe_publications import RecipeOriginalPublicationRequest
from tests.conftest import make_alembic_config
from tests.member_session import (
    MemberCredentials,
    authenticate_client,
    create_member_credentials,
)

AUTHOR_ID = UUID("7f000000-0000-4000-8000-000000000001")
REPORTER_A_ID = UUID("7f000000-0000-4000-8000-000000000002")
REPORTER_B_ID = UUID("7f000000-0000-4000-8000-000000000003")
MODERATOR_ID = UUID("7f000000-0000-4000-8000-000000000004")
ORDINARY_ID = UUID("7f000000-0000-4000-8000-000000000005")
CURATOR_ID = UUID("7f000000-0000-4000-8000-000000000006")
INCOMPLETE_ID = UUID("7f000000-0000-4000-8000-000000000007")

PUBLIC_LINEAGE_ID = UUID("7f000000-0000-4000-8000-000000000101")
PUBLIC_RECIPE_ID = UUID("7f000000-0000-4000-8000-000000000102")
SECOND_LINEAGE_ID = UUID("7f000000-0000-4000-8000-000000000111")
SECOND_RECIPE_ID = UUID("7f000000-0000-4000-8000-000000000112")
WITHDRAWN_LINEAGE_ID = UUID("7f000000-0000-4000-8000-000000000121")
WITHDRAWN_RECIPE_ID = UUID("7f000000-0000-4000-8000-000000000122")
PRIVATE_LINEAGE_ID = UUID("7f000000-0000-4000-8000-000000000131")
PRIVATE_RECIPE_ID = UUID("7f000000-0000-4000-8000-000000000132")


@dataclass(frozen=True, slots=True)
class ModerationApi:
    application: FastAPI
    engine: Engine
    anonymous: TestClient
    author: TestClient
    reporter_a: TestClient
    reporter_b: TestClient
    moderator: TestClient
    ordinary: TestClient
    curator: TestClient
    incomplete: TestClient
    reporter_a_credentials: MemberCredentials


def _json_object(value: object) -> dict[str, Any]:
    return cast(dict[str, Any], value)


def _add_recipe(
    session: Session,
    *,
    lineage_id: UUID,
    recipe_id: UUID,
    title: str,
    created_at: datetime,
    published: bool,
    withdrawn: bool = False,
) -> None:
    session.add(
        RecipeLineage(
            id=lineage_id,
            created_by_user_id=AUTHOR_ID,
            created_at=created_at,
        )
    )
    session.flush()
    session.add(
        RecipeVersion(
            id=recipe_id,
            lineage_id=lineage_id,
            parent_version_id=None,
            created_by_user_id=AUTHOR_ID,
            version_number=1,
            title=title,
            description=f"Public description for {title}.",
            servings=Decimal("4.00"),
            created_at=created_at,
        )
    )
    session.flush()
    if not published:
        return
    withdrawn_at = created_at + timedelta(minutes=1) if withdrawn else None
    session.add(
        RecipeVersionPublication(
            recipe_version_id=recipe_id,
            actor_user_id=AUTHOR_ID,
            state="author_withdrawn" if withdrawn else "published",
            author_withdrawn_at=withdrawn_at,
            state_changed_at=withdrawn_at or created_at,
            state_changed_by_user_id=AUTHOR_ID,
            published_at=created_at,
            community_rules_version="community-rules-v1",
            publication_rights_confirmed_at=created_at,
        )
    )


@pytest.fixture
def moderation_api(empty_postgres_engine: Engine) -> Iterator[ModerationApi]:
    config = make_alembic_config()
    with empty_postgres_engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")

    credentials = {
        "author": create_member_credentials(
            empty_postgres_engine,
            user_id=AUTHOR_ID,
            handle="moderation-author",
            display_name="Moderation Author",
        ),
        "reporter_a": create_member_credentials(
            empty_postgres_engine,
            user_id=REPORTER_A_ID,
            handle="reporter-alpha",
            display_name="Reporter Alpha",
        ),
        "reporter_b": create_member_credentials(
            empty_postgres_engine,
            user_id=REPORTER_B_ID,
            handle="reporter-bravo",
            display_name="Reporter Bravo",
        ),
        "moderator": create_member_credentials(
            empty_postgres_engine,
            user_id=MODERATOR_ID,
            handle="recipe-moderator",
            display_name="Recipe Moderator",
        ),
        "ordinary": create_member_credentials(
            empty_postgres_engine,
            user_id=ORDINARY_ID,
            handle="ordinary-member",
            display_name="Ordinary Member",
        ),
        "curator": create_member_credentials(
            empty_postgres_engine,
            user_id=CURATOR_ID,
            handle="catalog-only-curator",
            display_name="Catalog Only Curator",
        ),
        "incomplete": create_member_credentials(
            empty_postgres_engine,
            user_id=INCOMPLETE_ID,
            handle=None,
            display_name="Incomplete Member",
        ),
    }
    start = datetime(2026, 8, 26, 18, 0, tzinfo=UTC)
    with Session(bind=empty_postgres_engine) as session, session.begin():
        session.add(CommunityModerator(user_id=MODERATOR_ID, granted_by_user_id=AUTHOR_ID))
        session.add(CatalogCurator(user_id=CURATOR_ID, granted_by_user_id=AUTHOR_ID))
        _add_recipe(
            session,
            lineage_id=PUBLIC_LINEAGE_ID,
            recipe_id=PUBLIC_RECIPE_ID,
            title="Reported public recipe",
            created_at=start,
            published=True,
        )
        _add_recipe(
            session,
            lineage_id=SECOND_LINEAGE_ID,
            recipe_id=SECOND_RECIPE_ID,
            title="Second reported recipe",
            created_at=start + timedelta(minutes=10),
            published=True,
        )
        _add_recipe(
            session,
            lineage_id=WITHDRAWN_LINEAGE_ID,
            recipe_id=WITHDRAWN_RECIPE_ID,
            title="Already withdrawn recipe",
            created_at=start + timedelta(minutes=20),
            published=True,
            withdrawn=True,
        )
        _add_recipe(
            session,
            lineage_id=PRIVATE_LINEAGE_ID,
            recipe_id=PRIVATE_RECIPE_ID,
            title="Never published recipe",
            created_at=start + timedelta(minutes=30),
            published=False,
        )

    application = create_app()

    def override_session() -> Iterator[Session]:
        with Session(bind=empty_postgres_engine, expire_on_commit=False) as session:
            yield session

    application.dependency_overrides[get_session] = override_session
    try:
        with (
            TestClient(application) as anonymous,
            TestClient(application) as author,
            TestClient(application) as reporter_a,
            TestClient(application) as reporter_b,
            TestClient(application) as moderator,
            TestClient(application) as ordinary,
            TestClient(application) as curator,
            TestClient(application) as incomplete,
        ):
            clients = {
                "author": author,
                "reporter_a": reporter_a,
                "reporter_b": reporter_b,
                "moderator": moderator,
                "ordinary": ordinary,
                "curator": curator,
                "incomplete": incomplete,
            }
            for name, client in clients.items():
                authenticate_client(client, credentials[name])
            yield ModerationApi(
                application=application,
                engine=empty_postgres_engine,
                anonymous=anonymous,
                author=author,
                reporter_a=reporter_a,
                reporter_b=reporter_b,
                moderator=moderator,
                ordinary=ordinary,
                curator=curator,
                incomplete=incomplete,
                reporter_a_credentials=credentials["reporter_a"],
            )
    finally:
        application.dependency_overrides.clear()


def _report(
    client: TestClient,
    recipe_id: UUID,
    *,
    action_id: UUID | None = None,
    reason: str = "spam",
    details: str | None = "Private report evidence.",
) -> Response:
    return cast(
        Response,
        client.post(
            f"/api/recipes/{recipe_id}/reports",
            headers={"Idempotency-Key": str(action_id or uuid4())},
            json={"reason": reason, "details": details},
        ),
    )


def _moderate(
    client: TestClient,
    recipe_id: UUID,
    *,
    action: str,
    action_id: UUID | None = None,
    note: str | None = None,
) -> Response:
    return cast(
        Response,
        client.post(
            f"/api/moderation/recipe-reports/{recipe_id}/actions",
            headers={"Idempotency-Key": str(action_id or uuid4())},
            json={"action": action, "private_note": note},
        ),
    )


def test_report_endpoint_enforces_auth_csrf_onboarding_and_schema_bounds(
    moderation_api: ModerationApi,
) -> None:
    action_id = str(uuid4())
    anonymous = moderation_api.anonymous.post(
        f"/api/recipes/{PUBLIC_RECIPE_ID}/reports",
        headers={"Idempotency-Key": action_id},
        json={"reason": "spam"},
    )
    assert anonymous.status_code == 401

    incomplete = _report(moderation_api.incomplete, PUBLIC_RECIPE_ID)
    assert incomplete.status_code == 403
    assert _json_object(_json_object(incomplete.json())["error"])["code"] == (
        "account_setup_required"
    )

    with TestClient(moderation_api.application) as no_csrf:
        no_csrf.cookies.set(
            AUTH_SESSION_COOKIE_NAME,
            moderation_api.reporter_a_credentials.session_token,
        )
        rejected = no_csrf.post(
            f"/api/recipes/{PUBLIC_RECIPE_ID}/reports",
            headers={"Idempotency-Key": action_id},
            json={"reason": "spam"},
        )
    assert rejected.status_code == 403
    assert _json_object(_json_object(rejected.json())["error"])["code"] == "invalid_csrf"

    for payload in (
        {"reason": "unsupported"},
        {"reason": "spam", "details": "x" * 1_001},
        {"reason": "spam", "details": "unsafe\x00detail"},
        {"reason": "spam", "unexpected": True},
    ):
        response = moderation_api.reporter_a.post(
            f"/api/recipes/{PUBLIC_RECIPE_ID}/reports",
            headers={"Idempotency-Key": str(uuid4())},
            json=payload,
        )
        assert response.status_code == 422


def test_report_is_idempotent_once_per_member_and_recipe_and_private(
    moderation_api: ModerationApi,
) -> None:
    action_id = uuid4()
    created = _report(
        moderation_api.reporter_a,
        PUBLIC_RECIPE_ID,
        action_id=action_id,
        reason="harassment",
        details="Reporter Alpha private evidence must never become public.",
    )
    assert created.status_code == 201, created.text
    assert created.headers["cache-control"] == "private, no-store"
    assert "Cookie" in {value.strip() for value in created.headers["vary"].split(",")}
    receipt = _json_object(created.json())
    assert set(receipt) == {"id", "recipe_version_id", "submitted_at"}
    assert receipt["recipe_version_id"] == str(PUBLIC_RECIPE_ID)
    assert created.headers["location"].endswith(f"/reports/{receipt['id']}")

    exact_retry = _report(
        moderation_api.reporter_a,
        PUBLIC_RECIPE_ID,
        action_id=action_id,
        reason="harassment",
        details="Reporter Alpha private evidence must never become public.",
    )
    assert exact_retry.status_code == 200
    assert exact_retry.json() == created.json()

    conflicting_key = _report(
        moderation_api.reporter_a,
        PUBLIC_RECIPE_ID,
        action_id=action_id,
        reason="spam",
        details="Different request.",
    )
    assert conflicting_key.status_code == 409
    assert _json_object(_json_object(conflicting_key.json())["error"])["code"] == (
        "idempotency_key_conflict"
    )

    duplicate = _report(
        moderation_api.reporter_a,
        PUBLIC_RECIPE_ID,
        reason="harassment",
        details="A second operation for the same recipe.",
    )
    assert duplicate.status_code == 409
    assert _json_object(_json_object(duplicate.json())["error"])["code"] == (
        "recipe_already_reported"
    )

    public_detail = moderation_api.anonymous.get(f"/api/recipes/{PUBLIC_RECIPE_ID}")
    assert public_detail.status_code == 200
    assert "private evidence" not in public_detail.text.casefold()
    assert "reporter-alpha" not in public_detail.text.casefold()
    assert str(REPORTER_A_ID) not in public_detail.text

    with Session(bind=moderation_api.engine) as session:
        assert session.scalar(select(func.count()).select_from(RecipeReport)) == 1
        report = session.scalar(select(RecipeReport))
        moderation_case = session.get(RecipeModerationCase, PUBLIC_RECIPE_ID)
        assert report is not None
        assert report.details == "Reporter Alpha private evidence must never become public."
        assert moderation_case is not None
        assert moderation_case.reporter_count == 1


def test_reports_accept_blank_details_but_only_currently_public_recipes(
    moderation_api: ModerationApi,
) -> None:
    blank = _report(
        moderation_api.reporter_b,
        SECOND_RECIPE_ID,
        details="   ",
    )
    assert blank.status_code == 201
    with Session(bind=moderation_api.engine) as session:
        report = session.scalar(
            select(RecipeReport).where(RecipeReport.recipe_version_id == SECOND_RECIPE_ID)
        )
        assert report is not None
        assert report.details is None

    for recipe_id in (WITHDRAWN_RECIPE_ID, PRIVATE_RECIPE_ID, uuid4()):
        response = _report(moderation_api.reporter_a, recipe_id)
        assert response.status_code == 404
        error = _json_object(_json_object(response.json())["error"])
        assert error == {
            "code": "recipe_not_found",
            "message": "The recipe was not found or is not publicly available.",
            "issues": [],
        }


def test_queue_is_moderator_only_aggregate_and_reporter_deidentified(
    moderation_api: ModerationApi,
) -> None:
    first = _report(
        moderation_api.reporter_a,
        PUBLIC_RECIPE_ID,
        reason="spam",
        details="Alpha private network detail.",
    )
    second = _report(
        moderation_api.reporter_b,
        PUBLIC_RECIPE_ID,
        reason="harassment",
        details="Bravo private context.",
    )
    assert first.status_code == second.status_code == 201

    assert moderation_api.anonymous.get("/api/moderation/recipe-reports").status_code == 401
    for client in (moderation_api.ordinary, moderation_api.curator):
        denied = client.get("/api/moderation/recipe-reports")
        assert denied.status_code == 403
        assert _json_object(_json_object(denied.json())["error"])["code"] == (
            "recipe_moderator_required"
        )

    moderator_session = moderation_api.moderator.get("/api/auth/session")
    curator_session = moderation_api.curator.get("/api/auth/session")
    assert moderator_session.json()["capabilities"]["moderate_recipe_reports"] is True
    assert curator_session.json()["capabilities"] == {
        "review_ingredient_requests": True,
        "moderate_recipe_reports": False,
    }

    queue = moderation_api.moderator.get(
        "/api/moderation/recipe-reports",
        params={"page": 1, "page_size": 1, "status": "open"},
    )
    assert queue.status_code == 200, queue.text
    assert queue.headers["cache-control"] == "private, no-store"
    assert "Cookie" in {value.strip() for value in queue.headers["vary"].split(",")}
    body = _json_object(queue.json())
    assert body["total"] == body["total_pages"] == 1
    item = cast(list[dict[str, Any]], body["items"])[0]
    assert item["recipe_version_id"] == str(PUBLIC_RECIPE_ID)
    assert item["reporter_count"] == 2
    assert item["visibility_state"] == "published"
    assert set(cast(dict[str, Any], item["author"])) == {"id", "handle", "display_name"}
    assert "private" not in queue.text.casefold()
    assert str(REPORTER_A_ID) not in queue.text
    assert str(REPORTER_B_ID) not in queue.text

    detail = moderation_api.moderator.get(f"/api/moderation/recipe-reports/{PUBLIC_RECIPE_ID}")
    assert detail.status_code == 200, detail.text
    detail_body = _json_object(detail.json())
    assert detail_body["reason_counts"] == [
        {"reason": "harassment", "count": 1},
        {"reason": "spam", "count": 1},
    ]
    reports = cast(list[dict[str, Any]], detail_body["reports"])
    assert len(reports) == 2
    assert all(set(report) == {"id", "reason", "details", "submitted_at"} for report in reports)
    assert {report["details"] for report in reports} == {
        "Alpha private network detail.",
        "Bravo private context.",
    }
    assert detail_body["reports_total"] == 2
    assert detail_body["reports_truncated"] is False
    assert detail_body["history"] == []
    for forbidden in (
        str(REPORTER_A_ID),
        str(REPORTER_B_ID),
        "reporter-alpha",
        "reporter-bravo",
        f"{REPORTER_A_ID}@test.invalid",
    ):
        assert forbidden not in detail.text


def test_revocation_and_suspension_remove_moderator_access_immediately(
    moderation_api: ModerationApi,
) -> None:
    assert _report(moderation_api.reporter_a, PUBLIC_RECIPE_ID).status_code == 201
    assert moderation_api.moderator.get("/api/moderation/recipe-reports").status_code == 200

    with Session(bind=moderation_api.engine) as session, session.begin():
        session.execute(
            delete(CommunityModerator).where(CommunityModerator.user_id == MODERATOR_ID)
        )
    revoked = moderation_api.moderator.get("/api/moderation/recipe-reports")
    assert revoked.status_code == 403
    assert _json_object(_json_object(revoked.json())["error"])["code"] == (
        "recipe_moderator_required"
    )

    with Session(bind=moderation_api.engine) as session, session.begin():
        session.add(CommunityModerator(user_id=MODERATOR_ID, granted_by_user_id=AUTHOR_ID))
        moderator = session.get(User, MODERATOR_ID)
        assert moderator is not None
        moderator.status = USER_STATUS_SUSPENDED
    suspended = moderation_api.moderator.get("/api/moderation/recipe-reports")
    assert suspended.status_code == 401
    assert _json_object(_json_object(suspended.json())["error"])["code"] == (
        "authentication_required"
    )


def test_hide_restore_resolve_are_audited_idempotent_and_role_isolated(
    moderation_api: ModerationApi,
) -> None:
    assert _report(moderation_api.reporter_a, PUBLIC_RECIPE_ID).status_code == 201
    for client in (moderation_api.ordinary, moderation_api.curator):
        denied = _moderate(client, PUBLIC_RECIPE_ID, action="hide", note="unauthorized")
        assert denied.status_code == 403
        assert _json_object(_json_object(denied.json())["error"])["code"] == (
            "recipe_moderator_required"
        )

    hide_id = uuid4()
    hidden = _moderate(
        moderation_api.moderator,
        PUBLIC_RECIPE_ID,
        action="hide",
        action_id=hide_id,
        note="Private moderator rationale.",
    )
    assert hidden.status_code == 200, hidden.text
    hidden_body = _json_object(hidden.json())
    assert hidden_body["changed"] is True
    assert hidden_body["case_status"] == "open"
    assert hidden_body["visibility_state"] == "moderation_hidden"
    assert moderation_api.anonymous.get(f"/api/recipes/{PUBLIC_RECIPE_ID}").status_code == 404

    retry = _moderate(
        moderation_api.moderator,
        PUBLIC_RECIPE_ID,
        action="hide",
        action_id=hide_id,
        note="Private moderator rationale.",
    )
    assert retry.status_code == 200
    assert _json_object(retry.json())["changed"] is False
    assert _json_object(retry.json())["acted_at"] == hidden_body["acted_at"]

    conflict = _moderate(
        moderation_api.moderator,
        PUBLIC_RECIPE_ID,
        action="resolve",
        action_id=hide_id,
        note="Changed request.",
    )
    assert conflict.status_code == 409
    assert _json_object(_json_object(conflict.json())["error"])["code"] == (
        "idempotency_key_conflict"
    )
    duplicate_hide = _moderate(
        moderation_api.moderator,
        PUBLIC_RECIPE_ID,
        action="hide",
        note="Second hide is invalid.",
    )
    assert duplicate_hide.status_code == 409
    assert _json_object(_json_object(duplicate_hide.json())["error"])["code"] == (
        "moderation_action_conflict"
    )

    author_restore = moderation_api.author.put(
        f"/api/recipes/{PUBLIC_RECIPE_ID}/visibility",
        json={"state": "published"},
    )
    assert author_restore.status_code == 409
    assert _json_object(_json_object(author_restore.json())["error"])["code"] == (
        "recipe_visibility_managed_by_moderation"
    )

    restored = _moderate(
        moderation_api.moderator,
        PUBLIC_RECIPE_ID,
        action="restore",
        note="Review complete; restore public access.",
    )
    assert restored.status_code == 200
    assert _json_object(restored.json())["visibility_state"] == "published"
    assert moderation_api.anonymous.get(f"/api/recipes/{PUBLIC_RECIPE_ID}").status_code == 200

    resolved = _moderate(
        moderation_api.moderator,
        PUBLIC_RECIPE_ID,
        action="resolve",
        note="Case resolved after restoration.",
    )
    assert resolved.status_code == 200
    resolved_body = _json_object(resolved.json())
    assert resolved_body["case_status"] == "resolved"
    assert resolved_body["visibility_state"] == "published"
    second_resolve = _moderate(
        moderation_api.moderator,
        PUBLIC_RECIPE_ID,
        action="resolve",
    )
    assert second_resolve.status_code == 409

    detail = moderation_api.moderator.get(f"/api/moderation/recipe-reports/{PUBLIC_RECIPE_ID}")
    assert detail.status_code == 200
    history = cast(list[dict[str, Any]], _json_object(detail.json())["history"])
    assert [entry["action"] for entry in history] == ["resolve", "restore", "hide"]
    assert [entry["private_note"] for entry in history] == [
        "Case resolved after restoration.",
        "Review complete; restore public access.",
        "Private moderator rationale.",
    ]
    assert all(set(entry["actor"]) == {"id", "handle", "display_name"} for entry in history)
    assert all(entry["actor"]["id"] == str(MODERATOR_ID) for entry in history)
    assert "request_fingerprint" not in detail.text
    assert "action_id" not in detail.text

    with Session(bind=moderation_api.engine) as session:
        publication = session.get(RecipeVersionPublication, PUBLIC_RECIPE_ID)
        moderation_case = session.get(RecipeModerationCase, PUBLIC_RECIPE_ID)
        assert publication is not None
        assert publication.state == "published"
        assert publication.moderation_hidden_at is None
        assert publication.community_rules_version == "community-rules-v1"
        assert publication.publication_rights_confirmed_at is not None
        assert moderation_case is not None and moderation_case.status == "resolved"
        assert session.scalar(select(func.count()).select_from(RecipeModerationAuditEvent)) == 3


def test_moderator_restore_preserves_an_author_withdrawal(
    moderation_api: ModerationApi,
) -> None:
    assert _report(moderation_api.reporter_a, SECOND_RECIPE_ID).status_code == 201
    withdrawn = moderation_api.author.put(
        f"/api/recipes/{SECOND_RECIPE_ID}/visibility",
        json={"state": "author_withdrawn"},
    )
    assert withdrawn.status_code == 200
    assert _json_object(withdrawn.json())["state"] == "author_withdrawn"

    hidden = _moderate(
        moderation_api.moderator,
        SECOND_RECIPE_ID,
        action="hide",
        note="Moderation still evaluates withdrawn content.",
    )
    assert hidden.status_code == 200
    assert _json_object(hidden.json())["visibility_state"] == "moderation_hidden"
    restored = _moderate(
        moderation_api.moderator,
        SECOND_RECIPE_ID,
        action="restore",
        note="Remove only the moderation axis.",
    )
    assert restored.status_code == 200
    assert _json_object(restored.json())["visibility_state"] == "author_withdrawn"
    assert moderation_api.anonymous.get(f"/api/recipes/{SECOND_RECIPE_ID}").status_code == 404

    with Session(bind=moderation_api.engine) as session:
        publication = session.get(RecipeVersionPublication, SECOND_RECIPE_ID)
        assert publication is not None
        assert publication.state == "author_withdrawn"
        assert publication.author_withdrawn_at is not None
        assert publication.moderation_hidden_at is None


def test_moderation_audit_evidence_is_database_append_only(
    moderation_api: ModerationApi,
) -> None:
    assert _report(moderation_api.reporter_a, PUBLIC_RECIPE_ID).status_code == 201
    assert (
        _moderate(
            moderation_api.moderator,
            PUBLIC_RECIPE_ID,
            action="hide",
            note="Preserve this moderation evidence.",
        ).status_code
        == 200
    )

    with Session(bind=moderation_api.engine) as session:
        event_id = session.scalar(select(RecipeModerationAuditEvent.id))
        assert event_id is not None

    with moderation_api.engine.begin() as connection:
        with pytest.raises(DBAPIError):
            with connection.begin_nested():
                connection.execute(
                    update(RecipeModerationAuditEvent)
                    .where(RecipeModerationAuditEvent.id == event_id)
                    .values(private_note="Tampered evidence.")
                )

    with moderation_api.engine.begin() as connection:
        with pytest.raises(DBAPIError):
            with connection.begin_nested():
                connection.execute(
                    delete(RecipeModerationAuditEvent).where(
                        RecipeModerationAuditEvent.id == event_id
                    )
                )

    with Session(bind=moderation_api.engine) as session:
        event = session.get(RecipeModerationAuditEvent, event_id)
        assert event is not None
        assert event.private_note == "Preserve this moderation evidence."


def test_publication_attestation_evidence_must_remain_a_complete_pair(
    moderation_api: ModerationApi,
) -> None:
    with Session(bind=moderation_api.engine) as session:
        publication = session.get(RecipeVersionPublication, PUBLIC_RECIPE_ID)
        assert publication is not None
        assert publication.community_rules_version == "community-rules-v1"
        assert publication.publication_rights_confirmed_at is not None

        with pytest.raises(IntegrityError):
            with session.begin_nested():
                publication.community_rules_version = None
                session.flush()
        session.refresh(publication)

        with pytest.raises(IntegrityError):
            with session.begin_nested():
                publication.publication_rights_confirmed_at = None
                session.flush()
        session.refresh(publication)

        assert publication.community_rules_version == "community-rules-v1"
        assert publication.publication_rights_confirmed_at is not None


def test_publication_contract_requires_both_community_attestations() -> None:
    base = {
        "revision": 1,
        "duplicate_review": {
            "preflight_id": str(uuid4()),
            "policy_version": "recipe-duplicate-policy-v1",
            "result_digest": "a" * 64,
            "decision": None,
        },
    }
    for payload in (
        base,
        {**base, "community_rules_accepted": True},
        {**base, "content_rights_confirmed": True},
        {
            **base,
            "community_rules_accepted": False,
            "content_rights_confirmed": True,
        },
        {
            **base,
            "community_rules_accepted": True,
            "content_rights_confirmed": False,
        },
    ):
        with pytest.raises(ValueError):
            RecipeOriginalPublicationRequest.model_validate(payload)

    accepted = RecipeOriginalPublicationRequest.model_validate(
        {
            **base,
            "community_rules_accepted": True,
            "content_rights_confirmed": True,
        }
    )
    assert accepted.community_rules_accepted is True
    assert accepted.content_rights_confirmed is True
