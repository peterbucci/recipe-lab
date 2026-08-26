from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from threading import Barrier
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

import app.services.recipe_publications as publication_service
from app.api.dependencies import get_session
from app.main import create_app
from app.models import (
    RecipeDraft,
    RecipeDraftIngredient,
    RecipeDraftInstruction,
    RecipeDraftInstructionAction,
    RecipeDraftInstructionActionInput,
    RecipeDraftInstructionActionMeasure,
    RecipeIngredient,
    RecipeInstruction,
    RecipeInstructionAction,
    RecipeInstructionActionInput,
    RecipeInstructionActionMeasure,
    RecipeLineage,
    RecipeVersion,
    RecipeVersionPublication,
)
from app.seeds import load_bundled_catalog, seed_catalog
from app.seeds.identifiers import action_uuid, measurement_uuid, seed_uuid
from tests.conftest import make_alembic_config
from tests.member_session import authenticate_client, create_member_credentials

DATASET_ID = "recipe-lab-demo-v1"
CARROT_ROOT_ID = seed_uuid(DATASET_ID, "recipe-version", "carrot-walnut-snack-cake-v1")
CHICKPEA_ID = seed_uuid(DATASET_ID, "ingredient", "chickpea")
GRAM_ID = measurement_uuid("unit", "g")
MINUTE_ID = measurement_uuid("unit", "minute")
MIX_ID = action_uuid("action-type", "mix")
MEMBER_ID = UUID("7c000000-0000-4000-8000-000000000001")
OTHER_MEMBER_ID = UUID("7c000000-0000-4000-8000-000000000002")


@dataclass(frozen=True, slots=True)
class PublicationApi:
    engine: Engine
    member: TestClient
    other_member: TestClient


@pytest.fixture
def publication_api(empty_postgres_engine: Engine) -> Iterator[PublicationApi]:
    config = make_alembic_config()
    with empty_postgres_engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
    with Session(bind=empty_postgres_engine) as session, session.begin():
        seed_catalog(session, load_bundled_catalog())

    member_credentials = create_member_credentials(
        empty_postgres_engine,
        user_id=MEMBER_ID,
        handle="publication_member",
        display_name="Publication Member",
    )
    other_credentials = create_member_credentials(
        empty_postgres_engine,
        user_id=OTHER_MEMBER_ID,
        handle="other_publication_member",
        display_name="Other Publication Member",
    )
    application = create_app()

    def override_session() -> Iterator[Session]:
        with Session(bind=empty_postgres_engine, expire_on_commit=False) as session:
            yield session

    application.dependency_overrides[get_session] = override_session
    try:
        with TestClient(application) as member, TestClient(application) as other_member:
            authenticate_client(member, member_credentials)
            authenticate_client(other_member, other_credentials)
            yield PublicationApi(
                engine=empty_postgres_engine,
                member=member,
                other_member=other_member,
            )
    finally:
        application.dependency_overrides.clear()


def _json_object(value: object) -> dict[str, Any]:
    return cast(dict[str, Any], value)


def _complete_original_payload(*, revision: int = 1) -> dict[str, object]:
    return {
        "revision": revision,
        "title": "Publication test chickpeas",
        "description": "A complete private draft becoming one immutable root.",
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
                    "value": "137.0000",
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
                        "duration": {
                            "kind": "exact",
                            "value": "1.000000",
                            "unit_id": str(MINUTE_ID),
                        },
                        "temperature": None,
                    }
                ],
            }
        ],
    }


def _create_complete_draft(api: PublicationApi) -> str:
    created = api.member.post("/api/recipe-drafts", json={"source_version_id": None})
    assert created.status_code == 201
    draft_id = str(_json_object(created.json())["id"])
    saved = api.member.put(
        f"/api/recipe-drafts/{draft_id}",
        json=_complete_original_payload(),
    )
    assert saved.status_code == 200
    assert _json_object(saved.json())["revision"] == 2
    return draft_id


