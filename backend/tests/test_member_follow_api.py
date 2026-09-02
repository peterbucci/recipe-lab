from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any, cast
from uuid import UUID

import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.main import create_app
from app.models import (
    RECIPE_PUBLICATION_STATE_MODERATION_HIDDEN,
    RECIPE_PUBLICATION_STATE_PUBLISHED,
    USER_STATUS_SUSPENDED,
    RecipeLineage,
    RecipeVersion,
    RecipeVersionPublication,
    User,
)
from tests.conftest import make_alembic_config
from tests.member_session import authenticate_client, create_member_credentials

MEMBER_A_ID = UUID("8a000000-0000-4000-8000-000000000001")
MEMBER_B_ID = UUID("8a000000-0000-4000-8000-000000000002")
MEMBER_C_ID = UUID("8a000000-0000-4000-8000-000000000003")


def _store_recipe_publication(
    session: Session,
    *,
    author_id: UUID,
    lineage_id: UUID,
    recipe_id: UUID,
    title: str,
    published_at: datetime,
    parent_version_id: UUID | None = None,
    state: str = RECIPE_PUBLICATION_STATE_PUBLISHED,
    version_number: int = 1,
) -> None:
    if parent_version_id is None:
        session.add(RecipeLineage(id=lineage_id, created_by_user_id=author_id))
        session.flush()
    session.add(
        RecipeVersion(
            id=recipe_id,
            lineage_id=lineage_id,
            parent_version_id=parent_version_id,
            created_by_user_id=author_id,
            version_number=version_number,
            title=title,
            description=None,
            servings=Decimal("4.00"),
        )
    )
    session.flush()
    session.add(
        RecipeVersionPublication(
            recipe_version_id=recipe_id,
            state=state,
            state_changed_at=published_at,
            state_changed_by_user_id=author_id,
            actor_user_id=author_id,
            published_at=published_at,
            moderation_hidden_at=(
                published_at if state == RECIPE_PUBLICATION_STATE_MODERATION_HIDDEN else None
            ),
        )
    )
    session.flush()


@dataclass(frozen=True, slots=True)
class FollowApi:
    engine: Engine
    anonymous: TestClient
    member_a: TestClient
    member_b: TestClient
    member_c: TestClient


def _json_object(value: object) -> dict[str, Any]:
    return cast(dict[str, Any], value)


@pytest.fixture
def follow_api(empty_postgres_engine: Engine) -> Iterator[FollowApi]:
    config = make_alembic_config()
    with empty_postgres_engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")

    member_a = create_member_credentials(
        empty_postgres_engine,
        user_id=MEMBER_A_ID,
        handle="member_alpha",
        display_name="Member Alpha",
    )
    member_b = create_member_credentials(
        empty_postgres_engine,
        user_id=MEMBER_B_ID,
        handle="member_bravo",
        display_name="Member Bravo",
    )
    member_c = create_member_credentials(
        empty_postgres_engine,
        user_id=MEMBER_C_ID,
        handle="member_charlie",
        display_name="Member Charlie",
    )

    app = create_app()

    def session_override() -> Iterator[Session]:
        with Session(bind=empty_postgres_engine) as session:
            yield session

    app.dependency_overrides[get_session] = session_override
    with (
        TestClient(app) as anonymous,
        TestClient(app) as client_a,
        TestClient(app) as client_b,
        TestClient(app) as client_c,
    ):
        authenticate_client(client_a, member_a)
        authenticate_client(client_b, member_b)
        authenticate_client(client_c, member_c)
        yield FollowApi(
            engine=empty_postgres_engine,
            anonymous=anonymous,
            member_a=client_a,
            member_b=client_b,
            member_c=client_c,
        )


