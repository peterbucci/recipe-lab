from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event
from sqlalchemy.orm import ORMExecuteState, Session

from app.models import (
    RECIPE_PUBLICATION_STATE_MODERATION_HIDDEN,
    Recipe,
    RecipeEdition,
    RecipeLineage,
    RecipeSave,
    RecipeVersion,
    RecipeVersionPublication,
    UserFollow,
)
from app.repositories.recipe_diffs import RecipeVersionDiffIdentity
from app.repositories.recipes import (
    get_public_recipe_history,
    list_public_current_recipe_versions_in_order,
)
from tests.application import application_with_database
from tests.conftest import make_alembic_config
from tests.member_session import authenticate_client, create_member_credentials

AUTHOR_ID = UUID("8c000000-0000-4000-8000-000000000001")
FOLLOWER_ID = UUID("8c000000-0000-4000-8000-000000000002")
LINEAGE_ID = UUID("8c000000-0000-4000-8000-000000000010")
RECIPE_ID = UUID("8c000000-0000-4000-8000-000000000011")
FIRST_VERSION_ID = UUID("8c000000-0000-4000-8000-000000000012")
CURRENT_VERSION_ID = UUID("8c000000-0000-4000-8000-000000000013")
ADAPTATION_RECIPE_ID = UUID("8c000000-0000-4000-8000-000000000014")
ADAPTATION_VERSION_ID = UUID("8c000000-0000-4000-8000-000000000015")
ADAPTATION_CURRENT_VERSION_ID = UUID("8c000000-0000-4000-8000-000000000009")
HIDDEN_LINEAGE_ID = UUID("8c000000-0000-4000-8000-000000000020")
HIDDEN_RECIPE_ID = UUID("8c000000-0000-4000-8000-000000000021")
HIDDEN_FIRST_VERSION_ID = UUID("8c000000-0000-4000-8000-000000000022")
HIDDEN_CURRENT_VERSION_ID = UUID("8c000000-0000-4000-8000-000000000023")
HIDDEN_SOURCE_ADAPTATION_RECIPE_ID = UUID("8c000000-0000-4000-8000-000000000024")
HIDDEN_SOURCE_ADAPTATION_VERSION_ID = UUID("8c000000-0000-4000-8000-000000000025")
NEXT_CURRENT_VERSION_ID = UUID("8c000000-0000-4000-8000-000000000026")


@dataclass(frozen=True, slots=True)
class RecipeCurrentApi:
    engine: Engine
    anonymous: TestClient
    member: TestClient
    follower: TestClient


def _json_object(value: object) -> dict[str, Any]:
    return cast(dict[str, Any], value)


def _version(
    *,
    version_id: UUID,
    lineage_id: UUID,
    version_number: int,
    title: str,
    parent_version_id: UUID | None = None,
    created_at: datetime,
) -> RecipeVersion:
    return RecipeVersion(
        id=version_id,
        lineage_id=lineage_id,
        parent_version_id=parent_version_id,
        created_by_user_id=AUTHOR_ID,
        version_number=version_number,
        title=title,
        description=None,
        servings=Decimal("4.00"),
        created_at=created_at,
    )


def _moderation_hide(engine: Engine, recipe_version_id: UUID) -> None:
    with Session(bind=engine) as session, session.begin():
        publication = session.get(RecipeVersionPublication, recipe_version_id)
        assert publication is not None
        hidden_at = publication.state_changed_at + timedelta(seconds=1)
        publication.state = RECIPE_PUBLICATION_STATE_MODERATION_HIDDEN
        publication.moderation_hidden_at = hidden_at
        publication.state_changed_at = hidden_at
        publication.state_changed_by_user_id = AUTHOR_ID


def _advance_current_recipe(engine: Engine) -> None:
    created_at = datetime(2026, 9, 14, 13, 1, tzinfo=UTC)
    with Session(bind=engine) as session, session.begin():
        session.add(
            _version(
                version_id=NEXT_CURRENT_VERSION_ID,
                lineage_id=LINEAGE_ID,
                version_number=5,
                title="Concurrent newer current edition",
                created_at=created_at,
            )
        )
        session.flush()
        session.add(
            RecipeVersionPublication(
                recipe_version_id=NEXT_CURRENT_VERSION_ID,
                actor_user_id=AUTHOR_ID,
                published_at=created_at,
            )
        )
        session.flush()
        session.add(
            RecipeEdition(
                recipe_version_id=NEXT_CURRENT_VERSION_ID,
                recipe_id=RECIPE_ID,
                lineage_id=LINEAGE_ID,
                attributed_author_user_id=AUTHOR_ID,
                edition_number=3,
                relation_kind="revision",
                previous_recipe_version_id=CURRENT_VERSION_ID,
                declared_change_reason="update",
            )
        )
        stable_recipe = session.get(Recipe, RECIPE_ID)
        assert stable_recipe is not None
        stable_recipe.current_recipe_version_id = NEXT_CURRENT_VERSION_ID