def test_original_draft_preflight_publish_and_exact_retry(
    publication_api: PublicationApi,
) -> None:
    draft_id = _create_complete_draft(publication_api)
    assert (
        publication_api.other_member.post(
            f"/api/recipe-drafts/{draft_id}/duplicate-preflights",
            headers={"Idempotency-Key": str(uuid4())},
            json={"revision": 2},
        ).status_code
        == 404
    )

    preflight = publication_api.member.post(
        f"/api/recipe-drafts/{draft_id}/duplicate-preflights",
        headers={"Idempotency-Key": str(uuid4())},
        json={"revision": 2},
    )
    assert preflight.status_code == 201
    assert preflight.headers["cache-control"] == "private, no-store"
    evidence = _json_object(preflight.json())
    acknowledgement = _json_object(evidence["acknowledgement"])
    decision = "continue" if acknowledgement["required"] else None
    publish_payload = {
        "revision": 2,
        "duplicate_review": {
            "preflight_id": acknowledgement["preflight_id"],
            "policy_version": acknowledgement["policy_version"],
            "result_digest": acknowledgement["result_digest"],
            "decision": decision,
        },
    }
    action_id = str(uuid4())
    before_versions: int
    with Session(bind=publication_api.engine) as session:
        before_versions = session.scalar(select(func.count()).select_from(RecipeVersion)) or 0

    published = publication_api.member.post(
        f"/api/recipe-drafts/{draft_id}/publish",
        headers={"Idempotency-Key": action_id},
        json=publish_payload,
    )
    assert published.status_code == 201
    assert published.headers["cache-control"] == "private, no-store"
    body = _json_object(published.json())
    version_id = UUID(cast(str, body["recipe_version_id"]))
    assert body["location"] == f"/recipes/{version_id}"
    assert published.headers["location"] == body["location"]

    detail = publication_api.member.get(f"/api/recipes/{version_id}")
    assert detail.status_code == 200
    detail_body = _json_object(detail.json())
    assert detail_body["parent_version_id"] is None
    assert detail_body["version_number"] == 1
    assert publication_api.member.get(f"/api/recipe-drafts/{draft_id}").status_code == 404

    retry = publication_api.member.post(
        f"/api/recipe-drafts/{draft_id}/publish",
        headers={"Idempotency-Key": action_id},
        json=publish_payload,
    )
    assert retry.status_code == 201
    assert retry.json() == published.json()

    second_action = publication_api.member.post(
        f"/api/recipe-drafts/{draft_id}/publish",
        headers={"Idempotency-Key": str(uuid4())},
        json=publish_payload,
    )
    assert second_action.status_code == 201
    assert second_action.json() == published.json()
    assert (
        publication_api.member.put(
            f"/api/recipe-drafts/{draft_id}",
            json=_complete_original_payload(revision=2),
        ).status_code
        == 404
    )
    assert (
        publication_api.member.delete(
            f"/api/recipe-drafts/{draft_id}",
            params={"revision": 2},
        ).status_code
        == 404
    )

    conflicting_retry = publication_api.member.post(
        f"/api/recipe-drafts/{draft_id}/publish",
        headers={"Idempotency-Key": action_id},
        json={**publish_payload, "revision": 3},
    )
    assert conflicting_retry.status_code == 409
    assert _json_object(_json_object(conflicting_retry.json())["error"])["code"] == (
        "idempotency_key_conflict"
    )

    with Session(bind=publication_api.engine) as session:
        draft = session.get(RecipeDraft, UUID(draft_id))
        version = session.get(RecipeVersion, version_id)
        receipt = session.get(RecipeVersionPublication, version_id)
        assert draft is not None and draft.status == "published"
        assert version is not None
        assert version.parent_version_id is None
        assert version.version_number == 1
        assert version.created_by_user_id == MEMBER_ID
        lineage = session.get(RecipeLineage, version.lineage_id)
        assert lineage is not None and lineage.created_by_user_id == MEMBER_ID
        assert receipt is not None
        assert receipt.source_draft_id == UUID(draft_id)
        assert receipt.actor_user_id == MEMBER_ID
        assert receipt.draft_revision == 2
        assert receipt.duplicate_preflight_id == UUID(cast(str, acknowledgement["preflight_id"]))
        draft_ingredients = list(
            session.scalars(
                select(RecipeDraftIngredient).where(
                    RecipeDraftIngredient.recipe_draft_id == UUID(draft_id)
                )
            )
        )
        version_ingredients = list(
            session.scalars(
                select(RecipeIngredient).where(RecipeIngredient.recipe_version_id == version_id)
            )
        )
        draft_instructions = list(
            session.scalars(
                select(RecipeDraftInstruction).where(
                    RecipeDraftInstruction.recipe_draft_id == UUID(draft_id)
                )
            )
        )
        version_instructions = list(
            session.scalars(
                select(RecipeInstruction).where(RecipeInstruction.recipe_version_id == version_id)
            )
        )
        draft_actions = list(
            session.scalars(
                select(RecipeDraftInstructionAction).where(
                    RecipeDraftInstructionAction.recipe_draft_id == UUID(draft_id)
                )
            )
        )
        version_actions = list(
            session.scalars(
                select(RecipeInstructionAction).where(
                    RecipeInstructionAction.recipe_version_id == version_id
                )
            )
        )
        draft_inputs = list(
            session.scalars(
                select(RecipeDraftInstructionActionInput).where(
                    RecipeDraftInstructionActionInput.recipe_draft_id == UUID(draft_id)
                )
            )
        )
        version_inputs = list(
            session.scalars(
                select(RecipeInstructionActionInput).where(
                    RecipeInstructionActionInput.recipe_version_id == version_id
                )
            )
        )
        draft_measures = list(
            session.scalars(
                select(RecipeDraftInstructionActionMeasure).where(
                    RecipeDraftInstructionActionMeasure.recipe_draft_instruction_action_id
                    == draft_actions[0].id
                )
            )
        )
        version_measures = list(
            session.scalars(
                select(RecipeInstructionActionMeasure).where(
                    RecipeInstructionActionMeasure.recipe_instruction_action_id
                    == version_actions[0].id
                )
            )
        )
        assert len(draft_ingredients) == len(version_ingredients) == 1
        assert len(draft_instructions) == len(version_instructions) == 1
        assert len(draft_actions) == len(version_actions) == 1
        assert len(draft_inputs) == len(version_inputs) == 1
        assert len(draft_measures) == len(version_measures) == 1
        assert draft_ingredients[0].id != version_ingredients[0].id
        assert draft_instructions[0].id != version_instructions[0].id
        assert draft_actions[0].id != version_actions[0].id
        assert draft_inputs[0].id != version_inputs[0].id
        assert version_ingredients[0].ingredient_id == draft_ingredients[0].ingredient_id
        assert version_instructions[0].instruction == draft_instructions[0].instruction
        assert version_actions[0].action_type_id == draft_actions[0].action_type_id
        assert version_inputs[0].recipe_ingredient_id == version_ingredients[0].id
        assert version_measures[0].semantic == draft_measures[0].semantic
        assert version_measures[0].quantity_min == draft_measures[0].quantity_min
        assert (session.scalar(select(func.count()).select_from(RecipeVersion)) or 0) == (
            before_versions + 1
        )


