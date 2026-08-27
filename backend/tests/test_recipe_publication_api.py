from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from threading import Barrier
from typing import Any, NoReturn, cast
from uuid import UUID, uuid4

import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import Engine, false, func, select
from sqlalchemy.orm import Session

import app.services.recipe_duplicate_preflights as duplicate_preflight_service
import app.services.recipe_publications as publication_service
from app.api.dependencies import get_session
from app.main import create_app
from app.models import (
    PreferenceEvent,
    RecipeDraft,
    RecipeDraftIngredient,
    RecipeDraftInstruction,
    RecipeDraftInstructionAction,
    RecipeDraftInstructionActionInput,
    RecipeDraftInstructionActionMeasure,
    RecipeDuplicateDecision,
    RecipeIngredient,
    RecipeInstruction,
    RecipeInstructionAction,
    RecipeInstructionActionInput,
    RecipeInstructionActionMeasure,
    RecipeLineage,
    RecipeStructuralFingerprint,
    RecipeVersion,
    RecipeVersionPublication,
)
from app.repositories.recipes import (
    get_public_recipe_version_titles as actual_public_recipe_version_titles,
)
from app.seeds import load_bundled_catalog, seed_catalog
from app.seeds.identifiers import action_uuid, measurement_uuid, seed_uuid
from app.services.preference_events import record_preference_event as actual_record_preference_event
from tests.conftest import make_alembic_config
from tests.member_session import authenticate_client, create_member_credentials

DATASET_ID = "recipe-lab-demo-v1"
CARROT_ROOT_ID = seed_uuid(DATASET_ID, "recipe-version", "carrot-walnut-snack-cake-v1")
CHICKPEA_ID = seed_uuid(DATASET_ID, "ingredient", "chickpea")
EGG_ID = seed_uuid(DATASET_ID, "ingredient", "egg")
RED_LENTIL_ID = seed_uuid(DATASET_ID, "ingredient", "red-lentil")
GRAM_ID = measurement_uuid("unit", "g")
MINUTE_ID = measurement_uuid("unit", "minute")
MIX_ID = action_uuid("action-type", "mix")
KNEAD_ID = action_uuid("action-type", "knead")
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