def test_follow_and_unfollow_are_idempotent_and_update_both_members(
    follow_api: FollowApi,
) -> None:
    initial = follow_api.member_a.get("/api/cooks/MEMBER_BRAVO/follow")
    assert initial.status_code == 200
    assert initial.headers["cache-control"] == "private, no-store"
    assert "Cookie" in initial.headers["vary"]
    assert initial.json() == {
        "cook_id": str(MEMBER_B_ID),
        "following": False,
        "follower_count": 0,
    }

    for _attempt in range(2):
        followed = follow_api.member_a.put("/api/cooks/member_bravo/follow")
        assert followed.status_code == 200
        assert followed.json() == {
            "cook_id": str(MEMBER_B_ID),
            "following": True,
            "follower_count": 1,
        }

    assert follow_api.member_a.get("/api/my/follow-stats").json() == {
        "follower_count": 0,
        "following_count": 1,
    }
    assert follow_api.member_b.get("/api/my/follow-stats").json() == {
        "follower_count": 1,
        "following_count": 0,
    }
    public_profile = _json_object(follow_api.anonymous.get("/api/cooks/member_bravo").json())
    assert public_profile["follower_count"] == 1

    for _attempt in range(2):
        unfollowed = follow_api.member_a.delete("/api/cooks/member_bravo/follow")
        assert unfollowed.status_code == 200
        assert unfollowed.json() == {
            "cook_id": str(MEMBER_B_ID),
            "following": False,
            "follower_count": 0,
        }

    assert follow_api.member_a.get("/api/my/follow-stats").json()["following_count"] == 0
    assert follow_api.member_b.get("/api/my/follow-stats").json()["follower_count"] == 0


def test_follow_requires_membership_csrf_and_a_different_existing_cook(
    follow_api: FollowApi,
) -> None:
    assert follow_api.anonymous.get("/api/cooks/member_bravo/follow").status_code == 401
    assert follow_api.anonymous.put("/api/cooks/member_bravo/follow").status_code == 401

    csrf_missing = TestClient(follow_api.member_a.app)
    session_cookie = follow_api.member_a.cookies.get("recipe_lab_session")
    assert session_cookie is not None
    csrf_missing.cookies.set("recipe_lab_session", session_cookie)
    assert csrf_missing.put("/api/cooks/member_bravo/follow").status_code == 403

    self_follow = follow_api.member_a.put("/api/cooks/member_alpha/follow")
    assert self_follow.status_code == 409
    assert _json_object(_json_object(self_follow.json())["error"])["code"] == ("cannot_follow_self")
    assert follow_api.member_a.put("/api/cooks/missing_cook/follow").status_code == 404


def test_my_followers_is_private_paginated_and_limited_to_active_public_identities(
    follow_api: FollowApi,
) -> None:
    assert follow_api.anonymous.get("/api/my/followers").status_code == 401

    empty = follow_api.member_b.get("/api/my/followers")
    assert empty.status_code == 200
    assert empty.headers["cache-control"] == "private, no-store"
    assert "Cookie" in empty.headers["vary"]
    assert empty.json() == {
        "items": [],
        "page": 1,
        "page_size": 20,
        "total": 0,
        "total_pages": 0,
    }

    assert follow_api.member_a.put("/api/cooks/member_bravo/follow").status_code == 200
    assert follow_api.member_c.put("/api/cooks/member_bravo/follow").status_code == 200

    pages = [
        _json_object(
            follow_api.member_b.get(
                "/api/my/followers",
                params={"page": page, "page_size": 1},
            ).json()
        )
        for page in (1, 2)
    ]
    assert [page["page"] for page in pages] == [1, 2]
    assert all(page["page_size"] == 1 for page in pages)
    assert all(page["total"] == 2 for page in pages)
    assert all(page["total_pages"] == 2 for page in pages)

    items = [
        cast(dict[str, Any], item) for page in pages for item in cast(list[object], page["items"])
    ]
    assert {_json_object(item["follower"])["handle"] for item in items} == {
        "member_alpha",
        "member_charlie",
    }
    for item in items:
        follower = _json_object(item["follower"])
        assert set(follower) == {"id", "handle", "display_name"}
        assert "email" not in follower
        assert "session" not in follower
        datetime.fromisoformat(cast(str, item["followed_at"]))

    with Session(bind=follow_api.engine) as session, session.begin():
        suspended = session.get(User, MEMBER_C_ID)
        assert suspended is not None
        suspended.status = USER_STATUS_SUSPENDED

    filtered = _json_object(follow_api.member_b.get("/api/my/followers").json())
    assert filtered["total"] == 1
    filtered_items = cast(list[dict[str, object]], filtered["items"])
    assert [_json_object(item["follower"])["handle"] for item in filtered_items] == ["member_alpha"]
    assert follow_api.member_b.get("/api/my/follow-stats").json()["follower_count"] == 1
    assert follow_api.anonymous.get("/api/cooks/member_bravo").json()["follower_count"] == 1


