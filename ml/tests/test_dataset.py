import json
from copy import deepcopy
from typing import Any, cast
from uuid import UUID

import pytest
from conftest import FIXTURE_PATH

from recipe_lab_evaluation.dataset import (
    SNAPSHOT_SCHEMA_VERSION,
    EvaluationSnapshot,
    SnapshotValidationError,
    parse_snapshot_json,
)

EXPECTED_DATASET_ID = "recipe-lab-synthetic-offline-v1"
EXPECTED_SNAPSHOT_SHA256 = "d94d3f6fc4b2ce76badc6527f617795b1a3c10b9754212d04859abe0f0a58e11"
EXPECTED_RECIPE_COUNT = 8
EXPECTED_EVENT_COUNT = 36
FUTURE_RECIPE_ID = UUID("0f158620-0cd5-44d9-9aaa-2bf9f93f1efd")
FORBIDDEN_PRIVACY_FIELDS = (
    "email",
    "display_name",
    "ip_address",
    "user_agent",
    "referrer",
    "search_query",
    "request_fingerprint",
    "action_id",
)


def _fixture_document() -> dict[str, Any]:
    return cast(dict[str, Any], json.loads(FIXTURE_PATH.read_text(encoding="utf-8")))


def _parse_document(document: dict[str, Any]) -> EvaluationSnapshot:
    return parse_snapshot_json(json.dumps(document))


def test_synthetic_snapshot_is_versioned_complete_and_uses_opaque_ids(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    assert synthetic_snapshot.schema_version == SNAPSHOT_SCHEMA_VERSION
    assert synthetic_snapshot.dataset_id == EXPECTED_DATASET_ID
    assert synthetic_snapshot.sha256 == EXPECTED_SNAPSHOT_SHA256
    assert synthetic_snapshot.cutoff.isoformat() == "2026-06-01T00:00:00+00:00"
    assert len(synthetic_snapshot.recipes) == EXPECTED_RECIPE_COUNT
    assert len(synthetic_snapshot.events) == EXPECTED_EVENT_COUNT
    assert synthetic_snapshot.limitations
    assert all(limitation.strip() for limitation in synthetic_snapshot.limitations)
    assert {event.event_type for event in synthetic_snapshot.events} == {
        "view",
        "save",
        "rating",
        "fork",
    }
    assert any(
        event.occurred_at == synthetic_snapshot.cutoff for event in synthetic_snapshot.events
    )
    assert any(recipe.id == FUTURE_RECIPE_ID for recipe in synthetic_snapshot.recipes)

    identifiers = (
        {recipe.id for recipe in synthetic_snapshot.recipes}
        | {event.id for event in synthetic_snapshot.events}
        | {event.user_id for event in synthetic_snapshot.events}
    )
    assert identifiers
    assert all(identifier.version == 4 for identifier in identifiers)


def test_synthetic_snapshot_contains_no_personal_or_request_metadata() -> None:
    raw = FIXTURE_PATH.read_text(encoding="utf-8").casefold()

    for forbidden_field in FORBIDDEN_PRIVACY_FIELDS:
        assert f'"{forbidden_field}"' not in raw
    assert "@" not in raw
    assert "demo cook" not in raw


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (lambda document: document.update({"email": "not-allowed@test.invalid"}), "unexpected"),
        (lambda document: document.update({"limitations": []}), "limitations"),
        (lambda document: document.update({"cutoff": "2026-06-01T00:00:00"}), "UTC"),
    ],
)
def test_snapshot_rejects_unknown_private_fields_and_missing_protocol_metadata(
    mutation: Any,
    message: str,
) -> None:
    document = _fixture_document()
    mutation(document)

    with pytest.raises(SnapshotValidationError, match=message):
        _parse_document(document)


def test_snapshot_rejects_context_that_does_not_match_the_event_type() -> None:
    document = _fixture_document()
    events = cast(list[dict[str, Any]], document["events"])
    view_event = next(event for event in events if event["event_type"] == "view")
    view_event["rating_value"] = 5

    with pytest.raises(SnapshotValidationError, match="context does not match"):
        _parse_document(document)


def test_snapshot_rejects_unknown_recipe_references() -> None:
    document = _fixture_document()
    events = cast(list[dict[str, Any]], document["events"])
    events[0]["recipe_version_id"] = "ffffffff-ffff-4fff-8fff-ffffffffffff"

    with pytest.raises(SnapshotValidationError, match="unknown recipe"):
        _parse_document(document)


def test_snapshot_rejects_an_event_that_predates_its_source_recipe() -> None:
    document = _fixture_document()
    events = cast(list[dict[str, Any]], document["events"])
    recipes = cast(list[dict[str, Any]], document["recipes"])
    source_id = events[0]["recipe_version_id"]
    source = next(recipe for recipe in recipes if recipe["id"] == source_id)
    source["created_at"] = "2026-06-02T00:00:00Z"

    with pytest.raises(SnapshotValidationError, match="before its source recipe"):
        _parse_document(document)


def test_snapshot_rejects_a_fork_event_that_predates_its_child() -> None:
    document = _fixture_document()
    events = cast(list[dict[str, Any]], document["events"])
    recipes = cast(list[dict[str, Any]], document["recipes"])
    fork = next(event for event in events if event["event_type"] == "fork")
    child = next(recipe for recipe in recipes if recipe["id"] == fork["related_recipe_version_id"])
    child["created_at"] = "2026-06-02T00:00:00Z"
    document["events"] = [fork]

    with pytest.raises(SnapshotValidationError, match="before its fork child"):
        _parse_document(document)


def test_snapshot_rejects_duplicate_json_keys_before_schema_validation() -> None:
    duplicate_key_document = (
        '{"schema_version":"recipe-lab-evaluation-snapshot-v1",'
        '"schema_version":"recipe-lab-evaluation-snapshot-v1"}'
    )

    with pytest.raises(SnapshotValidationError, match="duplicate JSON key"):
        parse_snapshot_json(duplicate_key_document)


def test_snapshot_fingerprint_is_independent_of_equivalent_input_order() -> None:
    original_document = _fixture_document()
    reordered_document = deepcopy(original_document)
    cast(list[object], reordered_document["recipes"]).reverse()
    cast(list[object], reordered_document["events"]).reverse()
    for recipe in cast(list[dict[str, Any]], reordered_document["recipes"]):
        cast(list[object], recipe["ingredient_ids"]).reverse()

    original = _parse_document(original_document)
    reordered = _parse_document(reordered_document)

    assert reordered.recipes == original.recipes
    assert reordered.events == original.events
    assert reordered.sha256 == original.sha256


def test_snapshot_allows_a_recipe_with_no_linked_catalog_ingredients() -> None:
    document = _fixture_document()
    recipes = cast(list[dict[str, Any]], document["recipes"])
    recipe_id = recipes[0]["id"]
    recipes[0]["ingredient_ids"] = []

    snapshot = _parse_document(document)

    recipe = next(item for item in snapshot.recipes if str(item.id) == recipe_id)
    assert recipe.ingredient_ids == ()


def test_snapshot_rejects_null_as_an_ingredient_identity_sentinel() -> None:
    document = _fixture_document()
    recipes = cast(list[dict[str, Any]], document["recipes"])
    recipes[0]["ingredient_ids"] = [None]

    with pytest.raises(SnapshotValidationError, match="non-blank string"):
        _parse_document(document)