def _single_ingredient_payload(
    *,
    revision: int,
    title: str,
    ingredient_id: UUID,
    ingredient_name: str,
    action_type_id: UUID,
) -> dict[str, object]:
    return {
        "revision": revision,
        "title": title,
        "description": f"A structurally distinct concurrent draft for {ingredient_name}.",
        "servings": "2.00",
        "ingredients": [
            {
                "ref": "ingredient-slot",
                "selection": {
                    "kind": "catalog",
                    "ingredient_id": str(ingredient_id),
                    "display_name": ingredient_name,
                },
                "measure": {
                    "kind": "exact",
                    "value": "137.0000",
                    "unit_id": str(GRAM_ID),
                },
                "preparation_notes": None,
            }
        ],
        "instructions": [
            {
                "ref": "action-step",
                "text": f"Prepare the {ingredient_name}.",
                "actions": [
                    {
                        "action_type_id": str(action_type_id),
                        "ingredient_refs": ["ingredient-slot"],
                        "duration": None,
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


def _run_draft_preflight(
    client: TestClient,
    draft_id: str,
    *,
    revision: int,
) -> dict[str, Any]:
    response = client.post(
        f"/api/recipe-drafts/{draft_id}/duplicate-preflights",
        headers={"Idempotency-Key": str(uuid4())},
        json={"revision": revision},
    )
    assert response.status_code == 201, response.text
    return _json_object(response.json())


def _publication_payload(
    evidence: dict[str, Any],
    *,
    revision: int,
    decision: str | None = None,
) -> dict[str, object]:
    acknowledgement = _json_object(evidence["acknowledgement"])
    return {
        "revision": revision,
        "community_rules_accepted": True,
        "content_rights_confirmed": True,
        "duplicate_review": {
            "preflight_id": acknowledgement["preflight_id"],
            "policy_version": acknowledgement["policy_version"],
            "result_digest": acknowledgement["result_digest"],
            "decision": decision,
        },
    }


def _publish_complete_original(api: PublicationApi) -> UUID:
    draft_id = _create_complete_draft(api)
    evidence = _run_draft_preflight(api.member, draft_id, revision=2)
    acknowledgement = _json_object(evidence["acknowledgement"])
    payload = _publication_payload(
        evidence,
        revision=2,
        decision="continue" if acknowledgement["required"] else None,
    )
    response = api.member.post(
        f"/api/recipe-drafts/{draft_id}/publish",
        headers={"Idempotency-Key": str(uuid4())},
        json=payload,
    )
    assert response.status_code == 201, response.text
    return UUID(cast(str, _json_object(response.json())["recipe_version_id"]))


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

    preflight_action_id = str(uuid4())
    preflight = publication_api.member.post(
        f"/api/recipe-drafts/{draft_id}/duplicate-preflights",
        headers={"Idempotency-Key": preflight_action_id},
        json={"revision": 2},
    )
    assert preflight.status_code == 201
    assert preflight.headers["cache-control"] == "private, no-store"
    assert "Cookie" in {value.strip() for value in preflight.headers["vary"].split(",")}
    assert "location" not in preflight.headers
    evidence = _json_object(preflight.json())
    preflight_retry = publication_api.member.post(
        f"/api/recipe-drafts/{draft_id}/duplicate-preflights",
        headers={"Idempotency-Key": preflight_action_id},
        json={"revision": 2},
    )
    assert preflight_retry.status_code == 201
    assert preflight_retry.json() == preflight.json()
    assert preflight_retry.headers["cache-control"] == "private, no-store"
    assert "Cookie" in {value.strip() for value in preflight_retry.headers["vary"].split(",")}
    assert "location" not in preflight_retry.headers
    acknowledgement = _json_object(evidence["acknowledgement"])
    decision = "continue" if acknowledgement["required"] else None
    publish_payload = {
        "revision": 2,
        "community_rules_accepted": True,
        "content_rights_confirmed": True,
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
    assert retry.headers["location"] == body["location"]

    second_action = publication_api.member.post(
        f"/api/recipe-drafts/{draft_id}/publish",
        headers={"Idempotency-Key": str(uuid4())},
        json=publish_payload,
    )
    assert second_action.status_code == 201
    assert second_action.json() == published.json()
    assert second_action.headers["location"] == body["location"]
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
        assert receipt.community_rules_version == "community-rules-v1"
        assert receipt.publication_rights_confirmed_at == receipt.published_at
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


def test_cross_user_fork_publication_preserves_lineage_authorship_and_event(
    publication_api: PublicationApi,
) -> None:
    source_id = _publish_complete_original(publication_api)
    created = publication_api.other_member.post(
        "/api/recipe-drafts",
        json={"source_version_id": str(source_id)},
    )
    assert created.status_code == 201
    draft_id = str(_json_object(created.json())["id"])

    # The source author receives no authority over another member's private draft.
    assert publication_api.member.get(f"/api/recipe-drafts/{draft_id}").status_code == 404
    assert (
        publication_api.member.delete(
            f"/api/recipe-drafts/{draft_id}", params={"revision": 1}
        ).status_code
        == 404
    )

    evidence = _run_draft_preflight(
        publication_api.other_member,
        draft_id,
        revision=1,
    )
    assert evidence["classification"] == "exact_duplicate"
    assert evidence["same_lineage_no_change"] is True
    assert evidence["warnings"] == [
        {
            "code": "same_lineage_no_change",
            "message": "This version has the same canonical structure as its direct parent.",
        }
    ]
    acknowledgement = _json_object(evidence["acknowledgement"])
    assert acknowledgement["required"] is True
    assert acknowledgement["allowed_decisions"] == ["continue", "revise"]

    missing_decision = publication_api.other_member.post(
        f"/api/recipe-drafts/{draft_id}/publish",
        headers={"Idempotency-Key": str(uuid4())},
        json=_publication_payload(evidence, revision=1),
    )
    assert missing_decision.status_code == 409
    assert _json_object(_json_object(missing_decision.json())["error"])["code"] == (
        "duplicate_decision_required"
    )
    assert publication_api.other_member.get(f"/api/recipe-drafts/{draft_id}").status_code == 200

    publish_payload = _publication_payload(
        evidence,
        revision=1,
        decision="continue",
    )
    action_id = uuid4()
    published = publication_api.other_member.post(
        f"/api/recipe-drafts/{draft_id}/publish",
        headers={"Idempotency-Key": str(action_id)},
        json=publish_payload,
    )
    assert published.status_code == 201, published.text
    child_id = UUID(cast(str, _json_object(published.json())["recipe_version_id"]))
    assert child_id != source_id

    retry = publication_api.other_member.post(
        f"/api/recipe-drafts/{draft_id}/publish",
        headers={"Idempotency-Key": str(action_id)},
        json=publish_payload,
    )
    assert retry.status_code == 201
    assert retry.json() == published.json()
    new_key_retry = publication_api.other_member.post(
        f"/api/recipe-drafts/{draft_id}/publish",
        headers={"Idempotency-Key": str(uuid4())},
        json=publish_payload,
    )
    assert new_key_retry.status_code == 201
    assert new_key_retry.json() == published.json()
    changed_intent = publication_api.other_member.post(
        f"/api/recipe-drafts/{draft_id}/publish",
        headers={"Idempotency-Key": str(action_id)},
        json={**publish_payload, "revision": 2},
    )
    assert changed_intent.status_code == 409
    assert _json_object(_json_object(changed_intent.json())["error"])["code"] == (
        "idempotency_key_conflict"
    )
    second_draft = publication_api.other_member.post(
        "/api/recipe-drafts",
        json={"source_version_id": str(source_id)},
    )
    second_draft_id = str(_json_object(second_draft.json())["id"])
    second_evidence = _run_draft_preflight(
        publication_api.other_member,
        second_draft_id,
        revision=1,
    )
    conflicting_draft = publication_api.other_member.post(
        f"/api/recipe-drafts/{second_draft_id}/publish",
        headers={"Idempotency-Key": str(action_id)},
        json=_publication_payload(second_evidence, revision=1, decision="continue"),
    )
    assert conflicting_draft.status_code == 409
    assert _json_object(_json_object(conflicting_draft.json())["error"])["code"] == (
        "idempotency_key_conflict"
    )
    assert (
        publication_api.other_member.get(f"/api/recipe-drafts/{second_draft_id}").status_code == 200
    )

    detail = publication_api.member.get(f"/api/recipes/{child_id}")
    assert detail.status_code == 200
    detail_body = _json_object(detail.json())
    assert detail_body["parent_version_id"] == str(source_id)
    diff = publication_api.member.get(f"/api/recipes/{child_id}/diff")
    assert diff.status_code == 200
    assert _json_object(diff.json())["has_changes"] is False

    with Session(bind=publication_api.engine) as session:
        source = session.get(RecipeVersion, source_id)
        child = session.get(RecipeVersion, child_id)
        receipt = session.get(RecipeVersionPublication, child_id)
        assert source is not None and child is not None and receipt is not None
        assert child.lineage_id == source.lineage_id
        assert child.parent_version_id == source.id
        assert child.version_number == source.version_number + 1
        assert source.created_by_user_id == MEMBER_ID
        assert child.created_by_user_id == OTHER_MEMBER_ID
        lineage = session.get(RecipeLineage, source.lineage_id)
        assert lineage is not None and lineage.created_by_user_id == MEMBER_ID
        assert receipt.source_draft_id == UUID(draft_id)
        assert receipt.actor_user_id == OTHER_MEMBER_ID
        assert receipt.duplicate_decision_id is not None
        decision = session.get(RecipeDuplicateDecision, receipt.duplicate_decision_id)
        assert decision is not None and decision.decision == "continue"

        source_ingredients = list(
            session.scalars(
                select(RecipeIngredient).where(RecipeIngredient.recipe_version_id == source_id)
            )
        )
        child_ingredients = list(
            session.scalars(
                select(RecipeIngredient).where(RecipeIngredient.recipe_version_id == child_id)
            )
        )
        source_instructions = list(
            session.scalars(
                select(RecipeInstruction).where(RecipeInstruction.recipe_version_id == source_id)
            )
        )
        child_instructions = list(
            session.scalars(
                select(RecipeInstruction).where(RecipeInstruction.recipe_version_id == child_id)
            )
        )
        source_actions = list(
            session.scalars(
                select(RecipeInstructionAction).where(
                    RecipeInstructionAction.recipe_version_id == source_id
                )
            )
        )
        child_actions = list(
            session.scalars(
                select(RecipeInstructionAction).where(
                    RecipeInstructionAction.recipe_version_id == child_id
                )
            )
        )
        source_inputs = list(
            session.scalars(
                select(RecipeInstructionActionInput).where(
                    RecipeInstructionActionInput.recipe_version_id == source_id
                )
            )
        )
        child_inputs = list(
            session.scalars(
                select(RecipeInstructionActionInput).where(
                    RecipeInstructionActionInput.recipe_version_id == child_id
                )
            )
        )
        source_measures = list(
            session.scalars(
                select(RecipeInstructionActionMeasure).where(
                    RecipeInstructionActionMeasure.recipe_instruction_action_id.in_(
                        item.id for item in source_actions
                    )
                )
            )
        )
        child_measures = list(
            session.scalars(
                select(RecipeInstructionActionMeasure).where(
                    RecipeInstructionActionMeasure.recipe_instruction_action_id.in_(
                        item.id for item in child_actions
                    )
                )
            )
        )
        assert {item.id for item in source_ingredients}.isdisjoint(
            item.id for item in child_ingredients
        )
        assert {item.id for item in source_instructions}.isdisjoint(
            item.id for item in child_instructions
        )
        assert {item.id for item in source_actions}.isdisjoint(item.id for item in child_actions)
        assert {item.id for item in source_inputs}.isdisjoint(item.id for item in child_inputs)
        assert {
            (item.recipe_instruction_action_id, item.semantic) for item in source_measures
        }.isdisjoint((item.recipe_instruction_action_id, item.semantic) for item in child_measures)

        source_fingerprint = session.scalar(
            select(RecipeStructuralFingerprint).where(
                RecipeStructuralFingerprint.recipe_version_id == source_id
            )
        )
        child_fingerprint = session.scalar(
            select(RecipeStructuralFingerprint).where(
                RecipeStructuralFingerprint.recipe_version_id == child_id
            )
        )
        assert source_fingerprint is not None and child_fingerprint is not None
        assert child_fingerprint.digest == source_fingerprint.digest
        assert child_fingerprint.canonical_payload == source_fingerprint.canonical_payload

        events = list(
            session.scalars(
                select(PreferenceEvent).where(
                    PreferenceEvent.user_id == OTHER_MEMBER_ID,
                    PreferenceEvent.event_type == "fork",
                    PreferenceEvent.recipe_version_id == source_id,
                )
            )
        )
        assert len(events) == 1
        event = events[0]
        assert event.action_id == action_id
        assert event.related_recipe_version_id == child_id
        assert event.request_fingerprint == receipt.request_fingerprint


def test_source_unavailable_conflict_preserves_private_fork_draft(
    publication_api: PublicationApi,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_id = _publish_complete_original(publication_api)
    created = publication_api.other_member.post(
        "/api/recipe-drafts",
        json={"source_version_id": str(source_id)},
    )
    draft_id = str(_json_object(created.json())["id"])
    evidence = _run_draft_preflight(
        publication_api.other_member,
        draft_id,
        revision=1,
    )
    payload = _publication_payload(evidence, revision=1, decision="continue")
    with Session(bind=publication_api.engine) as session:
        before_versions = session.scalar(select(func.count()).select_from(RecipeVersion)) or 0
        before_events = session.scalar(select(func.count()).select_from(PreferenceEvent)) or 0

    monkeypatch.setattr(
        publication_service,
        "publicly_readable_recipe_version_filter",
        false,
    )
    response = publication_api.other_member.post(
        f"/api/recipe-drafts/{draft_id}/publish",
        headers={"Idempotency-Key": str(uuid4())},
        json=payload,
    )
    assert response.status_code == 409
    error = _json_object(_json_object(response.json())["error"])
    assert error == {
        "code": "recipe_fork_source_unavailable",
        "message": (
            "The public source recipe is no longer available. Your private draft is unchanged."
        ),
        "issues": [],
    }
    with Session(bind=publication_api.engine) as session:
        draft = session.get(RecipeDraft, UUID(draft_id))
        assert draft is not None and draft.status == "active"
        assert (session.scalar(select(func.count()).select_from(RecipeVersion)) or 0) == (
            before_versions
        )
        assert (session.scalar(select(func.count()).select_from(PreferenceEvent)) or 0) == (
            before_events
        )
        assert (
            session.scalar(
                select(RecipeVersionPublication).where(
                    RecipeVersionPublication.source_draft_id == UUID(draft_id)
                )
            )
            is None
        )


def test_source_unavailable_preflight_replay_returns_stable_conflict(
    publication_api: PublicationApi,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_id = _publish_complete_original(publication_api)
    created = publication_api.other_member.post(
        "/api/recipe-drafts",
        json={"source_version_id": str(source_id)},
    )
    draft_id = str(_json_object(created.json())["id"])
    action_id = uuid4()
    first = publication_api.other_member.post(
        f"/api/recipe-drafts/{draft_id}/duplicate-preflights",
        headers={"Idempotency-Key": str(action_id)},
        json={"revision": 1},
    )
    assert first.status_code == 201, first.text

    def hide_source(session: Session, recipe_version_ids: set[UUID]) -> dict[UUID, str]:
        return {
            recipe_version_id: title
            for recipe_version_id, title in actual_public_recipe_version_titles(
                session,
                recipe_version_ids,
            ).items()
            if recipe_version_id != source_id
        }

    monkeypatch.setattr(
        duplicate_preflight_service,
        "get_public_recipe_version_titles",
        hide_source,
    )
    replay = publication_api.other_member.post(
        f"/api/recipe-drafts/{draft_id}/duplicate-preflights",
        headers={"Idempotency-Key": str(action_id)},
        json={"revision": 1},
    )
    assert replay.status_code == 409
    assert _json_object(_json_object(replay.json())["error"]) == {
        "code": "recipe_fork_source_unavailable",
        "message": (
            "The public source recipe is no longer available. Your private draft is unchanged."
        ),
        "issues": [],
    }
    assert publication_api.other_member.get(f"/api/recipe-drafts/{draft_id}").status_code == 200
    with Session(bind=publication_api.engine) as session:
        assert (
            session.scalar(
                select(RecipeVersionPublication).where(
                    RecipeVersionPublication.source_draft_id == UUID(draft_id)
                )
            )
            is None
        )


def test_legacy_fork_event_action_conflicts_without_partial_publication(
    publication_api: PublicationApi,
) -> None:
    source_id = _publish_complete_original(publication_api)
    created = publication_api.other_member.post(
        "/api/recipe-drafts",
        json={"source_version_id": str(source_id)},
    )
    draft_id = str(_json_object(created.json())["id"])
    evidence = _run_draft_preflight(
        publication_api.other_member,
        draft_id,
        revision=1,
    )
    action_id = uuid4()
    with Session(bind=publication_api.engine) as session, session.begin():
        before_versions = session.scalar(select(func.count()).select_from(RecipeVersion)) or 0
        session.add(
            PreferenceEvent(
                action_id=action_id,
                user_id=OTHER_MEMBER_ID,
                recipe_version_id=source_id,
                event_type="fork",
                related_recipe_version_id=CARROT_ROOT_ID,
                request_fingerprint="a" * 64,
            )
        )

    response = publication_api.other_member.post(
        f"/api/recipe-drafts/{draft_id}/publish",
        headers={"Idempotency-Key": str(action_id)},
        json=_publication_payload(evidence, revision=1, decision="continue"),
    )
    assert response.status_code == 409
    assert _json_object(_json_object(response.json())["error"])["code"] == (
        "idempotency_key_conflict"
    )
    assert publication_api.other_member.get(f"/api/recipe-drafts/{draft_id}").status_code == 200
    with Session(bind=publication_api.engine) as session:
        assert (session.scalar(select(func.count()).select_from(RecipeVersion)) or 0) == (
            before_versions
        )
        assert (
            session.scalar(
                select(RecipeVersionPublication).where(
                    RecipeVersionPublication.source_draft_id == UUID(draft_id)
                )
            )
            is None
        )
        event = session.scalar(
            select(PreferenceEvent).where(
                PreferenceEvent.user_id == OTHER_MEMBER_ID,
                PreferenceEvent.event_type == "fork",
                PreferenceEvent.action_id == action_id,
            )
        )
        assert event is not None and event.related_recipe_version_id == CARROT_ROOT_ID


def test_fork_publication_rolls_back_staged_event_and_retries_once(
    publication_api: PublicationApi,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_id = _publish_complete_original(publication_api)
    created = publication_api.other_member.post(
        "/api/recipe-drafts",
        json={"source_version_id": str(source_id)},
    )
    draft_id = str(_json_object(created.json())["id"])
    evidence = _run_draft_preflight(
        publication_api.other_member,
        draft_id,
        revision=1,
    )
    payload = _publication_payload(evidence, revision=1, decision="continue")
    with Session(bind=publication_api.engine) as session:
        before_versions = session.scalar(select(func.count()).select_from(RecipeVersion)) or 0
        before_receipts = (
            session.scalar(select(func.count()).select_from(RecipeVersionPublication)) or 0
        )
        before_events = session.scalar(select(func.count()).select_from(PreferenceEvent)) or 0
        before_decisions = (
            session.scalar(select(func.count()).select_from(RecipeDuplicateDecision)) or 0
        )

    real_record_preference_event = actual_record_preference_event

    def fail_after_staging_event(*args: object, **kwargs: object) -> NoReturn:
        real_record_preference_event(*args, **kwargs)  # type: ignore[arg-type]
        raise RuntimeError("injected failure after fork event")

    monkeypatch.setattr(
        publication_service,
        "record_preference_event",
        fail_after_staging_event,
    )
    with pytest.raises(RuntimeError, match="injected failure after fork event"):
        publication_api.other_member.post(
            f"/api/recipe-drafts/{draft_id}/publish",
            headers={"Idempotency-Key": str(uuid4())},
            json=payload,
        )

    with Session(bind=publication_api.engine) as session:
        draft = session.get(RecipeDraft, UUID(draft_id))
        assert draft is not None and draft.status == "active"
        assert (session.scalar(select(func.count()).select_from(RecipeVersion)) or 0) == (
            before_versions
        )
        assert (
            session.scalar(select(func.count()).select_from(RecipeVersionPublication)) or 0
        ) == before_receipts
        assert (session.scalar(select(func.count()).select_from(PreferenceEvent)) or 0) == (
            before_events
        )
        assert (
            session.scalar(select(func.count()).select_from(RecipeDuplicateDecision)) or 0
        ) == before_decisions

    monkeypatch.setattr(
        publication_service,
        "record_preference_event",
        real_record_preference_event,
    )
    retry = publication_api.other_member.post(
        f"/api/recipe-drafts/{draft_id}/publish",
        headers={"Idempotency-Key": str(uuid4())},
        json=payload,
    )
    assert retry.status_code == 201, retry.text
    child_id = UUID(cast(str, _json_object(retry.json())["recipe_version_id"]))
    with Session(bind=publication_api.engine) as session:
        assert (session.scalar(select(func.count()).select_from(RecipeVersion)) or 0) == (
            before_versions + 1
        )
        assert (
            session.scalar(select(func.count()).select_from(RecipeVersionPublication)) or 0
        ) == before_receipts + 1
        event = session.scalar(
            select(PreferenceEvent).where(
                PreferenceEvent.user_id == OTHER_MEMBER_ID,
                PreferenceEvent.recipe_version_id == source_id,
                PreferenceEvent.related_recipe_version_id == child_id,
                PreferenceEvent.event_type == "fork",
            )
        )
        assert event is not None


def test_seeded_source_fork_normalizes_curated_measurement_labels_before_publication(
    publication_api: PublicationApi,
) -> None:
    created = publication_api.other_member.post(
        "/api/recipe-drafts",
        json={"source_version_id": str(CARROT_ROOT_ID)},
    )
    assert created.status_code == 201, created.text
    draft_id = UUID(cast(str, _json_object(created.json())["id"]))

    with Session(bind=publication_api.engine) as session:
        source_egg = session.scalar(
            select(RecipeIngredient).where(
                RecipeIngredient.recipe_version_id == CARROT_ROOT_ID,
                RecipeIngredient.ingredient_id == EGG_ID,
            )
        )
        draft_egg = session.scalar(
            select(RecipeDraftIngredient).where(
                RecipeDraftIngredient.recipe_draft_id == draft_id,
                RecipeDraftIngredient.ingredient_id == EGG_ID,
            )
        )
        assert source_egg is not None
        assert draft_egg is not None
        assert source_egg.unit_display == "count"
        assert draft_egg.unit_display == "item"

    evidence = _run_draft_preflight(
        publication_api.other_member,
        str(draft_id),
        revision=1,
    )
    published = publication_api.other_member.post(
        f"/api/recipe-drafts/{draft_id}/publish",
        headers={"Idempotency-Key": str(uuid4())},
        json=_publication_payload(evidence, revision=1, decision="continue"),
    )
    assert published.status_code == 201, published.text
    child_id = UUID(cast(str, _json_object(published.json())["recipe_version_id"]))
    with Session(bind=publication_api.engine) as session:
        child = session.get(RecipeVersion, child_id)
        assert child is not None
        assert child.parent_version_id == CARROT_ROOT_ID
        assert child.created_by_user_id == OTHER_MEMBER_ID


def test_concurrent_sibling_publications_allocate_distinct_lineage_numbers(
    publication_api: PublicationApi,
) -> None:
    root_id = _publish_complete_original(publication_api)
    first_child_draft = publication_api.other_member.post(
        "/api/recipe-drafts",
        json={"source_version_id": str(root_id)},
    )
    first_child_draft_id = str(_json_object(first_child_draft.json())["id"])
    first_evidence = _run_draft_preflight(
        publication_api.other_member,
        first_child_draft_id,
        revision=1,
    )
    first_payload = _publication_payload(first_evidence, revision=1, decision="continue")
    first_child_response = publication_api.other_member.post(
        f"/api/recipe-drafts/{first_child_draft_id}/publish",
        headers={"Idempotency-Key": str(uuid4())},
        json=first_payload,
    )
    assert first_child_response.status_code == 201, first_child_response.text

    root_sibling_draft = publication_api.member.post(
        "/api/recipe-drafts",
        json={"source_version_id": str(root_id)},
    )
    child_sibling_draft = publication_api.other_member.post(
        "/api/recipe-drafts",
        json={"source_version_id": str(root_id)},
    )
    root_sibling_draft_id = str(_json_object(root_sibling_draft.json())["id"])
    child_sibling_draft_id = str(_json_object(child_sibling_draft.json())["id"])
    saved_distinct = publication_api.other_member.put(
        f"/api/recipe-drafts/{child_sibling_draft_id}",
        json=_single_ingredient_payload(
            revision=1,
            title="Concurrent red lentil knead",
            ingredient_id=RED_LENTIL_ID,
            ingredient_name="Red lentil",
            action_type_id=KNEAD_ID,
        ),
    )
    assert saved_distinct.status_code == 200, saved_distinct.text

    root_evidence = _run_draft_preflight(
        publication_api.member,
        root_sibling_draft_id,
        revision=1,
    )
    child_evidence = _run_draft_preflight(
        publication_api.other_member,
        child_sibling_draft_id,
        revision=2,
    )
    root_ack = _json_object(root_evidence["acknowledgement"])
    child_ack = _json_object(child_evidence["acknowledgement"])
    root_payload = _publication_payload(
        root_evidence,
        revision=1,
        decision="continue" if root_ack["required"] else None,
    )
    child_payload = _publication_payload(
        child_evidence,
        revision=2,
        decision="continue" if child_ack["required"] else None,
    )
    barrier = Barrier(3)

    def publish(
        client: TestClient,
        draft_id: str,
        payload: dict[str, object],
    ) -> tuple[int, dict[str, Any]]:
        barrier.wait()
        response = client.post(
            f"/api/recipe-drafts/{draft_id}/publish",
            headers={"Idempotency-Key": str(uuid4())},
            json=payload,
        )
        return response.status_code, _json_object(response.json())

    with ThreadPoolExecutor(max_workers=2) as executor:
        requests = [
            executor.submit(
                publish,
                publication_api.member,
                root_sibling_draft_id,
                root_payload,
            ),
            executor.submit(
                publish,
                publication_api.other_member,
                child_sibling_draft_id,
                child_payload,
            ),
        ]
        barrier.wait()
        responses = [request.result(timeout=20) for request in requests]
    assert [status_code for status_code, _body in responses] == [201, 201], responses
    sibling_ids = [UUID(cast(str, body["recipe_version_id"])) for _status_code, body in responses]

    with Session(bind=publication_api.engine) as session:
        root = session.get(RecipeVersion, root_id)
        siblings = [session.get(RecipeVersion, sibling_id) for sibling_id in sibling_ids]
        assert root is not None
        assert all(sibling is not None for sibling in siblings)
        root_sibling = cast(RecipeVersion, siblings[0])
        child_sibling = cast(RecipeVersion, siblings[1])
        assert root_sibling.parent_version_id == root_id
        assert child_sibling.parent_version_id == root_id
        assert root_sibling.lineage_id == child_sibling.lineage_id == root.lineage_id
        assert sorted([root_sibling.version_number, child_sibling.version_number]) == [3, 4]
        assert root_sibling.created_by_user_id == MEMBER_ID
        assert child_sibling.created_by_user_id == OTHER_MEMBER_ID
        events = list(
            session.scalars(
                select(PreferenceEvent).where(
                    PreferenceEvent.related_recipe_version_id.in_(sibling_ids),
                    PreferenceEvent.event_type == "fork",
                )
            )
        )
        assert len(events) == 2
        assert {(event.recipe_version_id, event.related_recipe_version_id) for event in events} == {
            (root_id, sibling_ids[0]),
            (root_id, sibling_ids[1]),
        }


def test_publication_rejects_incomplete_and_stale_drafts(
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
    assert _json_object(_json_object(incomplete.json())["error"])["code"] == (
        "invalid_original_recipe_draft"
    )

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
    sourceful_id = str(_json_object(sourceful.json())["id"])
    incomplete_fork_payload = _single_ingredient_payload(
        revision=1,
        title="Incomplete source-backed draft",
        ingredient_id=RED_LENTIL_ID,
        ingredient_name="Red lentil",
        action_type_id=KNEAD_ID,
    )
    incomplete_fork_payload["instructions"] = []
    saved_sourceful = publication_api.member.put(
        f"/api/recipe-drafts/{sourceful_id}",
        json=incomplete_fork_payload,
    )
    assert saved_sourceful.status_code == 200, saved_sourceful.text
    invalid_fork = publication_api.member.post(
        f"/api/recipe-drafts/{sourceful_id}/duplicate-preflights",
        headers={"Idempotency-Key": str(uuid4())},
        json={"revision": 2},
    )
    assert invalid_fork.status_code == 422
    assert _json_object(_json_object(invalid_fork.json())["error"])["code"] == (
        "invalid_recipe_draft"
    )


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

    document = _json_object(publication_api.member.get("/openapi.json").json())
    schemas = _json_object(_json_object(document["components"])["schemas"])
    assert "RecipeOriginalPublicationRequest" in schemas
    assert "RecipeOriginalPublicationResponse" in schemas
    assert "RecipeDraftPublicationRequest" not in schemas
    assert "RecipeDraftPublicationResponse" not in schemas
    paths = _json_object(document["paths"])
    preflight_operation = _json_object(
        _json_object(paths["/api/recipe-drafts/{draft_id}/duplicate-preflights"])["post"]
    )
    publish_operation = _json_object(
        _json_object(paths["/api/recipe-drafts/{draft_id}/publish"])["post"]
    )
    assert preflight_operation["operationId"] == (
        "create_original_draft_duplicate_preflight_api_recipe_drafts__draft_id__"
        "duplicate_preflights_post"
    )
    assert publish_operation["operationId"] == (
        "publish_original_draft_api_recipe_drafts__draft_id__publish_post"
    )


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
        "community_rules_accepted": True,
        "content_rights_confirmed": True,
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
        "community_rules_accepted": True,
        "content_rights_confirmed": True,
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
