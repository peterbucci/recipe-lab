from typing import cast
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import Table

from app.models import RecipeDraft
from app.schemas.recipe_drafts import RecipeDraftCreateRequest
from app.schemas.recipe_publications import RecipeDraftPublicationRequest
from app.services.recipe_drafts import recipe_draft_creation_request_fingerprint
from app.services.recipe_publications import recipe_draft_publication_request_fingerprint


def test_create_contract_requires_explicit_kind_source_shape() -> None:
    source_id = uuid4()
    original = RecipeDraftCreateRequest.model_validate(
        {"draft_kind": "original", "source_version_id": None}
    )
    adaptation = RecipeDraftCreateRequest.model_validate(
        {"draft_kind": "adaptation", "source_version_id": source_id}
    )
    revision = RecipeDraftCreateRequest.model_validate(
        {"draft_kind": "revision", "source_version_id": source_id}
    )
    assert original.draft_kind == "original"
    assert adaptation.draft_kind == "adaptation"
    assert revision.draft_kind == "revision"

    invalid_payloads = (
        {"source_version_id": None},
        {"draft_kind": "original", "source_version_id": source_id},
        {"draft_kind": "adaptation", "source_version_id": None},
        {"draft_kind": "revision", "source_version_id": None},
    )
    for payload in invalid_payloads:
        with pytest.raises(ValidationError):
            RecipeDraftCreateRequest.model_validate(payload)


def test_creation_fingerprint_binds_kind_and_exact_source() -> None:
    first_source = uuid4()
    second_source = uuid4()
    fingerprints = {
        recipe_draft_creation_request_fingerprint("original", None),
        recipe_draft_creation_request_fingerprint("adaptation", first_source),
        recipe_draft_creation_request_fingerprint("revision", first_source),
        recipe_draft_creation_request_fingerprint("revision", second_source),
    }
    assert len(fingerprints) == 4


def test_draft_model_declares_kind_and_database_shape_checks() -> None:
    table = cast(Table, RecipeDraft.__table__)
    assert table.c.draft_kind.nullable is False
    constraints = {constraint.name for constraint in table.constraints}
    assert "ck_recipe_drafts_draft_kind_supported" in constraints
    assert "ck_recipe_drafts_draft_kind_source_shape_valid" in constraints


def test_revision_publication_contract_separates_reason_from_topology_and_binds_intent() -> None:
    draft_id = uuid4()
    source_id = uuid4()
    preflight_id = uuid4()
    base = {
        "revision": 1,
        "community_rules_accepted": True,
        "content_rights_confirmed": True,
        "duplicate_review": {
            "preflight_id": preflight_id,
            "policy_version": "structural-v1",
            "result_digest": "a" * 64,
            "decision": None,
        },
    }
    update = RecipeDraftPublicationRequest.model_validate(
        {**base, "declared_change_reason": "update"}
    )
    correction = RecipeDraftPublicationRequest.model_validate(
        {
            **base,
            "declared_change_reason": "correction",
            "withdraw_predecessor": True,
        }
    )
    assert update.declared_change_reason == "update"
    assert update.withdraw_predecessor is False
    assert correction.declared_change_reason == "correction"
    assert correction.withdraw_predecessor is True
    with pytest.raises(ValidationError):
        RecipeDraftPublicationRequest.model_validate(
            {
                **base,
                "declared_change_reason": "update",
                "withdraw_predecessor": True,
            }
        )

    update_fingerprint = recipe_draft_publication_request_fingerprint(
        draft_id,
        update,
        draft_kind="revision",
        source_version_id=source_id,
    )
    correction_fingerprint = recipe_draft_publication_request_fingerprint(
        draft_id,
        correction,
        draft_kind="revision",
        source_version_id=source_id,
    )
    assert update_fingerprint != correction_fingerprint