def test_my_community_activity_contains_only_publications_from_followed_cooks(
    follow_api: FollowApi,
) -> None:
    assert follow_api.anonymous.get("/api/my/community-activity").status_code == 401
    assert follow_api.member_a.put("/api/cooks/member_bravo/follow").status_code == 200

    followed_lineage_id = UUID("8b000000-0000-4000-8000-000000000001")
    followed_original_id = UUID("8b000000-0000-4000-8000-000000000002")
    followed_version_id = UUID("8b000000-0000-4000-8000-000000000003")
    now = datetime(2026, 8, 30, 18, 0, tzinfo=UTC)
    with Session(bind=follow_api.engine) as session, session.begin():
        _store_recipe_publication(
            session,
            author_id=MEMBER_B_ID,
            lineage_id=followed_lineage_id,
            recipe_id=followed_original_id,
            title="Followed original",
            published_at=now - timedelta(days=1),
        )
        _store_recipe_publication(
            session,
            author_id=MEMBER_B_ID,
            lineage_id=followed_lineage_id,
            recipe_id=followed_version_id,
            title="Followed version",
            published_at=now,
            parent_version_id=followed_original_id,
            version_number=2,
        )
        _store_recipe_publication(
            session,
            author_id=MEMBER_C_ID,
            lineage_id=UUID("8c000000-0000-4000-8000-000000000001"),
            recipe_id=UUID("8c000000-0000-4000-8000-000000000002"),
            title="Unfollowed recipe",
            published_at=now + timedelta(hours=2),
        )
        _store_recipe_publication(
            session,
            author_id=MEMBER_A_ID,
            lineage_id=UUID("8d000000-0000-4000-8000-000000000001"),
            recipe_id=UUID("8d000000-0000-4000-8000-000000000002"),
            title="Viewer's own recipe",
            published_at=now + timedelta(hours=1),
        )
        _store_recipe_publication(
            session,
            author_id=MEMBER_B_ID,
            lineage_id=UUID("8e000000-0000-4000-8000-000000000001"),
            recipe_id=UUID("8e000000-0000-4000-8000-000000000002"),
            title="Hidden followed recipe",
            published_at=now + timedelta(hours=3),
            state=RECIPE_PUBLICATION_STATE_MODERATION_HIDDEN,
        )

    first = follow_api.member_a.get(
        "/api/my/community-activity",
        params={"page": 1, "page_size": 1},
    )
    assert first.status_code == 200
    assert first.headers["cache-control"] == "private, no-store"
    assert "Cookie" in first.headers["vary"]
    first_page = _json_object(first.json())
    assert first_page["total"] == 2
    assert first_page["total_pages"] == 2
    first_items = cast(list[dict[str, Any]], first_page["items"])
    assert [item["title"] for item in first_items] == ["Followed version"]
    assert first_items[0]["parent_version_id"] == str(followed_original_id)
    assert _json_object(first_items[0]["author"])["handle"] == "member_bravo"

    second_page = _json_object(
        follow_api.member_a.get(
            "/api/my/community-activity",
            params={"page": 2, "page_size": 1},
        ).json()
    )
    second_items = cast(list[dict[str, Any]], second_page["items"])
    assert [item["title"] for item in second_items] == ["Followed original"]
    assert second_items[0]["parent_version_id"] is None

    assert follow_api.member_a.delete("/api/cooks/member_bravo/follow").status_code == 200
    empty = _json_object(follow_api.member_a.get("/api/my/community-activity").json())
    assert empty["items"] == []
    assert empty["total"] == 0


@pytest.mark.parametrize(
    "query",
    ("page=0", "page=1000001", "page_size=0", "page_size=101"),
)
def test_my_followers_rejects_invalid_pagination(
    follow_api: FollowApi,
    query: str,
) -> None:
    assert follow_api.member_a.get(f"/api/my/followers?{query}").status_code == 422
    assert follow_api.member_a.get(f"/api/my/community-activity?{query}").status_code == 422
