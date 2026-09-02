from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, text
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.main import create_app
from app.models import (
    ACCOUNT_KIND_MEMBER,
    RecipeDraft,
    RecipeLineage,
    RecipeRating,
    RecipeSave,
    RecipeVersion,
    RecipeVersionPublication,
    User,
)
from app.services.recipe_visibility import set_authored_recipe_visibility
from tests.conftest import make_alembic_config
from tests.member_session import authenticate_client, create_member_credentials

MEMBER_A_ID = UUID("7d000000-0000-4000-8000-000000000001")
MEMBER_B_ID = UUID("7d000000-0000-4000-8000-000000000002")
EMPTY_COOK_ID = UUID("7d000000-0000-4000-8000-000000000003")
LINEAGE_ID = UUID("7d000000-0000-4000-8000-000000000010")
ROOT_ID = UUID("7d000000-0000-4000-8000-000000000011")
CHILD_ID = UUID("7d000000-0000-4000-8000-000000000012")
GRANDCHILD_ID = UUID("7d000000-0000-4000-8000-000000000013")
HIDDEN_LINEAGE_ID = UUID("7d000000-0000-4000-8000-000000000020")
HIDDEN_PARENT_ID = UUID("7d000000-0000-4000-8000-000000000021")
PUBLIC_CHILD_ID = UUID("7d000000-0000-4000-8000-000000000022")
DRAFT_A_ID = UUID("7d000000-0000-4000-8000-000000000031")
DRAFT_B_ID = UUID("7d000000-0000-4000-8000-000000000032")
DRAFT_A_SECOND_ID = UUID("7d000000-0000-4000-8000-000000000033")


@dataclass(frozen=True, slots=True)
class RecipeLibraryApi:
    engine: Engine
    anonymous: TestClient
    member_a: TestClient
    member_b: TestClient


def _json_object(value: object) -> dict[str, Any]:
    return cast(dict[str, Any], value)


def _public_user(*, user_id: UUID, handle: str, display_name: str) -> dict[str, str]:
    return {"id": str(user_id), "handle": handle, "display_name": display_name}


