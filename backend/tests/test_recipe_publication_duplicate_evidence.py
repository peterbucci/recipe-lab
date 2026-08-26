from collections.abc import Iterator
from dataclasses import dataclass
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
    RecipeDuplicateDecision,
    RecipeDuplicatePreflight,
    RecipeLineage,
    RecipeVersion,
    RecipeVersionPublication,
)
from app.seeds import load_bundled_catalog, seed_catalog
from app.seeds.identifiers import action_uuid, measurement_uuid, seed_uuid
from tests.conftest import isolated_postgres_engine, make_alembic_config
from tests.member_session import authenticate_client, create_member_credentials

DATASET_ID = "recipe-lab-demo-v1"
CHICKPEA_ID = seed_uuid(DATASET_ID, "ingredient", "chickpea")
GRAM_ID = measurement_uuid("unit", "g")
MINUTE_ID = measurement_uuid("unit", "minute")
MIX_ID = action_uuid("action-type", "mix")
MEMBER_ID = UUID("7d000000-0000-4000-8000-000000000001")
OTHER_MEMBER_ID = UUID("7d000000-0000-4000-8000-000000000002")
BASE_AMOUNTS = (1, 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53)


@dataclass(frozen=True, slots=True)
class DuplicateEvidenceApi:
    engine: Engine
    member: TestClient
    other_member: TestClient


@pytest.fixture(scope="module")
def duplicate_evidence_api(postgres_url: str) -> Iterator[DuplicateEvidenceApi]:
    with isolated_postgres_engine(postgres_url) as engine:
        config = make_alembic_config()
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
        with Session(bind=engine) as session, session.begin():
            seed_catalog(session, load_bundled_catalog())

        member_credentials = create_member_credentials(
            engine,
            user_id=MEMBER_ID,
            handle="duplicate_evidence_member",
            display_name="Duplicate Evidence Member",
        )
        other_credentials = create_member_credentials(
            engine,
            user_id=OTHER_MEMBER_ID,
            handle="duplicate_evidence_other",
            display_name="Other Duplicate Evidence Member",
        )
        application = create_app()

        def override_session() -> Iterator[Session]:
            with Session(bind=engine, expire_on_commit=False) as session:
                yield session

        application.dependency_overrides[get_session] = override_session
        try:
            with TestClient(application) as member, TestClient(application) as other_member:
                authenticate_client(member, member_credentials)
                authenticate_client(other_member, other_credentials)
                yield DuplicateEvidenceApi(
                    engine=engine,
                    member=member,
                    other_member=other_member,
                )
        finally:
            application.dependency_overrides.clear()


def _json_object(value: object) -> dict[str, Any]:
    return cast(dict[str, Any], value)


def _canonical_payload(*, occurrence_count: int, scale: int = 1) -> dict[str, object]:
    refs = [f"chickpea-{index}" for index in range(occurrence_count)]
    return {
        "revision": 1,
        "title": f"Evidence recipe {occurrence_count} at scale {scale}",
        "description": "A deterministic structural duplicate-evidence fixture.",
        "servings": "4.00",
        "ingredients": [
            {
                "ref": ref,
                "selection": {
                    "kind": "catalog",
                    "ingredient_id": str(CHICKPEA_ID),
                    "display_name": "Chickpea",
                },
                "measure": {
                    "kind": "exact",
                    "value": f"{BASE_AMOUNTS[index] * scale}.0000",
                    "unit_id": str(GRAM_ID),
                },
                "preparation_notes": None,
            }
            for index, ref in enumerate(refs)
        ],
        "instructions": [
            {
                "ref": "mix-step",
                "text": "Mix every measured chickpea occurrence in order.",
                "actions": [
                    {
                        "action_type_id": str(MIX_ID),
                        "ingredient_refs": refs,
                        "duration": {
                            "kind": "exact",
                            "value": "3.000000",
                            "unit_id": str(MINUTE_ID),
                        },
                        "temperature": None,
                    }
                ],
            }
        ],
    }


def _create_complete_draft(
    client: TestClient,
    *,
    occurrence_count: int,
    scale: int = 1,
) -> UUID:
    created = client.post("/api/recipe-drafts", json={"source_version_id": None})
    assert created.status_code == 201
    draft_id = UUID(cast(str, _json_object(created.json())["id"]))
    saved = client.put(
        f"/api/recipe-drafts/{draft_id}",
        json=_canonical_payload(occurrence_count=occurrence_count, scale=scale),
    )
    assert saved.status_code == 200
    assert _json_object(saved.json())["revision"] == 2
    return draft_id


def _preflight(client: TestClient, draft_id: UUID) -> dict[str, Any]:
    response = client.post(
        f"/api/recipe-drafts/{draft_id}/duplicate-preflights",
        headers={"Idempotency-Key": str(uuid4())},
        json={"revision": 2},
    )
    assert response.status_code == 201
    return _json_object(response.json())