@pytest.mark.parametrize(
    ("relation_kind", "parent_version_id", "previous_version_id", "expected"),
    [
        pytest.param("original", None, None, None, id="original"),
        pytest.param(
            "adaptation",
            FIRST_VERSION_ID,
            None,
            FIRST_VERSION_ID,
            id="adaptation-parent",
        ),
        pytest.param(
            "revision",
            None,
            FIRST_VERSION_ID,
            FIRST_VERSION_ID,
            id="revision-predecessor",
        ),
    ],
)
def test_diff_identity_uses_topology_specific_default_base(
    relation_kind: str,
    parent_version_id: UUID | None,
    previous_version_id: UUID | None,
    expected: UUID | None,
) -> None:
    identity = RecipeVersionDiffIdentity(
        id=CURRENT_VERSION_ID,
        lineage_id=LINEAGE_ID,
        parent_version_id=parent_version_id,
        relation_kind=relation_kind,
        previous_version_id=previous_version_id,
    )

    assert identity.default_base_version_id == expected


@pytest.fixture
def recipe_current_api(empty_postgres_engine: Engine) -> Iterator[RecipeCurrentApi]:
    config = make_alembic_config()
    with empty_postgres_engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")

    credentials = create_member_credentials(
        empty_postgres_engine,
        user_id=AUTHOR_ID,
        handle="edition_author",
        display_name="Edition Author",
    )
    follower_credentials = create_member_credentials(
        empty_postgres_engine,
        user_id=FOLLOWER_ID,
        handle="edition_follower",
        display_name="Edition Follower",
    )
    started_at = datetime(2026, 9, 14, 12, 0, tzinfo=UTC)
    first = _version(
        version_id=FIRST_VERSION_ID,
        lineage_id=LINEAGE_ID,
        version_number=1,
        title="Original exact edition",
        created_at=started_at,
    )
    current = _version(
        version_id=CURRENT_VERSION_ID,
        lineage_id=LINEAGE_ID,
        version_number=2,
        title="Corrected current edition",
        created_at=started_at + timedelta(minutes=1),
    )
    adaptation = _version(
        version_id=ADAPTATION_VERSION_ID,
        lineage_id=LINEAGE_ID,
        version_number=3,
        title="Adaptation pinned to the original",
        parent_version_id=FIRST_VERSION_ID,
        created_at=started_at + timedelta(minutes=2),
    )
    adaptation_current = _version(
        version_id=ADAPTATION_CURRENT_VERSION_ID,
        lineage_id=LINEAGE_ID,
        version_number=4,
        title="Revised adaptation current edition",
        created_at=started_at + timedelta(minutes=3),
    )
    hidden_first = _version(
        version_id=HIDDEN_FIRST_VERSION_ID,
        lineage_id=HIDDEN_LINEAGE_ID,
        version_number=1,
        title="Readable predecessor",
        created_at=started_at + timedelta(minutes=4),
    )
    hidden_current = _version(
        version_id=HIDDEN_CURRENT_VERSION_ID,
        lineage_id=HIDDEN_LINEAGE_ID,
        version_number=2,
        title="Moderation-hidden current edition",
        created_at=started_at + timedelta(minutes=5),
    )
    hidden_source_adaptation = _version(
        version_id=HIDDEN_SOURCE_ADAPTATION_VERSION_ID,
        lineage_id=HIDDEN_LINEAGE_ID,
        version_number=3,
        title="Public adaptation of a hidden source",
        parent_version_id=HIDDEN_CURRENT_VERSION_ID,
        created_at=started_at + timedelta(minutes=6),
    )

    with Session(bind=empty_postgres_engine) as session, session.begin():
        session.add_all(
            [
                RecipeLineage(id=LINEAGE_ID, created_by_user_id=AUTHOR_ID),
                RecipeLineage(id=HIDDEN_LINEAGE_ID, created_by_user_id=AUTHOR_ID),
            ]
        )
        session.flush()
        session.add_all(
            [
                first,
                current,
                adaptation,
                adaptation_current,
                hidden_first,
                hidden_current,
                hidden_source_adaptation,
            ]
        )
        session.flush()
        for version in (
            first,
            current,
            adaptation,
            adaptation_current,
            hidden_first,
            hidden_source_adaptation,
        ):
            session.add(
                RecipeVersionPublication(
                    recipe_version_id=version.id,
                    actor_user_id=AUTHOR_ID,
                    published_at=(
                        started_at + timedelta(minutes=7)
                        if version.id in {CURRENT_VERSION_ID, ADAPTATION_CURRENT_VERSION_ID}
                        else version.created_at
                    ),
                )
            )
        session.add(
            RecipeVersionPublication(
                recipe_version_id=HIDDEN_CURRENT_VERSION_ID,
                actor_user_id=AUTHOR_ID,
                state=RECIPE_PUBLICATION_STATE_MODERATION_HIDDEN,
                moderation_hidden_at=hidden_current.created_at,
                state_changed_at=hidden_current.created_at,
                state_changed_by_user_id=AUTHOR_ID,
                published_at=hidden_current.created_at,
            )
        )
        session.flush()
        session.add_all(
            [
                Recipe(
                    id=RECIPE_ID,
                    lineage_id=LINEAGE_ID,
                    attributed_author_user_id=AUTHOR_ID,
                    owner_user_id=AUTHOR_ID,
                    current_recipe_version_id=CURRENT_VERSION_ID,
                    created_at=first.created_at,
                ),
                Recipe(
                    id=ADAPTATION_RECIPE_ID,
                    lineage_id=LINEAGE_ID,
                    attributed_author_user_id=AUTHOR_ID,
                    owner_user_id=AUTHOR_ID,
                    current_recipe_version_id=ADAPTATION_CURRENT_VERSION_ID,
                    created_at=adaptation.created_at,
                ),
                Recipe(
                    id=HIDDEN_RECIPE_ID,
                    lineage_id=HIDDEN_LINEAGE_ID,
                    attributed_author_user_id=AUTHOR_ID,
                    owner_user_id=AUTHOR_ID,
                    current_recipe_version_id=HIDDEN_CURRENT_VERSION_ID,
                    created_at=hidden_first.created_at,
                ),
                Recipe(
                    id=HIDDEN_SOURCE_ADAPTATION_RECIPE_ID,
                    lineage_id=HIDDEN_LINEAGE_ID,
                    attributed_author_user_id=AUTHOR_ID,
                    owner_user_id=AUTHOR_ID,
                    current_recipe_version_id=HIDDEN_SOURCE_ADAPTATION_VERSION_ID,
                    created_at=hidden_source_adaptation.created_at,
                ),
            ]
        )
        session.flush()
        session.add_all(
            [
                RecipeEdition(
                    recipe_version_id=FIRST_VERSION_ID,
                    recipe_id=RECIPE_ID,
                    lineage_id=LINEAGE_ID,
                    attributed_author_user_id=AUTHOR_ID,
                    edition_number=1,
                    relation_kind="original",
                ),
                RecipeEdition(
                    recipe_version_id=CURRENT_VERSION_ID,
                    recipe_id=RECIPE_ID,
                    lineage_id=LINEAGE_ID,
                    attributed_author_user_id=AUTHOR_ID,
                    edition_number=2,
                    relation_kind="revision",
                    previous_recipe_version_id=FIRST_VERSION_ID,
                    declared_change_reason="correction",
                ),
                RecipeEdition(
                    recipe_version_id=ADAPTATION_VERSION_ID,
                    recipe_id=ADAPTATION_RECIPE_ID,
                    lineage_id=LINEAGE_ID,
                    attributed_author_user_id=AUTHOR_ID,
                    edition_number=1,
                    relation_kind="adaptation",
                ),
                RecipeEdition(
                    recipe_version_id=ADAPTATION_CURRENT_VERSION_ID,
                    recipe_id=ADAPTATION_RECIPE_ID,
                    lineage_id=LINEAGE_ID,
                    attributed_author_user_id=AUTHOR_ID,
                    edition_number=2,
                    relation_kind="revision",
                    previous_recipe_version_id=ADAPTATION_VERSION_ID,
                    declared_change_reason="update",
                ),
                RecipeEdition(
                    recipe_version_id=HIDDEN_FIRST_VERSION_ID,
                    recipe_id=HIDDEN_RECIPE_ID,
                    lineage_id=HIDDEN_LINEAGE_ID,
                    attributed_author_user_id=AUTHOR_ID,
                    edition_number=1,
                    relation_kind="original",
                ),
                RecipeEdition(
                    recipe_version_id=HIDDEN_CURRENT_VERSION_ID,
                    recipe_id=HIDDEN_RECIPE_ID,
                    lineage_id=HIDDEN_LINEAGE_ID,
                    attributed_author_user_id=AUTHOR_ID,
                    edition_number=2,
                    relation_kind="revision",
                    previous_recipe_version_id=HIDDEN_FIRST_VERSION_ID,
                    declared_change_reason="update",
                ),
                RecipeEdition(
                    recipe_version_id=HIDDEN_SOURCE_ADAPTATION_VERSION_ID,
                    recipe_id=HIDDEN_SOURCE_ADAPTATION_RECIPE_ID,
                    lineage_id=HIDDEN_LINEAGE_ID,
                    attributed_author_user_id=AUTHOR_ID,
                    edition_number=1,
                    relation_kind="adaptation",
                ),
                RecipeSave(user_id=AUTHOR_ID, recipe_version_id=FIRST_VERSION_ID),
                RecipeSave(user_id=AUTHOR_ID, recipe_version_id=CURRENT_VERSION_ID),
                RecipeSave(user_id=AUTHOR_ID, recipe_version_id=HIDDEN_FIRST_VERSION_ID),
                UserFollow(
                    follower_user_id=FOLLOWER_ID,
                    followed_user_id=AUTHOR_ID,
                ),
            ]
        )

    with application_with_database(empty_postgres_engine) as application:
        with (
            TestClient(application) as anonymous,
            TestClient(application) as member,
            TestClient(application) as follower,
        ):
            authenticate_client(member, credentials)
            authenticate_client(follower, follower_credentials)
            yield RecipeCurrentApi(
                engine=empty_postgres_engine,
                anonymous=anonymous,
                member=member,
                follower=follower,
            )