def test_original_publication_rejects_incomplete_sourceful_and_stale_drafts(
    publication_api: PublicationApi,
) -> None:
    blank = publication_api.member.post(
        "/api/recipe-drafts",
        json={"source_version_id": None},
    )
    blank_id = _json_object(blank.json())["id"]
    incomplete = publication_api.member.post(
        f"/api/recipe-drafts/{blank_id}/duplicate-preflights",
        headers={"Idempotency-Key": str(uuid4())},
        json={"revision": 1},
    )
    assert incomplete.status_code == 422

    draft_id = _create_complete_draft(publication_api)
    stale = publication_api.member.post(
        f"/api/recipe-drafts/{draft_id}/duplicate-preflights",
        headers={"Idempotency-Key": str(uuid4())},
        json={"revision": 1},
    )
    assert stale.status_code == 409
    assert _json_object(_json_object(stale.json())["error"])["code"] == (
        "recipe_draft_revision_conflict"
    )

    sourceful = publication_api.member.post(
        "/api/recipe-drafts",
        json={"source_version_id": str(CARROT_ROOT_ID)},
    )
    sourceful_id = _json_object(sourceful.json())["id"]
    rejected = publication_api.member.post(
        f"/api/recipe-drafts/{sourceful_id}/duplicate-preflights",
        headers={"Idempotency-Key": str(uuid4())},
        json={"revision": 1},
    )
    assert rejected.status_code == 422


