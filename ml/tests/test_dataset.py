import json
from copy import deepcopy
from typing import Any, cast
from uuid import UUID

import pytest
from conftest import FIXTURE_PATH

from recipe_lab_evaluation.dataset import (
    LEGACY_SNAPSHOT_SCHEMA_VERSION,
    SNAPSHOT_SCHEMA_VERSION,
    EvaluationSnapshot,
    SnapshotValidationError,
    create_snapshot,
    parse_snapshot_json,
    snapshot_to_json,
)

EXPECTED_DATASET_ID = "recipe-lab-synthetic-offline-v2"
EXPECTED_SNAPSHOT_SHA256 = "2d99f0dd69545b31e2eca2ea96f57c89b0b2f9a33d4a994a391319eae7cdb1d0"
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


def _legacy_document() -> dict[str, Any]:
    document = _fixture_document()
    document["schema_version"] = LEGACY_SNAPSHOT_SCHEMA_VERSION
    recipes = cast(list[dict[str, Any]], document["recipes"])
    for recipe in recipes:
        measures = cast(list[dict[str, Any]], recipe.pop("ingredient_measures"))
        recipe["ingredient_ids"] = list(
            dict.fromkeys(measure["ingredient_id"] for measure in measures)
        )
    return document


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
    kinds = {
        measure.kind
        for recipe in synthetic_snapshot.recipes
        for measure in recipe.ingredient_measures
    }
    assert kinds == {"exact", "range", "qualitative"}
    assert any(
        measure.package_size_id is not None
        for recipe in synthetic_snapshot.recipes
        for measure in recipe.ingredient_measures
    )

    identifiers = (
        {recipe.id for recipe in synthetic_snapshot.recipes}
        | {event.id for event in synthetic_snapshot.events}
        | {event.user_id for event in synthetic_snapshot.events}
        | {
            measure.ingredient_id
            for recipe in synthetic_snapshot.recipes
            for measure in recipe.ingredient_measures
        }
        | {
            identifier
            for recipe in synthetic_snapshot.recipes
            for measure in recipe.ingredient_measures
            for identifier in (measure.measurement_unit_id, measure.package_size_id)
            if identifier is not None
        }
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
        '{"schema_version":"recipe-lab-evaluation-snapshot-v2",'
        '"schema_version":"recipe-lab-evaluation-snapshot-v2"}'
    )

    with pytest.raises(SnapshotValidationError, match="duplicate JSON key"):
        parse_snapshot_json(duplicate_key_document)


def test_snapshot_fingerprint_is_independent_of_equivalent_input_order() -> None:
    original_document = _fixture_document()
    reordered_document = deepcopy(original_document)
    cast(list[object], reordered_document["recipes"]).reverse()
    cast(list[object], reordered_document["events"]).reverse()

    original = _parse_document(original_document)
    reordered = _parse_document(reordered_document)

    assert reordered.recipes == original.recipes
    assert reordered.events == original.events
    assert reordered.sha256 == original.sha256


def test_measure_only_change_alters_the_snapshot_fingerprint() -> None:
    original_document = _fixture_document()
    changed_document = deepcopy(original_document)
    first_recipe = cast(list[dict[str, Any]], changed_document["recipes"])[0]
    changed_recipe_id = UUID(cast(str, first_recipe["id"]))
    first_measure = cast(list[dict[str, Any]], first_recipe["ingredient_measures"])[0]
    first_measure["quantity_min"] = "1.75"

    original = _parse_document(original_document)
    changed = _parse_document(changed_document)

    original_recipe = next(recipe for recipe in original.recipes if recipe.id == changed_recipe_id)
    changed_recipe = next(recipe for recipe in changed.recipes if recipe.id == changed_recipe_id)
    assert changed_recipe.ingredient_ids == original_recipe.ingredient_ids
    assert changed.sha256 != original.sha256


def test_v2_preserves_repeated_ingredient_occurrences_without_changing_the_id_view() -> None:
    original_document = _fixture_document()
    repeated_document = deepcopy(original_document)
    first_recipe = cast(list[dict[str, Any]], repeated_document["recipes"])[0]
    repeated_recipe_id = UUID(cast(str, first_recipe["id"]))
    measures = cast(list[dict[str, Any]], first_recipe["ingredient_measures"])
    measures.append(deepcopy(measures[0]))

    original = _parse_document(original_document)
    repeated = _parse_document(repeated_document)

    original_recipe = next(recipe for recipe in original.recipes if recipe.id == repeated_recipe_id)
    repeated_recipe = next(recipe for recipe in repeated.recipes if recipe.id == repeated_recipe_id)
    assert len(repeated_recipe.ingredient_measures) == (
        len(original_recipe.ingredient_measures) + 1
    )
    assert repeated_recipe.ingredient_ids == original_recipe.ingredient_ids
    assert repeated.sha256 != original.sha256


def test_v1_parsing_keeps_legacy_ids_separate_from_structured_measures() -> None:
    legacy = _parse_document(_legacy_document())

    assert legacy.schema_version == LEGACY_SNAPSHOT_SCHEMA_VERSION
    assert legacy.recipes[0].ingredient_measures == ()
    assert legacy.recipes[0].legacy_ingredient_ids
    assert legacy.recipes[0].ingredient_ids == legacy.recipes[0].legacy_ingredient_ids
    assert parse_snapshot_json(snapshot_to_json(legacy)) == legacy

    with pytest.raises(SnapshotValidationError, match="recapture"):
        create_snapshot(
            dataset_id="legacy-upgrade-refused",
            cutoff=legacy.cutoff,
            limitations=legacy.limitations,
            recipes=legacy.recipes,
            events=legacy.events,
        )


@pytest.mark.parametrize(
    "mutation",
    [
        lambda measure: measure.update({"quantity_max": "2"}),
        lambda measure: measure.update(
            {
                "kind": "qualitative",
                "quantity_min": None,
                "measurement_unit_id": None,
                "qualitative_value": "to_taste",
            }
        ),
    ],
)
def test_snapshot_rejects_measure_fields_that_do_not_match_their_kind(mutation: Any) -> None:
    document = _fixture_document()
    recipe = cast(list[dict[str, Any]], document["recipes"])[0]
    measure = cast(list[dict[str, Any]], recipe["ingredient_measures"])[0]
    mutation(measure)

    with pytest.raises(SnapshotValidationError, match="do not match its kind"):
        _parse_document(document)