def test_exact_and_stable_reads_keep_distinct_identity(
    recipe_current_api: RecipeCurrentApi,
) -> None:
    exact_response = recipe_current_api.anonymous.get(f"/api/recipes/{FIRST_VERSION_ID}")
    current_response = recipe_current_api.anonymous.get(f"/api/recipes/current/{RECIPE_ID}")

    assert exact_response.status_code == 200
    assert current_response.status_code == 200
    exact = _json_object(exact_response.json())
    current = _json_object(current_response.json())
    assert exact["id"] == str(FIRST_VERSION_ID)
    assert exact["recipe_id"] == str(RECIPE_ID)
    assert exact["edition_number"] == 1
    assert exact["relation_kind"] == "original"
    assert exact["previous_version_id"] is None
    assert exact["declared_change_reason"] is None
    assert exact["is_current"] is False
    assert exact["current_version"]["id"] == str(CURRENT_VERSION_ID)
    assert exact["adaptation_source"] is None
    assert current["id"] == str(CURRENT_VERSION_ID)
    assert current["recipe_id"] == str(RECIPE_ID)
    assert current["edition_number"] == 2
    assert current["relation_kind"] == "revision"
    assert current["parent_version_id"] is None
    assert current["previous_version_id"] == str(FIRST_VERSION_ID)
    assert current["declared_change_reason"] == "correction"
    assert current["is_current"] is True
    assert current["current_version"]["id"] == str(CURRENT_VERSION_ID)
    assert current["adaptation_source"] is None