def test_legacy_direct_variant_publication_is_a_write_free_rcp28_boundary(
    publication_api: PublicationApi,
) -> None:
    with Session(bind=publication_api.engine) as session:
        before = session.scalar(select(func.count()).select_from(RecipeVersion)) or 0
    blocked = publication_api.member.post(
        f"/api/recipes/{CARROT_ROOT_ID}/variants",
        headers={"Idempotency-Key": str(uuid4())},
        json={"unexpected": "legacy payload is not interpreted"},
    )
    assert blocked.status_code == 409
    assert _json_object(_json_object(blocked.json())["error"])["code"] == (
        "recipe_variant_publication_requires_draft"
    )
    with Session(bind=publication_api.engine) as session:
        assert (session.scalar(select(func.count()).select_from(RecipeVersion)) or 0) == before


def test_original_publication_rolls_back_every_row_and_preserves_the_draft(
    publication_api: PublicationApi,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    draft_id = _create_complete_draft(publication_api)
    preflight = publication_api.member.post(
        f"/api/recipe-drafts/{draft_id}/duplicate-preflights",
        headers={"Idempotency-Key": str(uuid4())},
        json={"revision": 2},
    )
    assert preflight.status_code == 201
    acknowledgement = _json_object(_json_object(preflight.json())["acknowledgement"])
    payload = {
        "revision": 2,
        "duplicate_review": {
            "preflight_id": acknowledgement["preflight_id"],
            "policy_version": acknowledgement["policy_version"],
            "result_digest": acknowledgement["result_digest"],
            "decision": "continue" if acknowledgement["required"] else None,
        },
    }
    with Session(bind=publication_api.engine) as session:
        before_versions = session.scalar(select(func.count()).select_from(RecipeVersion)) or 0
        before_lineages = session.scalar(select(func.count()).select_from(RecipeLineage)) or 0
        before_receipts = (
            session.scalar(select(func.count()).select_from(RecipeVersionPublication)) or 0
        )

    def fail_after_snapshot_rows(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("injected publication failure")

    monkeypatch.setattr(
        publication_service,
        "fingerprint_and_store_recipe_version",
        fail_after_snapshot_rows,
    )
    with pytest.raises(RuntimeError, match="injected publication failure"):
        publication_api.member.post(
            f"/api/recipe-drafts/{draft_id}/publish",
            headers={"Idempotency-Key": str(uuid4())},
            json=payload,
        )

    with Session(bind=publication_api.engine) as session:
        draft = session.get(RecipeDraft, UUID(draft_id))
        assert draft is not None and draft.status == "active" and draft.revision == 2
        assert (session.scalar(select(func.count()).select_from(RecipeVersion)) or 0) == (
            before_versions
        )
        assert (session.scalar(select(func.count()).select_from(RecipeLineage)) or 0) == (
            before_lineages
        )
        assert (
            session.scalar(select(func.count()).select_from(RecipeVersionPublication)) or 0
        ) == before_receipts


def test_concurrent_identical_publication_retries_reuse_one_root(
    publication_api: PublicationApi,
) -> None:
    draft_id = _create_complete_draft(publication_api)
    preflight = publication_api.member.post(
        f"/api/recipe-drafts/{draft_id}/duplicate-preflights",
        headers={"Idempotency-Key": str(uuid4())},
        json={"revision": 2},
    )
    acknowledgement = _json_object(_json_object(preflight.json())["acknowledgement"])
    payload = {
        "revision": 2,
        "duplicate_review": {
            "preflight_id": acknowledgement["preflight_id"],
            "policy_version": acknowledgement["policy_version"],
            "result_digest": acknowledgement["result_digest"],
            "decision": "continue" if acknowledgement["required"] else None,
        },
    }
    action_id = str(uuid4())
    with Session(bind=publication_api.engine) as session:
        before = session.scalar(select(func.count()).select_from(RecipeVersion)) or 0

    barrier = Barrier(3)

    def publish() -> tuple[int, object]:
        barrier.wait()
        response = publication_api.member.post(
            f"/api/recipe-drafts/{draft_id}/publish",
            headers={"Idempotency-Key": action_id},
            json=payload,
        )
        return response.status_code, response.json()

    with ThreadPoolExecutor(max_workers=2) as executor:
        requests = [executor.submit(publish) for _index in range(2)]
        barrier.wait()
        responses = [request.result(timeout=20) for request in requests]
    assert responses[0][0] == responses[1][0] == 201
    assert responses[0][1] == responses[1][1]
    with Session(bind=publication_api.engine) as session:
        assert (session.scalar(select(func.count()).select_from(RecipeVersion)) or 0) == (
            before + 1
        )