def _publication_payload(
    preflight: dict[str, Any],
    *,
    decision: str | None,
) -> dict[str, object]:
    acknowledgement = _json_object(preflight["acknowledgement"])
    return {
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


def _publish_with_current_evidence(client: TestClient, draft_id: UUID) -> UUID:
    preflight = _preflight(client, draft_id)
    acknowledgement = _json_object(preflight["acknowledgement"])
    response = client.post(
        f"/api/recipe-drafts/{draft_id}/publish",
        headers={"Idempotency-Key": str(uuid4())},
        json=_publication_payload(
            preflight,
            decision="continue" if acknowledgement["required"] else None,
        ),
    )
    assert response.status_code == 201
    return UUID(cast(str, _json_object(response.json())["recipe_version_id"]))


def _source_draft_publication_count(engine: Engine, draft_id: UUID) -> int:
    with Session(bind=engine) as session:
        return (
            session.scalar(
                select(func.count())
                .select_from(RecipeVersionPublication)
                .where(RecipeVersionPublication.source_draft_id == draft_id)
            )
            or 0
        )


@pytest.mark.parametrize(
    ("occurrence_count", "scale", "expected_classification"),
    (
        (11, 1, "exact_duplicate"),
        (13, 2, "probable_duplicate"),
    ),
)
def test_duplicate_publication_requires_continue_and_persists_exact_evidence(
    duplicate_evidence_api: DuplicateEvidenceApi,
    occurrence_count: int,
    scale: int,
    expected_classification: str,
) -> None:
    base_draft_id = _create_complete_draft(
        duplicate_evidence_api.other_member,
        occurrence_count=occurrence_count,
    )
    base_version_id = _publish_with_current_evidence(
        duplicate_evidence_api.other_member,
        base_draft_id,
    )
    duplicate_draft_id = _create_complete_draft(
        duplicate_evidence_api.member,
        occurrence_count=occurrence_count,
        scale=scale,
    )
    preflight = _preflight(duplicate_evidence_api.member, duplicate_draft_id)
    acknowledgement = _json_object(preflight["acknowledgement"])
    candidates = cast(list[dict[str, Any]], preflight["candidates"])

    assert preflight["classification"] == expected_classification
    assert acknowledgement["required"] is True
    assert "continue" in cast(list[str], acknowledgement["allowed_decisions"])
    assert any(
        candidate["public_recipe_version_id"] == str(base_version_id)
        and candidate["classification"] == expected_classification
        for candidate in candidates
    )

    missing_decision = duplicate_evidence_api.member.post(
        f"/api/recipe-drafts/{duplicate_draft_id}/publish",
        headers={"Idempotency-Key": str(uuid4())},
        json=_publication_payload(preflight, decision=None),
    )
    assert missing_decision.status_code == 409
    assert _json_object(_json_object(missing_decision.json())["error"])["code"] == (
        "duplicate_decision_required"
    )
    assert (
        _source_draft_publication_count(
            duplicate_evidence_api.engine,
            duplicate_draft_id,
        )
        == 0
    )

    publication_action_id = uuid4()
    published = duplicate_evidence_api.member.post(
        f"/api/recipe-drafts/{duplicate_draft_id}/publish",
        headers={"Idempotency-Key": str(publication_action_id)},
        json=_publication_payload(preflight, decision="continue"),
    )
    assert published.status_code == 201
    published_version_id = UUID(cast(str, _json_object(published.json())["recipe_version_id"]))

    with Session(bind=duplicate_evidence_api.engine) as session:
        receipt = session.get(RecipeVersionPublication, published_version_id)
        assert receipt is not None
        assert receipt.source_draft_id == duplicate_draft_id
        assert receipt.duplicate_preflight_id == UUID(cast(str, acknowledgement["preflight_id"]))
        assert receipt.duplicate_policy_version == acknowledgement["policy_version"]
        assert receipt.duplicate_result_digest == acknowledgement["result_digest"]
        assert receipt.duplicate_decision_id is not None
        decision = session.get(RecipeDuplicateDecision, receipt.duplicate_decision_id)
        assert decision is not None
        assert decision.preflight_id == receipt.duplicate_preflight_id
        assert decision.actor_user_id == MEMBER_ID
        assert decision.action_id == publication_action_id
        assert decision.decision == "continue"
        assert decision.acknowledged_policy_version == receipt.duplicate_policy_version
        assert decision.acknowledged_result_digest == receipt.duplicate_result_digest


def test_publication_rejects_a_stale_candidate_set_without_writing_a_root(
    duplicate_evidence_api: DuplicateEvidenceApi,
) -> None:
    target_draft_id = _create_complete_draft(
        duplicate_evidence_api.member,
        occurrence_count=15,
    )
    target_preflight = _preflight(duplicate_evidence_api.member, target_draft_id)
    assert target_preflight["classification"] != "exact_duplicate"
    target_acknowledgement = _json_object(target_preflight["acknowledgement"])
    target_preflight_id = UUID(cast(str, target_acknowledgement["preflight_id"]))

    mismatched_result_payload = _publication_payload(
        target_preflight,
        decision="continue" if target_acknowledgement["required"] else None,
    )
    _json_object(mismatched_result_payload["duplicate_review"])["result_digest"] = "0" * 64
    mismatched_result = duplicate_evidence_api.member.post(
        f"/api/recipe-drafts/{target_draft_id}/publish",
        headers={"Idempotency-Key": str(uuid4())},
        json=mismatched_result_payload,
    )
    assert mismatched_result.status_code == 409
    assert _json_object(_json_object(mismatched_result.json())["error"])["code"] == (
        "duplicate_preflight_stale"
    )
    assert (
        _source_draft_publication_count(
            duplicate_evidence_api.engine,
            target_draft_id,
        )
        == 0
    )

    competing_draft_id = _create_complete_draft(
        duplicate_evidence_api.other_member,
        occurrence_count=15,
    )
    competing_preflight = _preflight(
        duplicate_evidence_api.other_member,
        competing_draft_id,
    )
    competing_acknowledgement = _json_object(competing_preflight["acknowledgement"])
    competing_publish = duplicate_evidence_api.other_member.post(
        f"/api/recipe-drafts/{competing_draft_id}/publish",
        headers={"Idempotency-Key": str(uuid4())},
        json=_publication_payload(
            competing_preflight,
            decision="continue" if competing_acknowledgement["required"] else None,
        ),
    )
    assert competing_publish.status_code == 201

    with Session(bind=duplicate_evidence_api.engine) as session:
        versions_before = session.scalar(select(func.count()).select_from(RecipeVersion)) or 0
        lineages_before = session.scalar(select(func.count()).select_from(RecipeLineage)) or 0
        publications_before = (
            session.scalar(select(func.count()).select_from(RecipeVersionPublication)) or 0
        )

    stale = duplicate_evidence_api.member.post(
        f"/api/recipe-drafts/{target_draft_id}/publish",
        headers={"Idempotency-Key": str(uuid4())},
        json=_publication_payload(
            target_preflight,
            decision="continue" if target_acknowledgement["required"] else None,
        ),
    )
    assert stale.status_code == 409
    assert _json_object(_json_object(stale.json())["error"])["code"] == (
        "duplicate_preflight_stale"
    )

    with Session(bind=duplicate_evidence_api.engine) as session:
        assert (
            _source_draft_publication_count(
                duplicate_evidence_api.engine,
                target_draft_id,
            )
            == 0
        )
        assert (session.scalar(select(func.count()).select_from(RecipeVersion)) or 0) == (
            versions_before
        )
        assert (session.scalar(select(func.count()).select_from(RecipeLineage)) or 0) == (
            lineages_before
        )
        assert (
            session.scalar(select(func.count()).select_from(RecipeVersionPublication)) or 0
        ) == publications_before
        assert (
            session.scalar(
                select(func.count())
                .select_from(RecipeDuplicateDecision)
                .where(RecipeDuplicateDecision.preflight_id == target_preflight_id)
            )
            or 0
        ) == 0


def test_publication_cannot_use_another_members_preflight(
    duplicate_evidence_api: DuplicateEvidenceApi,
) -> None:
    member_draft_id = _create_complete_draft(
        duplicate_evidence_api.member,
        occurrence_count=17,
    )
    member_preflight = _preflight(duplicate_evidence_api.member, member_draft_id)
    acknowledgement = _json_object(member_preflight["acknowledgement"])
    preflight_id = UUID(cast(str, acknowledgement["preflight_id"]))

    other_draft_id = _create_complete_draft(
        duplicate_evidence_api.other_member,
        occurrence_count=17,
    )
    rejected = duplicate_evidence_api.other_member.post(
        f"/api/recipe-drafts/{other_draft_id}/publish",
        headers={"Idempotency-Key": str(uuid4())},
        json=_publication_payload(
            member_preflight,
            decision="continue" if acknowledgement["required"] else None,
        ),
    )
    assert rejected.status_code == 404
    assert _json_object(_json_object(rejected.json())["error"])["code"] == (
        "duplicate_preflight_not_found"
    )
    assert (
        _source_draft_publication_count(
            duplicate_evidence_api.engine,
            other_draft_id,
        )
        == 0
    )
    with Session(bind=duplicate_evidence_api.engine) as session:
        preflight = session.get(RecipeDuplicatePreflight, preflight_id)
        assert preflight is not None and preflight.actor_user_id == MEMBER_ID
        assert (
            session.scalar(
                select(func.count())
                .select_from(RecipeDuplicateDecision)
                .where(RecipeDuplicateDecision.preflight_id == preflight_id)
            )
            or 0
        ) == 0