def test_history_repository_returns_recipe_local_editions_and_current_adaptations(
    recipe_current_api: RecipeCurrentApi,
) -> None:
    with Session(bind=recipe_current_api.engine) as session:
        history = get_public_recipe_history(session, FIRST_VERSION_ID)

    assert history is not None
    assert history.recipe_id == RECIPE_ID
    assert history.selected_recipe_version_id == FIRST_VERSION_ID
    assert history.current_recipe_version_id == CURRENT_VERSION_ID
    assert [item.recipe_version_id for item in history.editions] == [
        FIRST_VERSION_ID,
        CURRENT_VERSION_ID,
    ]
    assert [item.edition_number for item in history.editions] == [1, 2]
    assert history.editions[1].previous_recipe_version_id == FIRST_VERSION_ID
    assert [item.recipe_version_id for item in history.adaptations] == [
        ADAPTATION_CURRENT_VERSION_ID
    ]
    current_adaptation = history.adaptations[0]
    assert current_adaptation.relation_kind == "revision"
    assert current_adaptation.previous_recipe_version_id == ADAPTATION_VERSION_ID
    assert current_adaptation.adaptation_source_version_id == FIRST_VERSION_ID
    assert current_adaptation.declared_change_reason == "update"
    assert current_adaptation.is_current is True
    assert history.editions_truncated is False
    assert history.adaptations_truncated is False


