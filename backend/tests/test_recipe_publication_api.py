import json
import logging
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from hashlib import sha256
from threading import Barrier
from typing import Any, NoReturn, cast
from uuid import UUID, uuid4

import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import Engine, false, func, select
from sqlalchemy.orm import Session

import app.api.routes.recipe_publications as publication_routes
import app.services.recipe_duplicate_preflights as duplicate_preflight_service
import app.services.recipe_publications as publication_service
from app.models import (
    PreferenceEvent,
    Recipe,
    RecipeDraft,
    RecipeDraftCategory,
    RecipeDraftIngredient,
    RecipeDraftInstruction,
    RecipeDraftInstructionAction,
    RecipeDraftInstructionActionInput,
    RecipeDraftInstructionActionMeasure,
    RecipeDuplicateCandidate,
    RecipeDuplicateDecision,
    RecipeDuplicatePreflight,
    RecipeEdition,
    RecipeIngredient,
    RecipeInstruction,
    RecipeInstructionAction,
    RecipeInstructionActionInput,
    RecipeInstructionActionMeasure,
    RecipeLineage,
    RecipeRating,
    RecipeSave,
    RecipeStructuralFingerprint,
    RecipeVersion,
    RecipeVersionCategory,
    RecipeVersionPublication,
    RecipeVersionVisibilityEvent,
)
from app.repositories.recipes import (
    get_public_recipe_version_titles as actual_public_recipe_version_titles,
)
from app.seeds import load_bundled_catalog, seed_catalog
from app.seeds.identifiers import action_uuid, measurement_uuid, seed_uuid
from app.services.recipe_duplicate_preflights import RecipeDuplicatePreflightCapacityError
from tests.application import application_with_database
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
BREAKFAST_CATEGORY_ID = seed_uuid(DATASET_ID, "recipe-category", "breakfast")
QUICK_EASY_CATEGORY_ID = seed_uuid(DATASET_ID, "recipe-category", "quick-easy")


@dataclass(frozen=True, slots=True)
class PublicationApi:
    engine: Engine
    member: TestClient
    other_member: TestClient


_ROOT_PUBLICATION_WRITE_PHASES = tuple(
    phase
    for phase in publication_service._PUBLICATION_WRITE_PHASES
    if phase not in {"fork_preference_event", "predecessor_withdrawal"}
)


def _publication_row_counts(session: Session) -> dict[str, int]:
    return {
        "lineages": session.scalar(select(func.count()).select_from(RecipeLineage)) or 0,
        "recipes": session.scalar(select(func.count()).select_from(Recipe)) or 0,
        "editions": session.scalar(select(func.count()).select_from(RecipeEdition)) or 0,
        "versions": session.scalar(select(func.count()).select_from(RecipeVersion)) or 0,
        "categories": session.scalar(select(func.count()).select_from(RecipeVersionCategory)) or 0,
        "ingredients": session.scalar(select(func.count()).select_from(RecipeIngredient)) or 0,
        "instructions": session.scalar(select(func.count()).select_from(RecipeInstruction)) or 0,
        "actions": session.scalar(select(func.count()).select_from(RecipeInstructionAction)) or 0,
        "action_inputs": (
            session.scalar(select(func.count()).select_from(RecipeInstructionActionInput)) or 0
        ),
        "action_measures": (
            session.scalar(select(func.count()).select_from(RecipeInstructionActionMeasure)) or 0
        ),
        "fingerprints": (
            session.scalar(select(func.count()).select_from(RecipeStructuralFingerprint)) or 0
        ),
        "duplicate_preflights": (
            session.scalar(select(func.count()).select_from(RecipeDuplicatePreflight)) or 0
        ),
        "duplicate_candidates": (
            session.scalar(select(func.count()).select_from(RecipeDuplicateCandidate)) or 0
        ),
        "duplicate_decisions": (
            session.scalar(select(func.count()).select_from(RecipeDuplicateDecision)) or 0
        ),
        "publication_receipts": (
            session.scalar(select(func.count()).select_from(RecipeVersionPublication)) or 0
        ),
        "visibility_events": (
            session.scalar(select(func.count()).select_from(RecipeVersionVisibilityEvent)) or 0
        ),
        "preference_events": (
            session.scalar(select(func.count()).select_from(PreferenceEvent)) or 0
        ),
    }


def _operation_events(caplog: pytest.LogCaptureFixture) -> list[dict[str, str]]:
    return [
        cast(dict[str, str], json.loads(record.getMessage()))
        for record in caplog.records
        if record.name == "recipe_lab.operations"
    ]


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
    with application_with_database(
        empty_postgres_engine,
        expire_on_commit=False,
    ) as application:
        with TestClient(application) as member, TestClient(application) as other_member:
            authenticate_client(member, member_credentials)
            authenticate_client(other_member, other_credentials)
            yield PublicationApi(
                engine=empty_postgres_engine,
                member=member,
                other_member=other_member,
            )


def _json_object(value: object) -> dict[str, Any]:
    return cast(dict[str, Any], value)