def test_migration_backfills_catalog_handle_and_saved_library_index(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    catalog_author_id = UUID("16746db2-8776-5937-856c-252b72442671")
    unrelated_user_id = UUID("7d000000-0000-4000-8000-000000000099")
    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260825_0014")
        connection.execute(
            text(
                "INSERT INTO users "
                "(id, email, display_name, handle, account_kind, status) "
                "VALUES (:id, :email, :display_name, NULL, 'system', 'active')"
            ),
            {
                "id": catalog_author_id,
                "email": "demo-catalog@recipe-lab.invalid",
                "display_name": "Recipe Lab Demo Catalog",
            },
        )
        connection.execute(
            text(
                "INSERT INTO users "
                "(id, email, display_name, handle, account_kind, status) "
                "VALUES (:id, :email, :display_name, 'unrelated-cook', 'member', 'active')"
            ),
            {
                "id": unrelated_user_id,
                "email": "unrelated-cook@example.test",
                "display_name": "Unrelated Cook",
            },
        )

        command.upgrade(alembic_config, "head")

        assert (
            connection.scalar(
                text("SELECT handle FROM users WHERE id = :id"),
                {"id": catalog_author_id},
            )
            == "recipe-lab-catalog"
        )
        index_definition = connection.scalar(
            text(
                "SELECT indexdef FROM pg_indexes "
                "WHERE schemaname = current_schema() "
                "AND indexname = 'ix_recipe_saves_user_created_recipe'"
            )
        )
        assert index_definition is not None
        assert "(user_id, created_at DESC, recipe_version_id)" in index_definition

        command.downgrade(alembic_config, "20260825_0014")
        assert (
            connection.scalar(
                text("SELECT handle FROM users WHERE id = :id"),
                {"id": catalog_author_id},
            )
            is None
        )
        assert (
            connection.scalar(
                text("SELECT handle FROM users WHERE id = :id"),
                {"id": unrelated_user_id},
            )
            == "unrelated-cook"
        )
        assert (
            connection.scalar(
                text(
                    "SELECT indexdef FROM pg_indexes "
                    "WHERE schemaname = current_schema() "
                    "AND indexname = 'ix_recipe_saves_user_created_recipe'"
                )
            )
            is None
        )


@pytest.fixture
def recipe_library_api(empty_postgres_engine: Engine) -> Iterator[RecipeLibraryApi]:
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
    start = datetime(2026, 8, 26, tzinfo=UTC)
    with Session(bind=empty_postgres_engine) as session, session.begin():
        member_alpha = session.get(User, MEMBER_A_ID)
        assert member_alpha is not None
        member_alpha.profile_description = "Reliable recipes for busy weeknights."
        session.add(
            User(
                id=EMPTY_COOK_ID,
                email="empty-cook@example.test",
                handle="empty_cook",
                display_name="Empty Cook",
                account_kind=ACCOUNT_KIND_MEMBER,
            )
        )
        lineage = RecipeLineage(
            id=LINEAGE_ID,
            created_by_user_id=MEMBER_A_ID,
            created_at=start,
        )
        hidden_lineage = RecipeLineage(
            id=HIDDEN_LINEAGE_ID,
            created_by_user_id=MEMBER_B_ID,
            created_at=start,
        )
        session.add_all([lineage, hidden_lineage])
        session.flush()
        root = RecipeVersion(
            id=ROOT_ID,
            lineage_id=LINEAGE_ID,
            parent_version_id=None,
            created_by_user_id=MEMBER_A_ID,
            version_number=1,
            title="Alpha original",
            description="A public original.",
            servings=Decimal("4.00"),
            created_at=start + timedelta(minutes=1),
        )
        child = RecipeVersion(
            id=CHILD_ID,
            lineage_id=LINEAGE_ID,
            parent_version_id=ROOT_ID,
            created_by_user_id=MEMBER_B_ID,
            version_number=2,
            title="Bravo fork",
            description="A cross-user fork.",
            servings=Decimal("4.00"),
            created_at=start + timedelta(minutes=2),
        )
        grandchild = RecipeVersion(
            id=GRANDCHILD_ID,
            lineage_id=LINEAGE_ID,
            parent_version_id=CHILD_ID,
            created_by_user_id=MEMBER_A_ID,
            version_number=3,
            title="Alpha fork of Bravo",
            description="A third-generation cross-user fork.",
            servings=Decimal("6.00"),
            created_at=start + timedelta(minutes=3),
        )
        hidden_parent = RecipeVersion(
            id=HIDDEN_PARENT_ID,
            lineage_id=HIDDEN_LINEAGE_ID,
            parent_version_id=None,
            created_by_user_id=MEMBER_B_ID,
            version_number=1,
            title="Secret staged parent",
            description="This unpublished metadata must remain private.",
            servings=Decimal("2.00"),
            created_at=start + timedelta(minutes=4),
        )
        public_child = RecipeVersion(
            id=PUBLIC_CHILD_ID,
            lineage_id=HIDDEN_LINEAGE_ID,
            parent_version_id=HIDDEN_PARENT_ID,
            created_by_user_id=MEMBER_A_ID,
            version_number=2,
            title="Public child with unavailable parent",
            description="The child itself is explicitly public.",
            servings=Decimal("2.00"),
            created_at=start + timedelta(minutes=5),
        )
        session.add_all([root, child, grandchild, hidden_parent, public_child])
        session.flush()
        for version, published_at in (
            (root, start + timedelta(minutes=1)),
            (child, start + timedelta(minutes=2)),
            (grandchild, start + timedelta(minutes=3)),
            (public_child, start + timedelta(minutes=5)),
        ):
            session.add(
                RecipeVersionPublication(
                    recipe_version_id=version.id,
                    actor_user_id=version.created_by_user_id,
                    published_at=published_at,
                )
            )
        session.add_all(
            [
                RecipeDraft(
                    id=DRAFT_A_ID,
                    author_user_id=MEMBER_A_ID,
                    source_version_id=ROOT_ID,
                    title="Alpha private draft",
                    description="A private draft description for its owner.",
                    status="active",
                    revision=2,
                    created_at=start + timedelta(minutes=6),
                    updated_at=start + timedelta(minutes=8),
                ),
                RecipeDraft(
                    id=DRAFT_B_ID,
                    author_user_id=MEMBER_B_ID,
                    title="Bravo private draft",
                    status="active",
                    revision=1,
                    created_at=start + timedelta(minutes=6),
                    updated_at=start + timedelta(minutes=7),
                ),
                RecipeDraft(
                    id=DRAFT_A_SECOND_ID,
                    author_user_id=MEMBER_A_ID,
                    title="Alpha second private draft",
                    status="active",
                    revision=1,
                    created_at=start + timedelta(minutes=7),
                    updated_at=start + timedelta(minutes=8),
                ),
                RecipeRating(
                    user_id=MEMBER_A_ID,
                    recipe_version_id=GRANDCHILD_ID,
                    rating=5,
                ),
                RecipeRating(
                    user_id=MEMBER_B_ID,
                    recipe_version_id=GRANDCHILD_ID,
                    rating=4,
                ),
                RecipeSave(
                    user_id=MEMBER_A_ID,
                    recipe_version_id=CHILD_ID,
                    created_at=start + timedelta(minutes=9),
                ),
                RecipeSave(
                    user_id=MEMBER_A_ID,
                    recipe_version_id=ROOT_ID,
                    created_at=start + timedelta(minutes=10),
                ),
                RecipeSave(
                    user_id=MEMBER_B_ID,
                    recipe_version_id=GRANDCHILD_ID,
                    created_at=start + timedelta(minutes=11),
                ),
            ]
        )

    application = create_app()

    def override_session() -> Iterator[Session]:
        with Session(bind=empty_postgres_engine, expire_on_commit=False) as session:
            yield session

    application.dependency_overrides[get_session] = override_session
    try:
        with (
            TestClient(application) as anonymous,
            TestClient(application) as member_a_client,
            TestClient(application) as member_b_client,
        ):
            authenticate_client(member_a_client, member_a)
            authenticate_client(member_b_client, member_b)
            yield RecipeLibraryApi(
                engine=empty_postgres_engine,
                anonymous=anonymous,
                member_a=member_a_client,
                member_b=member_b_client,
            )
    finally:
        application.dependency_overrides.clear()


def test_public_authorship_profiles_and_chain_are_truthful_and_public_safe(
    recipe_library_api: RecipeLibraryApi,
) -> None:
    alpha = _public_user(
        user_id=MEMBER_A_ID,
        handle="member_alpha",
        display_name="Member Alpha",
    )
    bravo = _public_user(
        user_id=MEMBER_B_ID,
        handle="member_bravo",
        display_name="Member Bravo",
    )

    browse = recipe_library_api.anonymous.get("/api/recipes", params={"page_size": 100})
    assert browse.status_code == 200
    browsed = _json_object(browse.json())
    assert browsed["total"] == 4
    cards = {item["id"]: item for item in browsed["items"]}
    assert cards[str(ROOT_ID)]["author"] == alpha
    assert cards[str(ROOT_ID)]["parent"] is None
    assert cards[str(CHILD_ID)]["author"] == bravo
    assert cards[str(CHILD_ID)]["parent"] == {
        "id": str(ROOT_ID),
        "version_number": 1,
        "title": "Alpha original",
        "author": alpha,
    }
    assert cards[str(GRANDCHILD_ID)]["author"] == alpha
    assert cards[str(GRANDCHILD_ID)]["parent"]["author"] == bravo

    child = _json_object(recipe_library_api.anonymous.get(f"/api/recipes/{CHILD_ID}").json())
    grandchild = _json_object(
        recipe_library_api.anonymous.get(f"/api/recipes/{GRANDCHILD_ID}").json()
    )
    assert child["author"] == bravo
    assert child["parent"]["author"] == alpha
    assert grandchild["author"] == alpha

    assert grandchild["parent"]["id"] == str(CHILD_ID)
    assert grandchild["parent"]["author"] == bravo
    assert child["children"] == [
        {
            "id": str(GRANDCHILD_ID),
            "version_number": 3,
            "title": "Alpha fork of Bravo",
            "author": alpha,
        }
    ]

    recommendations = _json_object(
        recipe_library_api.anonymous.get("/api/recommendations", params={"limit": 10}).json()
    )
    recommended_cards = {item["recipe"]["id"]: item["recipe"] for item in recommendations["items"]}
    assert recommended_cards[str(CHILD_ID)]["author"] == bravo
    assert recommended_cards[str(CHILD_ID)]["parent"]["author"] == alpha
    assert recommended_cards[str(GRANDCHILD_ID)]["author"] == alpha
    assert recommended_cards[str(GRANDCHILD_ID)]["parent"]["author"] == bravo

    profile = recipe_library_api.anonymous.get(
        "/api/cooks/MEMBER_ALPHA",
        params={"page_size": 2},
    )
    assert profile.status_code == 200
    profile_body = _json_object(profile.json())
    assert profile_body["cook"] == alpha
    assert profile_body["follower_count"] == 0
    assert profile_body["description"] == "Reliable recipes for busy weeknights."
    assert profile_body["total"] == 3
    assert profile_body["total_pages"] == 2
    assert len(profile_body["items"]) == 2
    assert {item["author"]["id"] for item in profile_body["items"]} == {str(MEMBER_A_ID)}
    assert str(HIDDEN_PARENT_ID) not in {item["id"] for item in profile_body["items"]}
    profile_cards = {item["id"]: item for item in profile_body["items"]}
    assert profile_cards[str(GRANDCHILD_ID)]["average_rating"] == 4.5
    assert profile_cards[str(GRANDCHILD_ID)]["rating_count"] == 2
    assert profile_cards[str(GRANDCHILD_ID)]["save_count"] == 1
    assert profile_cards[str(PUBLIC_CHILD_ID)]["average_rating"] is None
    assert profile_cards[str(PUBLIC_CHILD_ID)]["rating_count"] == 0
    assert profile_cards[str(PUBLIC_CHILD_ID)]["save_count"] == 0

    empty = recipe_library_api.anonymous.get("/api/cooks/empty_cook")
    assert empty.status_code == 200
    assert _json_object(empty.json())["items"] == []
    assert _json_object(empty.json())["total"] == 0
    assert _json_object(empty.json())["description"] is None
    assert recipe_library_api.anonymous.get("/api/cooks/missing_cook").status_code == 404


def test_public_browse_newest_sort_combines_with_filters_and_visibility(
    recipe_library_api: RecipeLibraryApi,
) -> None:
    newest = recipe_library_api.anonymous.get(
        "/api/recipes",
        params={"page_size": 100, "sort": "newest"},
    )

    assert newest.status_code == 200
    newest_items = cast(list[dict[str, Any]], _json_object(newest.json())["items"])
    assert [item["id"] for item in newest_items] == [
        str(PUBLIC_CHILD_ID),
        str(GRANDCHILD_ID),
        str(CHILD_ID),
        str(ROOT_ID),
    ]
    assert [item["published_at"] for item in newest_items] == [
        "2026-08-26T00:05:00Z",
        "2026-08-26T00:03:00Z",
        "2026-08-26T00:02:00Z",
        "2026-08-26T00:01:00Z",
    ]
    assert str(HIDDEN_PARENT_ID) not in {item["id"] for item in newest_items}

    filtered = recipe_library_api.anonymous.get(
        "/api/recipes",
        params={"page_size": 100, "sort": "newest", "q": "Alpha"},
    )
    assert filtered.status_code == 200
    filtered_items = cast(list[dict[str, Any]], _json_object(filtered.json())["items"])
    assert [item["id"] for item in filtered_items] == [
        str(GRANDCHILD_ID),
        str(ROOT_ID),
    ]

    try:
        with Session(bind=recipe_library_api.engine) as session, session.begin():
            set_authored_recipe_visibility(
                session,
                actor_user_id=MEMBER_B_ID,
                recipe_version_id=CHILD_ID,
                desired_state="author_withdrawn",
            )

        after_withdrawal = recipe_library_api.anonymous.get(
            "/api/recipes",
            params={"page_size": 100, "sort": "newest"},
        )
        assert after_withdrawal.status_code == 200
        after_items = cast(
            list[dict[str, Any]],
            _json_object(after_withdrawal.json())["items"],
        )
        assert str(CHILD_ID) not in {item["id"] for item in after_items}
    finally:
        with Session(bind=recipe_library_api.engine) as session, session.begin():
            set_authored_recipe_visibility(
                session,
                actor_user_id=MEMBER_B_ID,
                recipe_version_id=CHILD_ID,
                desired_state="published",
            )


def test_unpublished_direct_parent_metadata_never_leaks(
    recipe_library_api: RecipeLibraryApi,
) -> None:
    detail = recipe_library_api.anonymous.get(f"/api/recipes/{PUBLIC_CHILD_ID}")
    assert detail.status_code == 200
    body = _json_object(detail.json())
    assert body["parent_version_id"] == str(HIDDEN_PARENT_ID)
    assert body["parent"] is None
    assert "Secret staged parent" not in detail.text
    assert "This unpublished metadata" not in detail.text

    browse = _json_object(
        recipe_library_api.anonymous.get("/api/recipes", params={"page_size": 100}).json()
    )
    card = next(item for item in browse["items"] if item["id"] == str(PUBLIC_CHILD_ID))
    assert card["parent"] is None
    assert "Secret staged parent" not in str(card)


def test_private_libraries_are_actor_scoped_paginated_and_do_not_leak_account_data(
    recipe_library_api: RecipeLibraryApi,
) -> None:
    assert (
        recipe_library_api.anonymous.get("/api/my/recipes", params={"view": "drafts"}).status_code
        == 401
    )
    assert recipe_library_api.anonymous.get("/api/my/saved-recipes").status_code == 401

    drafts_page_one = recipe_library_api.member_a.get(
        "/api/my/recipes",
        params={"view": "drafts", "page": 1, "page_size": 1},
    )
    assert drafts_page_one.status_code == 200
    assert drafts_page_one.headers["cache-control"] == "private, no-store"
    assert "Cookie" in drafts_page_one.headers["vary"]
    drafts_page_one_body = _json_object(drafts_page_one.json())
    assert drafts_page_one_body["total"] == 2
    assert drafts_page_one_body["total_pages"] == 2
    assert [item["draft"]["id"] for item in drafts_page_one_body["items"]] == [str(DRAFT_A_ID)]
    assert all(item["kind"] == "draft" for item in drafts_page_one_body["items"])
    assert drafts_page_one_body["items"][0]["source_recipe_title"] == "Alpha original"
    assert drafts_page_one_body["items"][0]["description"] == (
        "A private draft description for its owner."
    )

    drafts_page_two_body = _json_object(
        recipe_library_api.member_a.get(
            "/api/my/recipes",
            params={"view": "drafts", "page": 2, "page_size": 1},
        ).json()
    )
    assert drafts_page_two_body["total"] == 2
    assert [item["draft"]["id"] for item in drafts_page_two_body["items"]] == [
        str(DRAFT_A_SECOND_ID)
    ]
    assert drafts_page_two_body["items"][0]["source_recipe_title"] is None
    assert drafts_page_two_body["items"][0]["description"] is None

    published_page_one_body = _json_object(
        recipe_library_api.member_a.get(
            "/api/my/recipes",
            params={"view": "published", "page": 1, "page_size": 2},
        ).json()
    )
    assert published_page_one_body["total"] == 3
    assert published_page_one_body["total_pages"] == 2
    assert [item["recipe"]["id"] for item in published_page_one_body["items"]] == [
        str(PUBLIC_CHILD_ID),
        str(GRANDCHILD_ID),
    ]
    published_page_two_body = _json_object(
        recipe_library_api.member_a.get(
            "/api/my/recipes",
            params={"view": "published", "page": 2, "page_size": 2},
        ).json()
    )
    assert [item["recipe"]["id"] for item in published_page_two_body["items"]] == [str(ROOT_ID)]
    published_items = [
        *published_page_one_body["items"],
        *published_page_two_body["items"],
    ]
    assert {item["recipe"]["id"] for item in published_items} == {
        str(ROOT_ID),
        str(GRANDCHILD_ID),
        str(PUBLIC_CHILD_ID),
    }
    assert all(item["kind"] == "published" for item in published_items)
    assert all(item["visibility_state"] == "published" for item in published_items)
    assert all(item["recipe"]["author"]["id"] == str(MEMBER_A_ID) for item in published_items)

    withdrawn_body = _json_object(
        recipe_library_api.member_a.get(
            "/api/my/recipes", params={"view": "withdrawn", "page_size": 100}
        ).json()
    )
    assert withdrawn_body["items"] == []
    assert withdrawn_body["total"] == 0
    assert withdrawn_body["total_pages"] == 0

    other_drafts = recipe_library_api.member_b.get(
        "/api/my/recipes",
        params={
            "view": "drafts",
            "page_size": 100,
            "user_id": str(MEMBER_A_ID),
        },
    )
    assert other_drafts.status_code == 200
    other_drafts_body = _json_object(other_drafts.json())
    assert other_drafts_body["total"] == 1
    assert [item["draft"]["id"] for item in other_drafts_body["items"]] == [str(DRAFT_B_ID)]
    other_published_body = _json_object(
        recipe_library_api.member_b.get(
            "/api/my/recipes",
            params={
                "view": "published",
                "page_size": 100,
                "user_id": str(MEMBER_A_ID),
            },
        ).json()
    )
    assert other_published_body["total"] == 1
    assert {item["recipe"]["id"] for item in other_published_body["items"]} == {str(CHILD_ID)}

    saves = recipe_library_api.member_a.get(
        "/api/my/saved-recipes",
        params={"page_size": 1},
    )
    assert saves.status_code == 200
    saves_body = _json_object(saves.json())
    assert saves_body["total"] == 2
    assert saves_body["total_pages"] == 2
    assert saves_body["items"][0]["recipe"]["id"] == str(ROOT_ID)
    assert saves_body["items"][0]["recipe"]["author"]["id"] == str(MEMBER_A_ID)

    other_saves = _json_object(recipe_library_api.member_b.get("/api/my/saved-recipes").json())
    assert other_saves["total"] == 1
    assert other_saves["items"][0]["recipe"]["id"] == str(GRANDCHILD_ID)

    forbidden = {
        "email",
        "issuer",
        "subject",
        "sessions",
        "events",
        "account_kind",
    }

    def assert_public_safe(value: object) -> None:
        if isinstance(value, dict):
            assert forbidden.isdisjoint(value)
            for nested in value.values():
                assert_public_safe(nested)
        elif isinstance(value, list):
            for nested in value:
                assert_public_safe(nested)

    assert_public_safe(drafts_page_one_body)
    assert_public_safe(drafts_page_two_body)
    assert_public_safe(published_page_one_body)
    assert_public_safe(published_page_two_body)
    assert_public_safe(withdrawn_body)
    assert_public_safe(saves_body)

    for path in (
        "/api/my/recipes?page=1",
        "/api/my/recipes?view=unknown",
        "/api/my/recipes?view=drafts&page=0",
        "/api/my/recipes?view=published&page_size=101",
        "/api/my/saved-recipes?page=1000001",
    ):
        assert recipe_library_api.member_a.get(path).status_code == 422


def test_author_visibility_is_idempotent_and_applies_across_public_surfaces(
    recipe_library_api: RecipeLibraryApi,
) -> None:
    non_owner = recipe_library_api.member_b.put(
        f"/api/recipes/{ROOT_ID}/visibility",
        json={"state": "author_withdrawn"},
    )
    assert non_owner.status_code == 404
    assert str(ROOT_ID) not in non_owner.text
    assert (
        recipe_library_api.anonymous.put(
            f"/api/recipes/{ROOT_ID}/visibility",
            json={"state": "author_withdrawn"},
        ).status_code
        == 401
    )

    interaction_key = str(uuid4())
    rating = recipe_library_api.member_a.put(
        f"/api/recipes/{ROOT_ID}/rating",
        json={"rating": 4},
        headers={"Idempotency-Key": interaction_key},
    )
    assert rating.status_code == 200

    withdrawn = recipe_library_api.member_a.put(
        f"/api/recipes/{ROOT_ID}/visibility",
        json={"state": "author_withdrawn"},
    )
    assert withdrawn.status_code == 200
    assert withdrawn.headers["cache-control"] == "private, no-store"
    withdrawn_body = _json_object(withdrawn.json())
    assert set(withdrawn_body) == {"recipe_version_id", "state", "updated_at"}
    assert withdrawn_body["recipe_version_id"] == str(ROOT_ID)
    assert withdrawn_body["state"] == "author_withdrawn"

    replay = recipe_library_api.member_a.put(
        f"/api/recipes/{ROOT_ID}/visibility",
        json={"state": "author_withdrawn"},
    )
    assert replay.status_code == 200
    assert replay.json() == withdrawn.json()

    with recipe_library_api.engine.connect() as connection:
        publication = connection.execute(
            text(
                """
                SELECT state, author_withdrawn_at, moderation_hidden_at,
                       state_changed_at, state_changed_by_user_id
                FROM recipe_version_publications
                WHERE recipe_version_id = :recipe_version_id
                """
            ),
            {"recipe_version_id": ROOT_ID},
        ).one()
        assert publication.state == "author_withdrawn"
        assert publication.author_withdrawn_at == publication.state_changed_at
        assert publication.moderation_hidden_at is None
        assert publication.state_changed_by_user_id == MEMBER_A_ID
        assert (
            connection.scalar(
                text(
                    "SELECT count(*) FROM recipe_version_visibility_events "
                    "WHERE recipe_version_id = :recipe_version_id"
                ),
                {"recipe_version_id": ROOT_ID},
            )
            == 2
        )
        assert (
            connection.scalar(
                text(
                    "SELECT count(*) FROM recipe_saves "
                    "WHERE user_id = :user_id AND recipe_version_id = :recipe_version_id"
                ),
                {"user_id": MEMBER_A_ID, "recipe_version_id": ROOT_ID},
            )
            == 1
        )

    browse = _json_object(
        recipe_library_api.anonymous.get("/api/recipes", params={"page_size": 100}).json()
    )
    assert str(ROOT_ID) not in {item["id"] for item in browse["items"]}
    search = _json_object(
        recipe_library_api.anonymous.get(
            "/api/recipes",
            params={"q": "Alpha original", "page_size": 100},
        ).json()
    )
    assert str(ROOT_ID) not in {item["id"] for item in search["items"]}
    profile = _json_object(
        recipe_library_api.anonymous.get(
            "/api/cooks/member_alpha",
            params={"page_size": 100},
        ).json()
    )
    assert str(ROOT_ID) not in {item["id"] for item in profile["items"]}
    recommendations = _json_object(
        recipe_library_api.anonymous.get(
            "/api/recommendations",
            params={"limit": 10},
        ).json()
    )
    assert str(ROOT_ID) not in {item["recipe"]["id"] for item in recommendations["items"]}

    hidden_detail = recipe_library_api.anonymous.get(f"/api/recipes/{ROOT_ID}")
    assert hidden_detail.status_code == 404
    hidden_detail_correlation_id = hidden_detail.headers["X-Correlation-ID"]
    assert hidden_detail.json() == {
        "error": {
            "code": "recipe_not_found",
            "message": "The recipe was not found or is not publicly available.",
            "issues": [],
            "correlation_id": hidden_detail_correlation_id,
        }
    }
    assert str(ROOT_ID) not in hidden_detail.text
    assert "Alpha original" not in hidden_detail.text

    child_detail = _json_object(recipe_library_api.anonymous.get(f"/api/recipes/{CHILD_ID}").json())
    assert child_detail["parent_version_id"] == str(ROOT_ID)
    assert child_detail["parent"] is None
    assert "Alpha original" not in str(child_detail)
    diff = recipe_library_api.anonymous.get(f"/api/recipes/{CHILD_ID}/diff")
    assert diff.status_code == 404
    assert str(ROOT_ID) not in diff.text
    assert "Alpha original" not in diff.text

    mine = _json_object(
        recipe_library_api.member_a.get(
            "/api/my/recipes",
            params={"view": "withdrawn", "page_size": 100},
        ).json()
    )
    assert mine["total"] == 1
    root_item = next(
        item
        for item in mine["items"]
        if item["kind"] == "published" and item["recipe"]["id"] == str(ROOT_ID)
    )
    assert root_item["visibility_state"] == "author_withdrawn"
    published_after_withdrawal = _json_object(
        recipe_library_api.member_a.get(
            "/api/my/recipes",
            params={"view": "published", "page_size": 100},
        ).json()
    )
    assert str(ROOT_ID) not in {
        item["recipe"]["id"] for item in published_after_withdrawal["items"]
    }
    saves = _json_object(
        recipe_library_api.member_a.get(
            "/api/my/saved-recipes",
            params={"page_size": 100},
        ).json()
    )
    assert str(ROOT_ID) not in {item["recipe"]["id"] for item in saves["items"]}
    assert saves["total"] == 1

    replayed_rating = recipe_library_api.member_a.put(
        f"/api/recipes/{ROOT_ID}/rating",
        json={"rating": 4},
        headers={"Idempotency-Key": interaction_key},
    )
    assert replayed_rating.status_code == 404
    new_save = recipe_library_api.member_a.put(
        f"/api/recipes/{ROOT_ID}/save",
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert new_save.status_code == 404

    restored = recipe_library_api.member_a.put(
        f"/api/recipes/{ROOT_ID}/visibility",
        json={"state": "published"},
    )
    assert restored.status_code == 200
    restored_body = _json_object(restored.json())
    assert set(restored_body) == {"recipe_version_id", "state", "updated_at"}
    assert restored_body["state"] == "published"
    assert restored_body["updated_at"] != withdrawn_body["updated_at"]
    assert recipe_library_api.anonymous.get(f"/api/recipes/{ROOT_ID}").status_code == 200
    restored_saves = _json_object(
        recipe_library_api.member_a.get(
            "/api/my/saved-recipes",
            params={"page_size": 100},
        ).json()
    )
    assert str(ROOT_ID) in {item["recipe"]["id"] for item in restored_saves["items"]}
    with recipe_library_api.engine.connect() as connection:
        assert (
            connection.scalar(
                text(
                    "SELECT count(*) FROM recipe_version_visibility_events "
                    "WHERE recipe_version_id = :recipe_version_id"
                ),
                {"recipe_version_id": ROOT_ID},
            )
            == 3
        )
        topology = list(
            connection.execute(
                text(
                    """
                    SELECT id, parent_version_id
                    FROM recipe_versions
                    WHERE id IN (:root_id, :child_id, :grandchild_id)
                    ORDER BY id
                    """
                ),
                {
                    "root_id": ROOT_ID,
                    "child_id": CHILD_ID,
                    "grandchild_id": GRANDCHILD_ID,
                },
            ).tuples()
        )
        assert topology == [
            (ROOT_ID, None),
            (CHILD_ID, ROOT_ID),
            (GRANDCHILD_ID, CHILD_ID),
        ]


def test_author_cannot_restore_moderation_hidden_recipe_or_clear_withdrawal_axis(
    recipe_library_api: RecipeLibraryApi,
) -> None:
    withdrawn = recipe_library_api.member_a.put(
        f"/api/recipes/{ROOT_ID}/visibility",
        json={"state": "author_withdrawn"},
    )
    assert withdrawn.status_code == 200

    with recipe_library_api.engine.begin() as connection:
        connection.execute(
            text(
                """
                UPDATE recipe_version_publications
                SET state = 'moderation_hidden',
                    moderation_hidden_at = state_changed_at + INTERVAL '1 second',
                    state_changed_at = state_changed_at + INTERVAL '1 second',
                    state_changed_by_user_id = :moderator_user_id
                WHERE recipe_version_id = :recipe_version_id
                """
            ),
            {
                "moderator_user_id": MEMBER_B_ID,
                "recipe_version_id": ROOT_ID,
            },
        )

    restore = recipe_library_api.member_a.put(
        f"/api/recipes/{ROOT_ID}/visibility",
        json={"state": "published"},
    )
    assert restore.status_code == 409
    assert _json_object(_json_object(restore.json())["error"])["code"] == (
        "recipe_visibility_managed_by_moderation"
    )
    with recipe_library_api.engine.connect() as connection:
        publication = connection.execute(
            text(
                """
                SELECT state, author_withdrawn_at, moderation_hidden_at
                FROM recipe_version_publications
                WHERE recipe_version_id = :recipe_version_id
                """
            ),
            {"recipe_version_id": ROOT_ID},
        ).one()
        assert publication.state == "moderation_hidden"
        assert publication.author_withdrawn_at is not None
        assert publication.moderation_hidden_at is not None

    mine = _json_object(
        recipe_library_api.member_a.get(
            "/api/my/recipes",
            params={"view": "published", "page_size": 100},
        ).json()
    )
    root_item = next(
        item
        for item in mine["items"]
        if item["kind"] == "published" and item["recipe"]["id"] == str(ROOT_ID)
    )
    assert root_item["visibility_state"] == "moderation_hidden"
    withdrawn_view = _json_object(
        recipe_library_api.member_a.get(
            "/api/my/recipes",
            params={"view": "withdrawn", "page_size": 100},
        ).json()
    )
    assert str(ROOT_ID) not in {item["recipe"]["id"] for item in withdrawn_view["items"]}


@contextmanager
def _select_counter(engine: Engine) -> Iterator[list[str]]:
    statements: list[str] = []

    def capture(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        normalized = statement.lstrip().upper()
        if normalized.startswith(("SELECT", "WITH")):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", capture)


@pytest.mark.parametrize(
    ("client_name", "path", "view", "maximum_selects"),
    [
        ("anonymous", "/api/recipes", None, 4),
        ("anonymous", "/api/cooks/member_alpha", None, 8),
        ("member_a", "/api/my/recipes", "drafts", 8),
        ("member_a", "/api/my/recipes", "published", 8),
        ("member_a", "/api/my/recipes", "withdrawn", 8),
        ("member_a", "/api/my/saved-recipes", None, 6),
    ],
)
def test_card_queries_are_bounded_independently_of_page_size(
    recipe_library_api: RecipeLibraryApi,
    client_name: str,
    path: str,
    view: str | None,
    maximum_selects: int,
) -> None:
    client = cast(TestClient, getattr(recipe_library_api, client_name))
    counts: list[int] = []
    for page_size in (1, 50):
        params: dict[str, str | int] = {"page_size": page_size}
        if view is not None:
            params["view"] = view
        with _select_counter(recipe_library_api.engine) as statements:
            response = client.get(path, params=params)
        assert response.status_code == 200
        counts.append(len(statements))
        assert len(statements) <= maximum_selects
    assert max(counts) - min(counts) <= 1
    if path == "/api/cooks/member_alpha":
        # Ratings and saves add exactly two aggregate queries, regardless of card count.
        assert counts == [8, 8]


def test_seeded_public_catalog_select_count_matches_performance_baseline(
    recipe_library_api: RecipeLibraryApi,
) -> None:
    counts: list[int] = []

    for page_size in (1, 50):
        with _select_counter(recipe_library_api.engine) as statements:
            response = recipe_library_api.anonymous.get(
                "/api/recipes",
                params={"page_size": page_size},
            )
        assert response.status_code == 200
        counts.append(len(statements))

    # The fourth bounded query loads immutable category snapshots for every card.
    assert counts == [4, 4]


def test_openapi_documents_public_identity_and_private_library_contracts(
    recipe_library_api: RecipeLibraryApi,
) -> None:
    document = _json_object(recipe_library_api.anonymous.get("/openapi.json").json())
    paths = cast(dict[str, Any], document["paths"])
    schemas = cast(dict[str, Any], cast(dict[str, Any], document["components"])["schemas"])

    assert {
        "/api/cooks/{handle}",
        "/api/cooks/{handle}/follow",
        "/api/my/follow-stats",
        "/api/my/recipes",
        "/api/my/saved-recipes",
    } <= set(paths)
    assert {
        "PublicUserReference",
        "PublicCookProfileResponse",
        "CookFollowStateResponse",
        "MyFollowStatsResponse",
        "MyRecipeLibraryView",
        "MyRecipeLibraryResponse",
        "SavedRecipeLibraryResponse",
    } <= set(schemas)
    assert set(schemas["PublicUserReference"]["properties"]) == {
        "id",
        "handle",
        "display_name",
    }
    assert "description" in schemas["PublicCookProfileResponse"]["properties"]
    assert "description" in schemas["PublicCookProfileResponse"]["required"]
    profile_item_schema = schemas["PublicCookProfileResponse"]["properties"]["items"]["items"]
    assert profile_item_schema["$ref"].endswith("/RecipeCardSummary")
    my_recipes_parameters = paths["/api/my/recipes"]["get"]["parameters"]
    view_parameter = next(
        parameter for parameter in my_recipes_parameters if parameter["name"] == "view"
    )
    assert view_parameter["in"] == "query"
    assert view_parameter["required"] is True
    assert view_parameter["schema"] == {"$ref": "#/components/schemas/MyRecipeLibraryView"}
    assert schemas["MyRecipeLibraryView"]["enum"] == [
        "drafts",
        "published",
        "withdrawn",
    ]
    assert "401" in paths["/api/my/recipes"]["get"]["responses"]
    assert "401" in paths["/api/my/saved-recipes"]["get"]["responses"]