def test_history_caps_each_collection_without_row_dependent_query_growth(
    recipe_current_api: RecipeCurrentApi,
) -> None:
    revision_ids = [uuid4() for _index in range(100)]
    adaptation_recipe_ids = [uuid4() for _index in range(101)]
    adaptation_version_ids = [uuid4() for _index in range(101)]
    revisions_started_at = datetime(2026, 9, 15, 12, 0, tzinfo=UTC)
    adaptations_started_at = datetime(2026, 9, 16, 12, 0, tzinfo=UTC)

    with Session(bind=recipe_current_api.engine) as session, session.begin():
        revision_versions = [
            _version(
                version_id=version_id,
                lineage_id=LINEAGE_ID,
                version_number=index + 5,
                title=f"Bounded history revision {index + 3}",
                created_at=revisions_started_at + timedelta(minutes=index),
            )
            for index, version_id in enumerate(revision_ids)
        ]
        adaptation_versions = [
            _version(
                version_id=version_id,
                lineage_id=LINEAGE_ID,
                version_number=index + 105,
                title=f"Bounded history adaptation {index + 1}",
                parent_version_id=FIRST_VERSION_ID,
                created_at=adaptations_started_at + timedelta(minutes=index),
            )
            for index, version_id in enumerate(adaptation_version_ids)
        ]
        session.add_all([*revision_versions, *adaptation_versions])
        session.flush()
        session.add_all(
            [
                RecipeVersionPublication(
                    recipe_version_id=version.id,
                    actor_user_id=AUTHOR_ID,
                    published_at=version.created_at,
                )
                for version in [*revision_versions, *adaptation_versions]
            ]
        )
        session.flush()

        previous_version_id = CURRENT_VERSION_ID
        revision_editions: list[RecipeEdition] = []
        for index, version_id in enumerate(revision_ids):
            revision_editions.append(
                RecipeEdition(
                    recipe_version_id=version_id,
                    recipe_id=RECIPE_ID,
                    lineage_id=LINEAGE_ID,
                    attributed_author_user_id=AUTHOR_ID,
                    edition_number=index + 3,
                    relation_kind="revision",
                    previous_recipe_version_id=previous_version_id,
                    declared_change_reason="update",
                )
            )
            previous_version_id = version_id
        session.add_all(revision_editions)
        session.add_all(
            [
                Recipe(
                    id=recipe_id,
                    lineage_id=LINEAGE_ID,
                    attributed_author_user_id=AUTHOR_ID,
                    owner_user_id=AUTHOR_ID,
                    current_recipe_version_id=version_id,
                    created_at=version.created_at,
                )
                for recipe_id, version_id, version in zip(
                    adaptation_recipe_ids,
                    adaptation_version_ids,
                    adaptation_versions,
                    strict=True,
                )
            ]
        )
        session.flush()
        session.add_all(
            [
                RecipeEdition(
                    recipe_version_id=version_id,
                    recipe_id=recipe_id,
                    lineage_id=LINEAGE_ID,
                    attributed_author_user_id=AUTHOR_ID,
                    edition_number=1,
                    relation_kind="adaptation",
                )
                for recipe_id, version_id in zip(
                    adaptation_recipe_ids,
                    adaptation_version_ids,
                    strict=True,
                )
            ]
        )
        stable_recipe = session.get(Recipe, RECIPE_ID)
        assert stable_recipe is not None
        stable_recipe.current_recipe_version_id = revision_ids[-1]

    statements: list[str] = []

    def capture_read_statement(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        if statement.lstrip().upper().startswith(("SELECT", "WITH")):
            statements.append(statement)

    event.listen(recipe_current_api.engine, "before_cursor_execute", capture_read_statement)
    try:
        response = recipe_current_api.anonymous.get(f"/api/recipes/{FIRST_VERSION_ID}/history")
    finally:
        event.remove(recipe_current_api.engine, "before_cursor_execute", capture_read_statement)

    assert response.status_code == 200
    body = _json_object(response.json())
    editions = cast(list[dict[str, Any]], body["editions"])
    adaptations = cast(list[dict[str, Any]], body["adaptations"])
    assert body["editions_truncated"] is True
    assert body["adaptations_truncated"] is True
    assert len(editions) == 100
    assert [item["edition_number"] for item in editions] == list(range(1, 101))
    assert body["current_version_id"] == str(revision_ids[-1])
    assert all(item["is_current"] is False for item in editions)
    assert len(adaptations) == 100
    assert [item["id"] for item in adaptations] == [
        str(version_id) for version_id in reversed(adaptation_version_ids[-100:])
    ]
    assert len(statements) <= 6


def test_history_final_read_rejects_selected_version_hidden_during_query(
    recipe_current_api: RecipeCurrentApi,
) -> None:
    final_read_reached = False

    with Session(bind=recipe_current_api.engine) as session:

        def hide_selected_before_final_read(state: ORMExecuteState) -> None:
            nonlocal final_read_reached
            if not final_read_reached and "selected_current_recipe_version_id" in str(
                state.statement
            ):
                final_read_reached = True
                _moderation_hide(recipe_current_api.engine, FIRST_VERSION_ID)

        event.listen(session, "do_orm_execute", hide_selected_before_final_read)
        try:
            history = get_public_recipe_history(session, FIRST_VERSION_ID)
        finally:
            event.remove(session, "do_orm_execute", hide_selected_before_final_read)

    assert final_read_reached is True
    assert history is None


def test_history_final_read_keeps_current_identity_consistent_during_advance(
    recipe_current_api: RecipeCurrentApi,
) -> None:
    final_read_reached = False

    with Session(bind=recipe_current_api.engine) as session:

        def advance_current_before_final_read(state: ORMExecuteState) -> None:
            nonlocal final_read_reached
            if not final_read_reached and "selected_current_recipe_version_id" in str(
                state.statement
            ):
                final_read_reached = True
                _advance_current_recipe(recipe_current_api.engine)

        event.listen(session, "do_orm_execute", advance_current_before_final_read)
        try:
            history = get_public_recipe_history(session, FIRST_VERSION_ID)
        finally:
            event.remove(session, "do_orm_execute", advance_current_before_final_read)

    assert final_read_reached is True
    assert history is not None
    assert history.current_recipe_version_id == NEXT_CURRENT_VERSION_ID
    assert all(item.is_current is False for item in history.editions)
    assert NEXT_CURRENT_VERSION_ID not in {item.recipe_version_id for item in history.editions}


def test_history_api_exposes_exact_revision_and_adaptation_topology(
    recipe_current_api: RecipeCurrentApi,
) -> None:
    response = recipe_current_api.anonymous.get(f"/api/recipes/{CURRENT_VERSION_ID}/history")

    assert response.status_code == 200
    body = _json_object(response.json())
    assert body["recipe_id"] == str(RECIPE_ID)
    assert body["selected_version_id"] == str(CURRENT_VERSION_ID)
    assert body["current_version_id"] == str(CURRENT_VERSION_ID)
    assert body["editions_truncated"] is False
    assert body["adaptations_truncated"] is False
    assert [item["id"] for item in body["editions"]] == [
        str(FIRST_VERSION_ID),
        str(CURRENT_VERSION_ID),
    ]
    correction = body["editions"][1]
    assert correction["relation_kind"] == "revision"
    assert correction["previous_version_id"] == str(FIRST_VERSION_ID)
    assert correction["adaptation_source_version_id"] is None
    assert correction["declared_change_reason"] == "correction"
    assert correction["is_current"] is True
    assert correction["author"] == {
        "id": str(AUTHOR_ID),
        "handle": "edition_author",
        "display_name": "Edition Author",
    }

    assert [item["id"] for item in body["adaptations"]] == [str(ADAPTATION_CURRENT_VERSION_ID)]
    revised_adaptation = body["adaptations"][0]
    assert revised_adaptation["recipe_id"] == str(ADAPTATION_RECIPE_ID)
    assert revised_adaptation["edition_number"] == 2
    assert revised_adaptation["relation_kind"] == "revision"
    assert revised_adaptation["previous_version_id"] == str(ADAPTATION_VERSION_ID)
    assert revised_adaptation["adaptation_source_version_id"] == str(FIRST_VERSION_ID)
    assert revised_adaptation["declared_change_reason"] == "update"
    assert revised_adaptation["is_current"] is True


def test_history_omits_hidden_predecessor_data_but_preserves_exact_topology(
    recipe_current_api: RecipeCurrentApi,
) -> None:
    _moderation_hide(recipe_current_api.engine, FIRST_VERSION_ID)

    response = recipe_current_api.anonymous.get(f"/api/recipes/{CURRENT_VERSION_ID}/history")
    hidden_selected = recipe_current_api.anonymous.get(f"/api/recipes/{FIRST_VERSION_ID}/history")

    assert response.status_code == 200
    body = _json_object(response.json())
    assert [item["id"] for item in body["editions"]] == [str(CURRENT_VERSION_ID)]
    assert body["editions"][0]["previous_version_id"] == str(FIRST_VERSION_ID)
    assert body["adaptations"][0]["adaptation_source_version_id"] == str(FIRST_VERSION_ID)
    assert "Original exact edition" not in response.text
    assert hidden_selected.status_code == 404


def test_history_keeps_revised_adaptation_branch_when_its_first_edition_is_hidden(
    recipe_current_api: RecipeCurrentApi,
) -> None:
    _moderation_hide(recipe_current_api.engine, ADAPTATION_VERSION_ID)

    response = recipe_current_api.anonymous.get(f"/api/recipes/{FIRST_VERSION_ID}/history")

    assert response.status_code == 200
    body = _json_object(response.json())
    assert [item["id"] for item in body["adaptations"]] == [str(ADAPTATION_CURRENT_VERSION_ID)]
    revised_adaptation = body["adaptations"][0]
    assert revised_adaptation["relation_kind"] == "revision"
    assert revised_adaptation["previous_version_id"] == str(ADAPTATION_VERSION_ID)
    assert revised_adaptation["adaptation_source_version_id"] == str(FIRST_VERSION_ID)
    assert "Adaptation pinned to the original" not in response.text


def test_history_hidden_current_has_no_fallback_but_hidden_source_keeps_exact_id(
    recipe_current_api: RecipeCurrentApi,
) -> None:
    response = recipe_current_api.anonymous.get(f"/api/recipes/{HIDDEN_FIRST_VERSION_ID}/history")
    hidden_selected = recipe_current_api.anonymous.get(
        f"/api/recipes/{HIDDEN_CURRENT_VERSION_ID}/history"
    )

    assert response.status_code == 200
    body = _json_object(response.json())
    assert body["recipe_id"] == str(HIDDEN_RECIPE_ID)
    assert body["current_version_id"] is None
    assert [item["id"] for item in body["editions"]] == [str(HIDDEN_FIRST_VERSION_ID)]
    assert [item["id"] for item in body["adaptations"]] == [
        str(HIDDEN_SOURCE_ADAPTATION_VERSION_ID)
    ]
    assert body["adaptations"][0]["adaptation_source_version_id"] == str(HIDDEN_CURRENT_VERSION_ID)
    assert "Moderation-hidden current edition" not in response.text
    assert hidden_selected.status_code == 404


def test_history_omits_adaptation_when_its_current_is_hidden_without_fallback(
    recipe_current_api: RecipeCurrentApi,
) -> None:
    _moderation_hide(recipe_current_api.engine, ADAPTATION_CURRENT_VERSION_ID)

    response = recipe_current_api.anonymous.get(f"/api/recipes/{FIRST_VERSION_ID}/history")

    assert response.status_code == 200
    body = _json_object(response.json())
    assert body["adaptations"] == []
    assert str(ADAPTATION_VERSION_ID) not in response.text


def test_revised_adaptation_keeps_a_safe_stable_origin_reference(
    recipe_current_api: RecipeCurrentApi,
) -> None:
    first_edition_response = recipe_current_api.anonymous.get(
        f"/api/recipes/{ADAPTATION_VERSION_ID}"
    )
    current_response = recipe_current_api.anonymous.get(
        f"/api/recipes/current/{ADAPTATION_RECIPE_ID}"
    )
    browse_response = recipe_current_api.anonymous.get(
        "/api/recipes",
        params={"page_size": 100},
    )

    assert first_edition_response.status_code == 200
    assert current_response.status_code == 200
    assert browse_response.status_code == 200
    first_edition = _json_object(first_edition_response.json())
    current = _json_object(current_response.json())
    cards = {
        item["id"]: item
        for item in cast(
            list[dict[str, Any]],
            _json_object(browse_response.json())["items"],
        )
    }

    assert first_edition["relation_kind"] == "adaptation"
    assert first_edition["parent_version_id"] == str(FIRST_VERSION_ID)
    assert first_edition["adaptation_source"]["id"] == str(FIRST_VERSION_ID)
    assert first_edition["current_version"]["id"] == str(ADAPTATION_CURRENT_VERSION_ID)

    assert current["id"] == str(ADAPTATION_CURRENT_VERSION_ID)
    assert current["relation_kind"] == "revision"
    assert current["parent_version_id"] is None
    assert current["previous_version_id"] == str(ADAPTATION_VERSION_ID)
    assert current["adaptation_source"]["id"] == str(FIRST_VERSION_ID)
    assert cards[str(ADAPTATION_CURRENT_VERSION_ID)]["adaptation_source"]["id"] == str(
        FIRST_VERSION_ID
    )

    hidden_source_card = cards[str(HIDDEN_SOURCE_ADAPTATION_VERSION_ID)]
    assert hidden_source_card["relation_kind"] == "adaptation"
    assert hidden_source_card["parent_version_id"] == str(HIDDEN_CURRENT_VERSION_ID)
    assert hidden_source_card["parent"] is None
    assert hidden_source_card["adaptation_source"] is None
    assert "Moderation-hidden current edition" not in browse_response.text


def test_hidden_current_never_falls_back_or_leaks_through_an_exact_read(
    recipe_current_api: RecipeCurrentApi,
) -> None:
    stable = recipe_current_api.anonymous.get(f"/api/recipes/current/{HIDDEN_RECIPE_ID}")
    exact = recipe_current_api.anonymous.get(f"/api/recipes/{HIDDEN_FIRST_VERSION_ID}")

    assert stable.status_code == 404
    assert str(HIDDEN_CURRENT_VERSION_ID) not in stable.text
    assert exact.status_code == 200
    exact_body = _json_object(exact.json())
    assert exact_body["id"] == str(HIDDEN_FIRST_VERSION_ID)
    assert exact_body["is_current"] is False
    assert exact_body["current_version"] is None
    assert str(HIDDEN_CURRENT_VERSION_ID) not in exact.text


def test_discovery_and_authored_libraries_show_only_current_editions(
    recipe_current_api: RecipeCurrentApi,
) -> None:
    browse = _json_object(
        recipe_current_api.anonymous.get("/api/recipes", params={"page_size": 100}).json()
    )
    originals = _json_object(
        recipe_current_api.anonymous.get(
            "/api/recipes",
            params={"is_variant": False, "page_size": 100},
        ).json()
    )
    adaptations = _json_object(
        recipe_current_api.anonymous.get(
            "/api/recipes",
            params={"is_variant": True, "page_size": 100},
        ).json()
    )
    profile = _json_object(
        recipe_current_api.anonymous.get(
            "/api/cooks/edition_author",
            params={"page_size": 100},
        ).json()
    )
    library = _json_object(
        recipe_current_api.member.get(
            "/api/my/recipes",
            params={"view": "published", "page_size": 100},
        ).json()
    )

    assert {item["id"] for item in browse["items"]} == {
        str(CURRENT_VERSION_ID),
        str(ADAPTATION_CURRENT_VERSION_ID),
        str(HIDDEN_SOURCE_ADAPTATION_VERSION_ID),
    }
    assert [item["id"] for item in originals["items"]] == [str(CURRENT_VERSION_ID)]
    assert {item["id"] for item in adaptations["items"]} == {
        str(ADAPTATION_CURRENT_VERSION_ID),
        str(HIDDEN_SOURCE_ADAPTATION_VERSION_ID),
    }
    assert {item["id"] for item in profile["items"]} == {
        str(CURRENT_VERSION_ID),
        str(ADAPTATION_CURRENT_VERSION_ID),
        str(HIDDEN_SOURCE_ADAPTATION_VERSION_ID),
    }
    library_items = cast(list[dict[str, Any]], library["items"])
    assert {item["recipe"]["id"] for item in library_items} == {
        str(CURRENT_VERSION_ID),
        str(ADAPTATION_CURRENT_VERSION_ID),
        str(HIDDEN_CURRENT_VERSION_ID),
        str(HIDDEN_SOURCE_ADAPTATION_VERSION_ID),
    }
    assert all(item["recipe"]["is_current"] for item in library_items)


def test_community_and_recommendations_exclude_superseded_exact_versions(
    recipe_current_api: RecipeCurrentApi,
) -> None:
    community_response = recipe_current_api.follower.get(
        "/api/my/community-activity",
        params={"page_size": 100},
    )
    recommendations_response = recipe_current_api.anonymous.get(
        "/api/recommendations",
        params={"limit": 50},
    )

    assert community_response.status_code == 200
    assert recommendations_response.status_code == 200
    community_ids = {
        item["id"]
        for item in cast(
            list[dict[str, Any]],
            _json_object(community_response.json())["items"],
        )
    }
    recommendation_ids = {
        item["recipe"]["id"]
        for item in cast(
            list[dict[str, Any]],
            _json_object(recommendations_response.json())["items"],
        )
    }

    for ids in (community_ids, recommendation_ids):
        assert str(CURRENT_VERSION_ID) in ids
        assert str(ADAPTATION_CURRENT_VERSION_ID) in ids
        assert str(FIRST_VERSION_ID) not in ids
        assert str(ADAPTATION_VERSION_ID) not in ids


def test_editorial_stable_ids_resolve_in_order_without_a_hidden_fallback(
    recipe_current_api: RecipeCurrentApi,
) -> None:
    with Session(bind=recipe_current_api.engine) as session:
        versions = list_public_current_recipe_versions_in_order(
            session,
            (ADAPTATION_RECIPE_ID, HIDDEN_RECIPE_ID, RECIPE_ID),
        )

    assert [version.id for version in versions] == [
        ADAPTATION_CURRENT_VERSION_ID,
        CURRENT_VERSION_ID,
    ]


def test_newest_browse_uses_stable_recipe_id_for_equal_publication_times(
    recipe_current_api: RecipeCurrentApi,
) -> None:
    response = recipe_current_api.anonymous.get(
        "/api/recipes",
        params={"sort": "newest", "page_size": 100},
    )

    assert response.status_code == 200
    ids = [
        item["id"] for item in cast(list[dict[str, Any]], _json_object(response.json())["items"])
    ]
    assert ids.index(str(CURRENT_VERSION_ID)) < ids.index(str(ADAPTATION_CURRENT_VERSION_ID))


def test_saved_library_stays_pinned_and_only_links_a_readable_newer_current(
    recipe_current_api: RecipeCurrentApi,
) -> None:
    response = recipe_current_api.member.get(
        "/api/my/saved-recipes",
        params={"page_size": 100},
    )

    assert response.status_code == 200
    items = {
        item["recipe"]["id"]: item
        for item in cast(list[dict[str, Any]], _json_object(response.json())["items"])
    }
    assert set(items) == {
        str(FIRST_VERSION_ID),
        str(CURRENT_VERSION_ID),
        str(HIDDEN_FIRST_VERSION_ID),
    }
    first = items[str(FIRST_VERSION_ID)]
    assert first["recipe"]["is_current"] is False
    assert first["recipe"]["current_version"]["id"] == str(CURRENT_VERSION_ID)
    hidden = items[str(HIDDEN_FIRST_VERSION_ID)]
    assert hidden["recipe"]["is_current"] is False
    assert hidden["recipe"]["current_version"] is None
    current = items[str(CURRENT_VERSION_ID)]
    assert current["recipe"]["is_current"] is True
    assert current["recipe"]["current_version"]["id"] == str(CURRENT_VERSION_ID)
    assert all("newer_current_version" not in item for item in items.values())
    assert str(HIDDEN_CURRENT_VERSION_ID) not in response.text


def test_default_diff_base_follows_revision_and_adaptation_topology(
    recipe_current_api: RecipeCurrentApi,
) -> None:
    revision = recipe_current_api.anonymous.get(f"/api/recipes/{CURRENT_VERSION_ID}/diff")
    adaptation = recipe_current_api.anonymous.get(f"/api/recipes/{ADAPTATION_VERSION_ID}/diff")

    assert revision.status_code == 200
    assert adaptation.status_code == 200
    revision_body = _json_object(revision.json())
    adaptation_body = _json_object(adaptation.json())
    assert revision_body["base_version"]["id"] == str(FIRST_VERSION_ID)
    assert revision_body["target_version"]["id"] == str(CURRENT_VERSION_ID)
    assert adaptation_body["base_version"]["id"] == str(FIRST_VERSION_ID)
    assert adaptation_body["target_version"]["id"] == str(ADAPTATION_VERSION_ID)