def _complete_original_payload(*, revision: int = 1) -> dict[str, object]:
    return {
        "revision": revision,
        "title": "Publication test chickpeas",
        "description": "A complete private draft becoming one immutable root.",
        "servings": "2.00",
        "total_time_minutes": 35,
        "active_time_minutes": 15,
        "difficulty": "easy",
        "notes": "Rest briefly before serving.",
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
                    "value": "137.0000",
                    "unit_id": str(GRAM_ID),
                },
                "preparation_notes": "drained",
            }
        ],
        "instructions": [
            {
                "ref": "mix-step",
                "title": "Mix the chickpeas",
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
    created = api.member.post(
        "/api/recipe-drafts",
        headers={"Idempotency-Key": str(uuid4())},
        json={"draft_kind": "original", "source_version_id": None},
    )
    assert created.status_code == 201
    created_body = _json_object(created.json())
    draft_id = str(created_body["id"])
    assert created_body["categories"] == []
    saved = api.member.put(
        f"/api/recipe-drafts/{draft_id}",
        json=_complete_original_payload(),
    )
    assert saved.status_code == 200
    saved_body = _json_object(saved.json())
    assert saved_body["revision"] == 2
    assert [category["id"] for category in saved_body["categories"]] == [
        str(BREAKFAST_CATEGORY_ID),
        str(QUICK_EASY_CATEGORY_ID),
    ]
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


def _create_revision_draft(client: TestClient, source_id: UUID) -> str:
    response = client.post(
        "/api/recipe-drafts",
        headers={"Idempotency-Key": str(uuid4())},
        json={"draft_kind": "revision", "source_version_id": str(source_id)},
    )
    assert response.status_code == 201, response.text
    body = _json_object(response.json())
    assert body["draft_kind"] == "revision"
    assert body["source_version_id"] == str(source_id)
    return cast(str, body["id"])


def _publishable_payload(
    evidence: dict[str, Any],
    *,
    revision: int,
) -> dict[str, object]:
    acknowledgement = _json_object(evidence["acknowledgement"])
    return _publication_payload(
        evidence,
        revision=revision,
        decision="continue" if acknowledgement["required"] else None,
    )


def test_real_publication_unavailability_emits_only_a_correlated_fixed_event(
    publication_api: PublicationApi,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    draft_id = _create_complete_draft(publication_api)

    def unavailable(*_args: object, **_kwargs: object) -> NoReturn:
        raise RecipeDuplicatePreflightCapacityError(
            "private recipe text cook@example.test /private/draft/42"
        )

    monkeypatch.setattr(
        publication_routes,
        "run_recipe_draft_duplicate_preflight",
        unavailable,
    )
    with caplog.at_level(logging.ERROR, logger="recipe_lab.operations"):
        response = publication_api.member.post(
            f"/api/recipe-drafts/{draft_id}/duplicate-preflights",
            headers={"Idempotency-Key": str(uuid4())},
            json={"revision": 2},
        )

    assert response.status_code == 503
    correlation_id = response.headers["X-Correlation-ID"]
    assert _json_object(response.json())["error"] == {
        "code": "duplicate_preflight_unavailable",
        "message": "Duplicate preflight is temporarily unavailable. Please try again later.",
        "issues": [],
        "correlation_id": correlation_id,
    }
    assert _operation_events(caplog) == [
        {"correlation_id": correlation_id, "event": "publication_failure"}
    ]
    rendered = "\n".join(record.getMessage() for record in caplog.records)
    assert "private recipe text" not in rendered
    assert "cook@example.test" not in rendered
    assert "/private/draft/42" not in rendered


def test_publication_succeeds_with_more_than_five_hundred_public_fingerprints(
    publication_api: PublicationApi,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    exact_base_version_id = _publish_complete_original(publication_api)
    filler_count = duplicate_preflight_service.MAX_PUBLIC_DUPLICATE_COMPARISONS + 1
    with Session(bind=publication_api.engine) as session, session.begin():
        exact_fingerprint = session.scalar(
            select(RecipeStructuralFingerprint).where(
                RecipeStructuralFingerprint.recipe_version_id == exact_base_version_id
            )
        )
        assert exact_fingerprint is not None
        filler_payload = _json_object(json.loads(exact_fingerprint.canonical_payload))
        instructions = cast(list[dict[str, object]], filler_payload["instructions"])
        actions = cast(list[dict[str, object]], instructions[0]["actions"])
        actions[0]["action"] = str(KNEAD_ID)
        filler_canonical_payload = json.dumps(
            filler_payload,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        filler_digest = sha256(filler_canonical_payload.encode("utf-8")).hexdigest()

        filler_ids = [(uuid4(), uuid4(), uuid4()) for _index in range(filler_count)]
        session.add_all(
            [
                RecipeLineage(
                    id=lineage_id,
                    created_by_user_id=OTHER_MEMBER_ID,
                )
                for lineage_id, _recipe_id, _version_id in filler_ids
            ]
        )
        session.flush()
        session.add_all(
            [
                RecipeVersion(
                    id=version_id,
                    lineage_id=lineage_id,
                    parent_version_id=None,
                    created_by_user_id=OTHER_MEMBER_ID,
                    version_number=1,
                    title=f"Overlap shortlist scale fixture {index}",
                    description=None,
                    servings=Decimal("1.00"),
                )
                for index, (lineage_id, _recipe_id, version_id) in enumerate(filler_ids)
            ]
        )
        session.flush()
        session.add_all(
            [
                RecipeIngredient(
                    recipe_version_id=version_id,
                    ingredient_id=CHICKPEA_ID,
                    name="Chickpea",
                    measure_mode="unspecified",
                    quantity_min=None,
                    quantity_max=None,
                    measurement_unit_id=None,
                    unit_display=None,
                    package_size_id=None,
                    preparation_notes=None,
                    display_order=0,
                )
                for _lineage_id, _recipe_id, version_id in filler_ids
            ]
        )
        session.add_all(
            [
                RecipeStructuralFingerprint(
                    recipe_version_id=version_id,
                    algorithm_version=exact_fingerprint.algorithm_version,
                    digest=filler_digest,
                    canonical_payload=filler_canonical_payload,
                )
                for _lineage_id, _recipe_id, version_id in filler_ids
            ]
        )
        session.add_all(
            [
                RecipeVersionPublication(
                    recipe_version_id=version_id,
                    state="published",
                    state_changed_by_user_id=OTHER_MEMBER_ID,
                    actor_user_id=OTHER_MEMBER_ID,
                )
                for _lineage_id, _recipe_id, version_id in filler_ids
            ]
        )
        session.flush()
        session.add_all(
            [
                Recipe(
                    id=recipe_id,
                    lineage_id=lineage_id,
                    attributed_author_user_id=OTHER_MEMBER_ID,
                    owner_user_id=OTHER_MEMBER_ID,
                    current_recipe_version_id=version_id,
                )
                for lineage_id, recipe_id, version_id in filler_ids
            ]
        )
        session.flush()
        session.add_all(
            [
                RecipeEdition(
                    recipe_version_id=version_id,
                    recipe_id=recipe_id,
                    lineage_id=lineage_id,
                    attributed_author_user_id=OTHER_MEMBER_ID,
                    edition_number=1,
                    relation_kind="original",
                )
                for lineage_id, recipe_id, version_id in filler_ids
            ]
        )

    actual_shortlist = duplicate_preflight_service.load_public_duplicate_candidates
    shortlist_sizes: list[int] = []

    def capture_shortlist(session: Session, **kwargs: Any) -> list[Any]:
        candidates = actual_shortlist(session, **kwargs)
        shortlist_sizes.append(len(candidates))
        return candidates

    monkeypatch.setattr(
        duplicate_preflight_service,
        "load_public_duplicate_candidates",
        capture_shortlist,
    )
    draft_id = _create_complete_draft(publication_api)
    evidence = _run_draft_preflight(publication_api.member, draft_id, revision=2)
    assert shortlist_sizes == [duplicate_preflight_service.MAX_PUBLIC_DUPLICATE_COMPARISONS]
    assert evidence["classification"] == "exact_duplicate"
    assert exact_base_version_id in {
        UUID(cast(str, candidate["public_recipe_version_id"]))
        for candidate in cast(list[dict[str, object]], evidence["candidates"])
    }
    published = publication_api.member.post(
        f"/api/recipe-drafts/{draft_id}/publish",
        headers={"Idempotency-Key": str(uuid4())},
        json=_publication_payload(evidence, revision=2, decision="continue"),
    )
    assert published.status_code == 201, published.text
    assert shortlist_sizes == [
        duplicate_preflight_service.MAX_PUBLIC_DUPLICATE_COMPARISONS,
        duplicate_preflight_service.MAX_PUBLIC_DUPLICATE_COMPARISONS,
    ]
    published_version_id = UUID(cast(str, _json_object(published.json())["recipe_version_id"]))

    with Session(bind=publication_api.engine) as session:
        public_fingerprint_count = session.scalar(
            select(func.count())
            .select_from(RecipeStructuralFingerprint)
            .join(
                RecipeVersionPublication,
                RecipeVersionPublication.recipe_version_id
                == RecipeStructuralFingerprint.recipe_version_id,
            )
            .where(RecipeVersionPublication.state == "published")
        )
        receipt = session.get(RecipeVersionPublication, published_version_id)

    assert public_fingerprint_count is not None
    assert public_fingerprint_count > duplicate_preflight_service.MAX_PUBLIC_DUPLICATE_COMPARISONS
    assert receipt is not None


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
    assert detail_body["total_time_minutes"] == 35
    assert detail_body["active_time_minutes"] == 15
    assert detail_body["difficulty"] == "easy"
    assert detail_body["notes"] == "Rest briefly before serving."
    assert detail_body["categories"] == [
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
        assert version.total_time_minutes == 35
        assert version.active_time_minutes == 15
        assert version.difficulty == "easy"
        assert version.notes == "Rest briefly before serving."
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
        draft_categories = list(
            session.scalars(
                select(RecipeDraftCategory)
                .where(RecipeDraftCategory.recipe_draft_id == UUID(draft_id))
                .order_by(RecipeDraftCategory.display_order)
            )
        )
        version_categories = list(
            session.scalars(
                select(RecipeVersionCategory)
                .where(RecipeVersionCategory.recipe_version_id == version_id)
                .order_by(RecipeVersionCategory.display_order)
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
        assert [item.recipe_category_id for item in draft_categories] == [
            BREAKFAST_CATEGORY_ID,
            QUICK_EASY_CATEGORY_ID,
        ]
        assert [item.recipe_category_id for item in version_categories] == [
            BREAKFAST_CATEGORY_ID,
            QUICK_EASY_CATEGORY_ID,
        ]
        assert [item.category_name for item in version_categories] == [
            "Breakfast",
            "Quick & Easy",
        ]
        assert draft_ingredients[0].id != version_ingredients[0].id
        assert draft_instructions[0].id != version_instructions[0].id
        assert draft_actions[0].id != version_actions[0].id
        assert draft_inputs[0].id != version_inputs[0].id
        assert version_ingredients[0].ingredient_id == draft_ingredients[0].ingredient_id
        assert version_instructions[0].title == draft_instructions[0].title == ("Mix the chickpeas")
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
        headers={"Idempotency-Key": str(uuid4())},
        json={"draft_kind": "adaptation", "source_version_id": str(source_id)},
    )
    assert created.status_code == 201
    fork_body = _json_object(created.json())
    draft_id = str(fork_body["id"])
    assert [category["id"] for category in fork_body["categories"]] == [
        str(BREAKFAST_CATEGORY_ID),
        str(QUICK_EASY_CATEGORY_ID),
    ]

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
        headers={"Idempotency-Key": str(uuid4())},
        json={"draft_kind": "adaptation", "source_version_id": str(source_id)},
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
    assert [category["id"] for category in detail_body["categories"]] == [
        str(BREAKFAST_CATEGORY_ID),
        str(QUICK_EASY_CATEGORY_ID),
    ]
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
        source_receipt = session.get(RecipeVersionPublication, source_id)
        assert source_receipt is not None
        assert source_receipt.published_at <= receipt.published_at == event.occurred_at


def test_two_cook_correction_journey_preserves_the_adaptation_exact_source(
    publication_api: PublicationApi,
) -> None:
    original_v1_id = _publish_complete_original(publication_api)
    original_v1 = publication_api.member.get(f"/api/recipes/{original_v1_id}")
    assert original_v1.status_code == 200
    original_v1_body = _json_object(original_v1.json())
    stable_recipe_id = UUID(cast(str, original_v1_body["recipe_id"]))
    assert _json_object(original_v1_body["author"])["id"] == str(MEMBER_ID)

    adaptation_draft = publication_api.other_member.post(
        "/api/recipe-drafts",
        headers={"Idempotency-Key": str(uuid4())},
        json={"draft_kind": "adaptation", "source_version_id": str(original_v1_id)},
    )
    assert adaptation_draft.status_code == 201
    adaptation_draft_id = cast(str, _json_object(adaptation_draft.json())["id"])
    adaptation_evidence = _run_draft_preflight(
        publication_api.other_member,
        adaptation_draft_id,
        revision=1,
    )
    adaptation = publication_api.other_member.post(
        f"/api/recipe-drafts/{adaptation_draft_id}/publish",
        headers={"Idempotency-Key": str(uuid4())},
        json=_publishable_payload(adaptation_evidence, revision=1),
    )
    assert adaptation.status_code == 201, adaptation.text
    adaptation_id = UUID(cast(str, _json_object(adaptation.json())["recipe_version_id"]))

    public_comparison = publication_api.other_member.get(f"/api/recipes/{adaptation_id}/diff")
    assert public_comparison.status_code == 200
    public_comparison_body = _json_object(public_comparison.json())
    assert _json_object(public_comparison_body["base_version"])["id"] == str(original_v1_id)
    assert _json_object(public_comparison_body["target_version"])["id"] == str(adaptation_id)

    correction_draft_id = _create_revision_draft(publication_api.member, original_v1_id)
    correction_document = _complete_original_payload(revision=1)
    correction_document["title"] = "Publication test chickpeas, corrected"
    saved_correction = publication_api.member.put(
        f"/api/recipe-drafts/{correction_draft_id}",
        json=correction_document,
    )
    assert saved_correction.status_code == 200
    assert _json_object(saved_correction.json())["revision"] == 2
    correction_evidence = _run_draft_preflight(
        publication_api.member,
        correction_draft_id,
        revision=2,
    )
    correction = publication_api.member.post(
        f"/api/recipe-drafts/{correction_draft_id}/publish",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            **_publishable_payload(correction_evidence, revision=2),
            "declared_change_reason": "correction",
            "withdraw_predecessor": True,
        },
    )
    assert correction.status_code == 201, correction.text
    correction_v2_id = UUID(cast(str, _json_object(correction.json())["recipe_version_id"]))

    current = publication_api.member.get(f"/api/recipes/current/{stable_recipe_id}")
    assert current.status_code == 200
    current_body = _json_object(current.json())
    assert current_body["id"] == str(correction_v2_id)
    assert current_body["recipe_id"] == str(stable_recipe_id)

    unavailable_v1 = publication_api.member.get(f"/api/recipes/{original_v1_id}")
    unknown_version = publication_api.member.get(f"/api/recipes/{uuid4()}")
    assert unavailable_v1.status_code == unknown_version.status_code == 404
    unavailable_error = _json_object(_json_object(unavailable_v1.json())["error"])
    unknown_error = _json_object(_json_object(unknown_version.json())["error"])
    assert {key: value for key, value in unavailable_error.items() if key != "correlation_id"} == {
        key: value for key, value in unknown_error.items() if key != "correlation_id"
    }
    assert str(original_v1_id) not in unavailable_v1.text
    assert cast(str, original_v1_body["title"]) not in unavailable_v1.text

    adaptation_after_correction = publication_api.other_member.get(f"/api/recipes/{adaptation_id}")
    assert adaptation_after_correction.status_code == 200
    adaptation_body = _json_object(adaptation_after_correction.json())
    assert adaptation_body["id"] == str(adaptation_id)
    assert adaptation_body["parent_version_id"] == str(original_v1_id)
    assert adaptation_body["parent"] is None
    assert adaptation_body["adaptation_source"] is None
    unavailable_default_comparison = publication_api.other_member.get(
        f"/api/recipes/{adaptation_id}/diff"
    )
    assert unavailable_default_comparison.status_code == 404
    assert (
        _json_object(_json_object(unavailable_default_comparison.json())["error"])["code"]
        == "recipe_not_found"
    )

    with Session(bind=publication_api.engine) as session:
        v1 = session.get(RecipeVersion, original_v1_id)
        v1_publication = session.get(RecipeVersionPublication, original_v1_id)
        adapted = session.get(RecipeVersion, adaptation_id)
        adapted_edition = session.get(RecipeEdition, adaptation_id)
        assert v1 is not None and v1_publication is not None
        assert adapted is not None and adapted_edition is not None
        stable_recipe = session.get(Recipe, stable_recipe_id)
        assert stable_recipe is not None
        assert v1.title == "Publication test chickpeas"
        assert v1_publication.state == "author_withdrawn"
        assert stable_recipe.current_recipe_version_id == correction_v2_id
        assert adapted.created_by_user_id == OTHER_MEMBER_ID
        assert adapted.parent_version_id == original_v1_id
        assert adapted_edition.relation_kind == "adaptation"


def test_revision_draft_creation_is_owner_current_scoped_and_resumable_by_kind(
    publication_api: PublicationApi,
) -> None:
    source_id = _publish_complete_original(publication_api)

    denied = publication_api.other_member.post(
        "/api/recipe-drafts",
        headers={"Idempotency-Key": str(uuid4())},
        json={"draft_kind": "revision", "source_version_id": str(source_id)},
    )
    assert denied.status_code == 404
    assert _json_object(_json_object(denied.json())["error"])["code"] == ("recipe_source_not_found")

    creation_action_id = uuid4()
    created = publication_api.member.post(
        "/api/recipe-drafts",
        headers={"Idempotency-Key": str(creation_action_id)},
        json={"draft_kind": "revision", "source_version_id": str(source_id)},
    )
    assert created.status_code == 201
    body = _json_object(created.json())
    draft_id = cast(str, body["id"])
    assert body["draft_kind"] == "revision"
    assert body["source_version_id"] == str(source_id)
    assert publication_api.member.get(f"/api/recipe-drafts/{draft_id}").json() == body

    changed_kind = publication_api.member.post(
        "/api/recipe-drafts",
        headers={"Idempotency-Key": str(creation_action_id)},
        json={"draft_kind": "adaptation", "source_version_id": str(source_id)},
    )
    assert changed_kind.status_code == 409
    assert _json_object(_json_object(changed_kind.json())["error"])["code"] == (
        "idempotency_key_conflict"
    )

    revisions = publication_api.member.get(
        "/api/recipe-drafts",
        params={"draft_kind": "revision"},
    )
    adaptations = publication_api.member.get(
        "/api/recipe-drafts",
        params={"draft_kind": "adaptation"},
    )
    assert revisions.status_code == adaptations.status_code == 200
    assert [item["id"] for item in _json_object(revisions.json())["items"]] == [draft_id]
    assert _json_object(adaptations.json())["items"] == []


def test_revision_publication_advances_one_stable_recipe_and_stales_sibling_draft(
    publication_api: PublicationApi,
) -> None:
    source_id = _publish_complete_original(publication_api)
    first_draft_id = _create_revision_draft(publication_api.member, source_id)
    stale_draft_id = _create_revision_draft(publication_api.member, source_id)
    first_evidence = _run_draft_preflight(
        publication_api.member,
        first_draft_id,
        revision=1,
    )
    stale_evidence = _run_draft_preflight(
        publication_api.member,
        stale_draft_id,
        revision=1,
    )
    payload = {
        **_publishable_payload(first_evidence, revision=1),
        "declared_change_reason": "update",
    }
    action_id = uuid4()

    published = publication_api.member.post(
        f"/api/recipe-drafts/{first_draft_id}/publish",
        headers={"Idempotency-Key": str(action_id)},
        json=payload,
    )
    assert published.status_code == 201, published.text
    successor_id = UUID(cast(str, _json_object(published.json())["recipe_version_id"]))
    assert successor_id != source_id

    replayed = publication_api.member.post(
        f"/api/recipe-drafts/{first_draft_id}/publish",
        headers={"Idempotency-Key": str(action_id)},
        json=payload,
    )
    assert replayed.status_code == 201
    assert replayed.json() == published.json()
    changed_intent = publication_api.member.post(
        f"/api/recipe-drafts/{first_draft_id}/publish",
        headers={"Idempotency-Key": str(action_id)},
        json={**payload, "declared_change_reason": "correction"},
    )
    assert changed_intent.status_code == 409
    assert _json_object(_json_object(changed_intent.json())["error"])["code"] == (
        "idempotency_key_conflict"
    )

    stale = publication_api.member.post(
        f"/api/recipe-drafts/{stale_draft_id}/publish",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            **_publishable_payload(stale_evidence, revision=1),
            "declared_change_reason": "update",
        },
    )
    assert stale.status_code == 409
    assert _json_object(_json_object(stale.json())["error"])["code"] == (
        "recipe_revision_source_stale"
    )
    stale_detail = publication_api.member.get(f"/api/recipe-drafts/{stale_draft_id}")
    assert stale_detail.status_code == 200
    assert _json_object(stale_detail.json())["status"] == "active"
    obsolete_source_creation = publication_api.member.post(
        "/api/recipe-drafts",
        headers={"Idempotency-Key": str(uuid4())},
        json={"draft_kind": "revision", "source_version_id": str(source_id)},
    )
    assert obsolete_source_creation.status_code == 404

    source_detail = publication_api.member.get(f"/api/recipes/{source_id}")
    successor_detail = publication_api.member.get(f"/api/recipes/{successor_id}")
    other_detail = publication_api.other_member.get(f"/api/recipes/{successor_id}")
    assert {
        source_detail.status_code,
        successor_detail.status_code,
        other_detail.status_code,
    } == {200}
    assert _json_object(_json_object(source_detail.json())["viewer_state"])["can_revise"] is False
    successor_body = _json_object(successor_detail.json())
    assert _json_object(successor_body["viewer_state"])["can_revise"] is True
    assert successor_body["rating_count"] == 0
    assert successor_body["save_count"] == 0
    assert _json_object(_json_object(other_detail.json())["viewer_state"])["can_revise"] is False
    batch = publication_api.member.get(
        "/api/recipes/viewer-states",
        params=[
            ("recipe_version_id", str(source_id)),
            ("recipe_version_id", str(successor_id)),
        ],
    )
    assert batch.status_code == 200
    assert [item["can_revise"] for item in _json_object(batch.json())["items"]] == [
        False,
        True,
    ]

    with Session(bind=publication_api.engine) as session:
        source = session.get(RecipeVersion, source_id)
        successor = session.get(RecipeVersion, successor_id)
        source_edition = session.get(RecipeEdition, source_id)
        successor_edition = session.get(RecipeEdition, successor_id)
        successor_receipt = session.get(RecipeVersionPublication, successor_id)
        assert source is not None and successor is not None
        assert source_edition is not None and successor_edition is not None
        assert successor_receipt is not None
        stable_recipe = session.get(Recipe, source_edition.recipe_id)
        assert stable_recipe is not None
        assert successor.lineage_id == source.lineage_id
        assert successor.parent_version_id is None
        assert successor.version_number == source.version_number + 1
        assert successor_edition.recipe_id == source_edition.recipe_id
        assert successor_edition.edition_number == 2
        assert successor_edition.relation_kind == "revision"
        assert successor_edition.previous_recipe_version_id == source_id
        assert successor_edition.declared_change_reason == "update"
        assert stable_recipe.current_recipe_version_id == successor_id
        # RecipeEdition + the existing immutable publication receipt are the
        # publication-domain revision event; preference events remain fork-only.
        assert successor_receipt.source_draft_id == UUID(first_draft_id)
        assert successor_receipt.action_id == action_id
        assert successor_receipt.actor_user_id == MEMBER_ID
        assert (
            session.get(
                RecipeSave,
                {"user_id": MEMBER_ID, "recipe_version_id": successor_id},
            )
            is None
        )
        assert (
            session.get(
                RecipeRating,
                {"user_id": MEMBER_ID, "recipe_version_id": successor_id},
            )
            is None
        )
        assert (
            session.scalar(
                select(func.count())
                .select_from(PreferenceEvent)
                .where(PreferenceEvent.related_recipe_version_id == successor_id)
            )
            or 0
        ) == 0


def test_concurrent_revision_publications_choose_one_current_successor(
    publication_api: PublicationApi,
) -> None:
    source_id = _publish_complete_original(publication_api)
    draft_ids = [
        _create_revision_draft(publication_api.member, source_id),
        _create_revision_draft(publication_api.member, source_id),
    ]
    evidence = [
        _run_draft_preflight(publication_api.member, draft_id, revision=1) for draft_id in draft_ids
    ]
    payloads = [
        {
            **_publishable_payload(item, revision=1),
            "declared_change_reason": "update",
        }
        for item in evidence
    ]
    with Session(bind=publication_api.engine) as session:
        before_versions = session.scalar(select(func.count()).select_from(RecipeVersion)) or 0
        source_edition = session.get(RecipeEdition, source_id)
        assert source_edition is not None
        recipe_id = source_edition.recipe_id

    barrier = Barrier(3)

    def publish(index: int) -> tuple[str, int, object]:
        barrier.wait()
        response = publication_api.member.post(
            f"/api/recipe-drafts/{draft_ids[index]}/publish",
            headers={"Idempotency-Key": str(uuid4())},
            json=payloads[index],
        )
        return draft_ids[index], response.status_code, response.json()

    with ThreadPoolExecutor(max_workers=2) as executor:
        requests = [executor.submit(publish, index) for index in range(2)]
        barrier.wait()
        results = [request.result(timeout=20) for request in requests]

    assert sorted(status for _draft_id, status, _body in results) == [201, 409]
    losing_draft_id, _status, losing_body = next(result for result in results if result[1] == 409)
    assert _json_object(_json_object(losing_body)["error"])["code"] == (
        "recipe_revision_source_stale"
    )
    winning_body = _json_object(next(result[2] for result in results if result[1] == 201))
    successor_id = UUID(cast(str, winning_body["recipe_version_id"]))
    assert publication_api.member.get(f"/api/recipe-drafts/{losing_draft_id}").status_code == 200

    with Session(bind=publication_api.engine) as session:
        stable_recipe = session.get(Recipe, recipe_id)
        assert stable_recipe is not None
        assert stable_recipe.current_recipe_version_id == successor_id
        assert (session.scalar(select(func.count()).select_from(RecipeVersion)) or 0) == (
            before_versions + 1
        )
        editions = list(
            session.scalars(
                select(RecipeEdition)
                .where(RecipeEdition.recipe_id == recipe_id)
                .order_by(RecipeEdition.edition_number)
            )
        )
        assert [edition.recipe_version_id for edition in editions] == [source_id, successor_id]
        assert [edition.relation_kind for edition in editions] == ["original", "revision"]
        assert editions[-1].previous_recipe_version_id == source_id
        active_drafts = list(
            session.scalars(select(RecipeDraft).where(RecipeDraft.id.in_(map(UUID, draft_ids))))
        )
        assert sorted(draft.status for draft in active_drafts) == ["active", "published"]


def test_revision_of_adaptation_keeps_the_cross_recipe_source_pinned(
    publication_api: PublicationApi,
) -> None:
    root_id = _publish_complete_original(publication_api)
    adaptation = publication_api.other_member.post(
        "/api/recipe-drafts",
        headers={"Idempotency-Key": str(uuid4())},
        json={"draft_kind": "adaptation", "source_version_id": str(root_id)},
    )
    assert adaptation.status_code == 201
    adaptation_draft_id = cast(str, _json_object(adaptation.json())["id"])
    adaptation_evidence = _run_draft_preflight(
        publication_api.other_member,
        adaptation_draft_id,
        revision=1,
    )
    adapted = publication_api.other_member.post(
        f"/api/recipe-drafts/{adaptation_draft_id}/publish",
        headers={"Idempotency-Key": str(uuid4())},
        json=_publishable_payload(adaptation_evidence, revision=1),
    )
    assert adapted.status_code == 201, adapted.text
    adapted_id = UUID(cast(str, _json_object(adapted.json())["recipe_version_id"]))

    revision_draft_id = _create_revision_draft(publication_api.other_member, adapted_id)
    revision_evidence = _run_draft_preflight(
        publication_api.other_member,
        revision_draft_id,
        revision=1,
    )
    revised = publication_api.other_member.post(
        f"/api/recipe-drafts/{revision_draft_id}/publish",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            **_publishable_payload(revision_evidence, revision=1),
            "declared_change_reason": "update",
        },
    )
    assert revised.status_code == 201, revised.text
    revised_id = UUID(cast(str, _json_object(revised.json())["recipe_version_id"]))

    detail = publication_api.other_member.get(f"/api/recipes/{revised_id}")
    assert detail.status_code == 200
    detail_body = _json_object(detail.json())
    assert detail_body["parent_version_id"] is None
    assert _json_object(detail_body["adaptation_source"])["id"] == str(root_id)

    with Session(bind=publication_api.engine) as session:
        root = session.get(RecipeVersion, root_id)
        adapted_version = session.get(RecipeVersion, adapted_id)
        revised_version = session.get(RecipeVersion, revised_id)
        adapted_edition = session.get(RecipeEdition, adapted_id)
        revised_edition = session.get(RecipeEdition, revised_id)
        assert root is not None and adapted_version is not None and revised_version is not None
        assert adapted_edition is not None and revised_edition is not None
        assert adapted_version.parent_version_id == root_id
        assert revised_version.parent_version_id is None
        assert revised_version.lineage_id == adapted_version.lineage_id == root.lineage_id
        assert adapted_edition.relation_kind == "adaptation"
        assert adapted_edition.edition_number == 1
        assert revised_edition.recipe_id == adapted_edition.recipe_id
        assert revised_edition.relation_kind == "revision"
        assert revised_edition.edition_number == 2
        assert revised_edition.previous_recipe_version_id == adapted_id
        events = list(
            session.scalars(
                select(PreferenceEvent)
                .where(
                    PreferenceEvent.user_id == OTHER_MEMBER_ID,
                    PreferenceEvent.event_type == "fork",
                    PreferenceEvent.related_recipe_version_id.in_((adapted_id, revised_id)),
                )
                .order_by(PreferenceEvent.id)
            )
        )
        assert [(event.recipe_version_id, event.related_recipe_version_id) for event in events] == [
            (root_id, adapted_id)
        ]


def test_correction_withdrawal_is_atomic_audited_and_replay_safe(
    publication_api: PublicationApi,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_id = _publish_complete_original(publication_api)
    draft_id = _create_revision_draft(publication_api.member, source_id)
    evidence = _run_draft_preflight(publication_api.member, draft_id, revision=1)
    payload = {
        **_publishable_payload(evidence, revision=1),
        "declared_change_reason": "correction",
        "withdraw_predecessor": True,
    }
    action_id = uuid4()
    with Session(bind=publication_api.engine) as session:
        before = _publication_row_counts(session)

    def fail_after_predecessor_withdrawal(phase: str) -> None:
        if phase == "predecessor_withdrawal":
            raise RuntimeError("injected failure after predecessor withdrawal")

    monkeypatch.setattr(
        publication_service,
        "_test_publication_write_checkpoint",
        fail_after_predecessor_withdrawal,
    )
    failed = publication_api.member.post(
        f"/api/recipe-drafts/{draft_id}/publish",
        headers={"Idempotency-Key": str(action_id)},
        json=payload,
    )
    assert failed.status_code == 500
    with Session(bind=publication_api.engine) as session:
        source_publication = session.get(RecipeVersionPublication, source_id)
        source_edition = session.get(RecipeEdition, source_id)
        draft = session.get(RecipeDraft, UUID(draft_id))
        assert source_publication is not None and source_publication.state == "published"
        assert source_edition is not None
        stable_recipe = session.get(Recipe, source_edition.recipe_id)
        assert stable_recipe is not None and stable_recipe.current_recipe_version_id == source_id
        assert draft is not None and draft.status == "active"
        assert _publication_row_counts(session) == before

    monkeypatch.setattr(
        publication_service,
        "_test_publication_write_checkpoint",
        lambda _phase: None,
    )
    published = publication_api.member.post(
        f"/api/recipe-drafts/{draft_id}/publish",
        headers={"Idempotency-Key": str(action_id)},
        json=payload,
    )
    assert published.status_code == 201, published.text
    successor_id = UUID(cast(str, _json_object(published.json())["recipe_version_id"]))
    replayed = publication_api.member.post(
        f"/api/recipe-drafts/{draft_id}/publish",
        headers={"Idempotency-Key": str(action_id)},
        json=payload,
    )
    assert replayed.status_code == 201
    assert replayed.json() == published.json()
    assert publication_api.member.get(f"/api/recipes/{source_id}").status_code == 404

    with Session(bind=publication_api.engine) as session:
        source_publication = session.get(RecipeVersionPublication, source_id)
        successor_publication = session.get(RecipeVersionPublication, successor_id)
        successor_edition = session.get(RecipeEdition, successor_id)
        assert source_publication is not None
        assert source_publication.state == "author_withdrawn"
        assert source_publication.author_withdrawn_at is not None
        assert successor_publication is not None and successor_publication.state == "published"
        assert successor_edition is not None
        assert successor_edition.declared_change_reason == "correction"
        assert successor_edition.previous_recipe_version_id == source_id
        visibility_events = list(
            session.scalars(
                select(RecipeVersionVisibilityEvent)
                .where(RecipeVersionVisibilityEvent.recipe_version_id == source_id)
                .order_by(
                    RecipeVersionVisibilityEvent.occurred_at,
                    RecipeVersionVisibilityEvent.id,
                )
            )
        )
        assert [event.state for event in visibility_events][-2:] == [
            "published",
            "author_withdrawn",
        ]
        assert visibility_events[-1].previous_state == "published"


def test_revision_publish_never_restores_a_moderation_hidden_source(
    publication_api: PublicationApi,
) -> None:
    source_id = _publish_complete_original(publication_api)
    draft_id = _create_revision_draft(publication_api.member, source_id)
    evidence = _run_draft_preflight(publication_api.member, draft_id, revision=1)
    payload = {
        **_publishable_payload(evidence, revision=1),
        "declared_change_reason": "correction",
        "withdraw_predecessor": True,
    }
    hidden_at = datetime.now(UTC)
    with Session(bind=publication_api.engine) as session, session.begin():
        before_versions = session.scalar(select(func.count()).select_from(RecipeVersion)) or 0
        publication = session.get(RecipeVersionPublication, source_id)
        assert publication is not None
        publication.state = "moderation_hidden"
        publication.moderation_hidden_at = hidden_at
        publication.state_changed_at = hidden_at
        publication.state_changed_by_user_id = OTHER_MEMBER_ID

    viewer_states = publication_api.member.get(
        "/api/recipes/viewer-states",
        params={"recipe_version_id": str(source_id)},
    )
    assert viewer_states.status_code == 200
    assert _json_object(_json_object(viewer_states.json())["items"][0])["can_revise"] is False

    response = publication_api.member.post(
        f"/api/recipe-drafts/{draft_id}/publish",
        headers={"Idempotency-Key": str(uuid4())},
        json=payload,
    )
    assert response.status_code == 409
    assert _json_object(_json_object(response.json())["error"])["code"] == (
        "recipe_revision_source_stale"
    )
    assert publication_api.member.get(f"/api/recipe-drafts/{draft_id}").status_code == 200

    with Session(bind=publication_api.engine) as session:
        publication = session.get(RecipeVersionPublication, source_id)
        assert publication is not None
        assert publication.state == "moderation_hidden"
        assert publication.moderation_hidden_at == hidden_at
        assert (session.scalar(select(func.count()).select_from(RecipeVersion)) or 0) == (
            before_versions
        )


def test_source_unavailable_conflict_preserves_private_fork_draft(
    publication_api: PublicationApi,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_id = _publish_complete_original(publication_api)
    created = publication_api.other_member.post(
        "/api/recipe-drafts",
        headers={"Idempotency-Key": str(uuid4())},
        json={"draft_kind": "adaptation", "source_version_id": str(source_id)},
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
    correlation_id = response.headers["X-Correlation-ID"]
    assert error == {
        "code": "recipe_fork_source_unavailable",
        "message": (
            "The public source recipe is no longer available. Your private draft is unchanged."
        ),
        "issues": [],
        "correlation_id": correlation_id,
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
        headers={"Idempotency-Key": str(uuid4())},
        json={"draft_kind": "adaptation", "source_version_id": str(source_id)},
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
    replay_correlation_id = replay.headers["X-Correlation-ID"]
    assert _json_object(_json_object(replay.json())["error"]) == {
        "code": "recipe_fork_source_unavailable",
        "message": (
            "The public source recipe is no longer available. Your private draft is unchanged."
        ),
        "issues": [],
        "correlation_id": replay_correlation_id,
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


def test_existing_fork_event_action_conflicts_without_partial_publication(
    publication_api: PublicationApi,
) -> None:
    source_id = _publish_complete_original(publication_api)
    created = publication_api.other_member.post(
        "/api/recipe-drafts",
        headers={"Idempotency-Key": str(uuid4())},
        json={"draft_kind": "adaptation", "source_version_id": str(source_id)},
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
        headers={"Idempotency-Key": str(uuid4())},
        json={"draft_kind": "adaptation", "source_version_id": str(source_id)},
    )
    draft_id = str(_json_object(created.json())["id"])
    evidence = _run_draft_preflight(
        publication_api.other_member,
        draft_id,
        revision=1,
    )
    payload = _publication_payload(evidence, revision=1, decision="continue")
    with Session(bind=publication_api.engine) as session:
        before = _publication_row_counts(session)

    reached: list[str] = []

    def fail_after_staging_event(phase: str) -> None:
        reached.append(phase)
        if phase == "fork_preference_event":
            raise RuntimeError("injected failure after fork event")

    monkeypatch.setattr(
        publication_service,
        "_test_publication_write_checkpoint",
        fail_after_staging_event,
    )
    failed = publication_api.other_member.post(
        f"/api/recipe-drafts/{draft_id}/publish",
        headers={"Idempotency-Key": str(uuid4())},
        json=payload,
    )
    assert failed.status_code == 500
    assert _json_object(_json_object(failed.json())["error"])["code"] == "internal_error"
    assert reached[-1] == "fork_preference_event"

    with Session(bind=publication_api.engine) as session:
        draft = session.get(RecipeDraft, UUID(draft_id))
        assert draft is not None and draft.status == "active"
        assert _publication_row_counts(session) == before

    monkeypatch.setattr(
        publication_service,
        "_test_publication_write_checkpoint",
        lambda _phase: None,
    )
    retry = publication_api.other_member.post(
        f"/api/recipe-drafts/{draft_id}/publish",
        headers={"Idempotency-Key": str(uuid4())},
        json=payload,
    )
    assert retry.status_code == 201, retry.text
    child_id = UUID(cast(str, _json_object(retry.json())["recipe_version_id"]))
    with Session(bind=publication_api.engine) as session:
        after_retry = _publication_row_counts(session)
        assert after_retry["versions"] == before["versions"] + 1
        assert after_retry["publication_receipts"] == before["publication_receipts"] + 1
        assert after_retry["preference_events"] == before["preference_events"] + 1
        assert after_retry["duplicate_decisions"] == before["duplicate_decisions"] + 1
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
        headers={"Idempotency-Key": str(uuid4())},
        json={"draft_kind": "adaptation", "source_version_id": str(CARROT_ROOT_ID)},
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
        headers={"Idempotency-Key": str(uuid4())},
        json={"draft_kind": "adaptation", "source_version_id": str(root_id)},
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
        headers={"Idempotency-Key": str(uuid4())},
        json={"draft_kind": "adaptation", "source_version_id": str(root_id)},
    )
    child_sibling_draft = publication_api.other_member.post(
        "/api/recipe-drafts",
        headers={"Idempotency-Key": str(uuid4())},
        json={"draft_kind": "adaptation", "source_version_id": str(root_id)},
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
        headers={"Idempotency-Key": str(uuid4())},
        json={"draft_kind": "original", "source_version_id": None},
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

    missing_action = publication_api.member.post(
        "/api/recipe-drafts",
        headers={"Idempotency-Key": str(uuid4())},
        json={"draft_kind": "original", "source_version_id": None},
    )
    assert missing_action.status_code == 201
    missing_action_id = str(_json_object(missing_action.json())["id"])
    missing_action_payload = _complete_original_payload()
    _json_object(cast(list[object], missing_action_payload["instructions"])[0])["actions"] = []
    saved_missing_action = publication_api.member.put(
        f"/api/recipe-drafts/{missing_action_id}",
        json=missing_action_payload,
    )
    assert saved_missing_action.status_code == 200, saved_missing_action.text
    missing_action_preflight = publication_api.member.post(
        f"/api/recipe-drafts/{missing_action_id}/duplicate-preflights",
        headers={"Idempotency-Key": str(uuid4())},
        json={"revision": 2},
    )
    assert missing_action_preflight.status_code == 422
    missing_action_error = _json_object(_json_object(missing_action_preflight.json())["error"])
    assert missing_action_error["code"] == "invalid_original_recipe_draft"
    assert missing_action_error["message"] == (
        "Add at least one confirmed cooking action in the cooking details for every "
        "instruction so Recipe Lab can compare similar recipes before publishing."
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
        headers={"Idempotency-Key": str(uuid4())},
        json={"draft_kind": "adaptation", "source_version_id": str(CARROT_ROOT_ID)},
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


def test_publication_openapi_documents_only_current_draft_operations(
    publication_api: PublicationApi,
) -> None:
    document = _json_object(publication_api.member.get("/openapi.json").json())
    schemas = _json_object(_json_object(document["components"])["schemas"])
    assert "RecipeOriginalPublicationRequest" in schemas
    assert "RecipeOriginalPublicationResponse" in schemas
    assert "RecipeDraftPublicationRequest" not in schemas
    assert "RecipeDraftPublicationResponse" not in schemas
    publication_request = _json_object(schemas["RecipeOriginalPublicationRequest"])
    request_properties = _json_object(publication_request["properties"])
    assert set(request_properties) >= {
        "declared_change_reason",
        "withdraw_predecessor",
    }
    assert _json_object(request_properties["withdraw_predecessor"])["default"] is False
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


@pytest.mark.parametrize("phase", _ROOT_PUBLICATION_WRITE_PHASES)
def test_original_publication_failure_matrix_rolls_back_every_write_phase(
    publication_api: PublicationApi,
    monkeypatch: pytest.MonkeyPatch,
    phase: str,
) -> None:
    _publish_complete_original(publication_api)
    draft_id = _create_complete_draft(publication_api)
    preflight = publication_api.member.post(
        f"/api/recipe-drafts/{draft_id}/duplicate-preflights",
        headers={"Idempotency-Key": str(uuid4())},
        json={"revision": 2},
    )
    assert preflight.status_code == 201
    acknowledgement = _json_object(_json_object(preflight.json())["acknowledgement"])
    assert acknowledgement["required"] is True
    payload = {
        "revision": 2,
        "community_rules_accepted": True,
        "content_rights_confirmed": True,
        "duplicate_review": {
            "preflight_id": acknowledgement["preflight_id"],
            "policy_version": acknowledgement["policy_version"],
            "result_digest": acknowledgement["result_digest"],
            "decision": "continue",
        },
    }
    with Session(bind=publication_api.engine) as session:
        before = _publication_row_counts(session)

    reached: list[str] = []

    def fail_at_selected_write_phase(reached_phase: str) -> None:
        reached.append(reached_phase)
        if reached_phase == phase:
            raise RuntimeError(f"injected publication failure after {phase}")

    monkeypatch.setattr(
        publication_service,
        "_test_publication_write_checkpoint",
        fail_at_selected_write_phase,
    )
    failed = publication_api.member.post(
        f"/api/recipe-drafts/{draft_id}/publish",
        headers={"Idempotency-Key": str(uuid4())},
        json=payload,
    )
    assert failed.status_code == 500
    assert _json_object(_json_object(failed.json())["error"])["code"] == "internal_error"
    assert reached[-1] == phase

    with Session(bind=publication_api.engine) as session:
        draft = session.get(RecipeDraft, UUID(draft_id))
        assert draft is not None and draft.status == "active" and draft.revision == 2
        assert _publication_row_counts(session) == before
        assert (
            session.scalar(
                select(RecipeVersionPublication).where(
                    RecipeVersionPublication.source_draft_id == UUID(draft_id)
                )
            )
            is None
        )


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
