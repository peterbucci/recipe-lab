import json
from copy import deepcopy
from typing import Any, cast
from uuid import UUID

import pytest
from conftest import FIXTURE_PATH

from recipe_lab_evaluation.dataset import (
    LEGACY_SNAPSHOT_SCHEMA_VERSION,
    SNAPSHOT_SCHEMA_VERSION,
    STRUCTURED_MEASURE_SNAPSHOT_SCHEMA_VERSION,
    EvaluationSnapshot,
    SnapshotValidationError,
    create_snapshot,
    parse_snapshot_json,
    snapshot_to_json,
)
from recipe_lab_evaluation.split import split_snapshot

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


def _v3_document() -> dict[str, Any]:
    document = _fixture_document()
    document["schema_version"] = SNAPSHOT_SCHEMA_VERSION
    cutoff = cast(str, document["cutoff"])
    recipes = cast(list[dict[str, Any]], document["recipes"])
    recipes[:] = [recipe for recipe in recipes if cast(str, recipe["created_at"]) <= cutoff]
    eligible_ids = {cast(str, recipe["id"]) for recipe in recipes}
    events = cast(list[dict[str, Any]], document["events"])
    events[:] = [
        event
        for event in events
        if cast(str, event["occurred_at"]) <= cutoff
        and cast(str, event["recipe_version_id"]) in eligible_ids
        and (
            event["related_recipe_version_id"] is None
            or cast(str, event["related_recipe_version_id"]) in eligible_ids
        )
    ]
    adaptation_sources = {
        cast(str, event["related_recipe_version_id"]): cast(str, event["recipe_version_id"])
        for event in events
        if event["event_type"] == "fork"
    }
    for recipe in recipes:
        exact_id = cast(str, recipe["id"])
        base_id = adaptation_sources.get(exact_id)
        recipe.update(
            {
                "recipe_id": exact_id,
                "published_at": recipe["created_at"],
                "edition_number": 1,
                "base_recipe_version_id": base_id,
                "relation_kind": "adaptation" if base_id is not None else "original",
                "declared_change_reason": None,
                "structural_fingerprints": [
                    {
                        "algorithm_version": "structure-v1",
                        "digest": exact_id.replace("-", "") * 2,
                    }
                ],
            }
        )
    return document


def test_synthetic_snapshot_is_versioned_complete_and_uses_opaque_ids(
    synthetic_snapshot: EvaluationSnapshot,
) -> None:
    assert synthetic_snapshot.schema_version == STRUCTURED_MEASURE_SNAPSHOT_SCHEMA_VERSION
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


def test_empty_in_memory_snapshot_keeps_the_v2_contract() -> None:
    reference = _parse_document(_fixture_document())

    snapshot = create_snapshot(
        dataset_id="empty-structured-snapshot",
        cutoff=reference.cutoff,
        limitations=("No observations are available.",),
        recipes=(),
        events=(),
    )

    assert snapshot.schema_version == STRUCTURED_MEASURE_SNAPSHOT_SCHEMA_VERSION


def test_explicit_empty_database_snapshot_keeps_the_v3_contract() -> None:
    reference = _parse_document(_fixture_document())

    snapshot = create_snapshot(
        dataset_id="empty-governed-database-snapshot",
        cutoff=reference.cutoff,
        limitations=("No eligible observations are available.",),
        recipes=(),
        events=(),
        schema_version=SNAPSHOT_SCHEMA_VERSION,
    )

    assert snapshot.schema_version == SNAPSHOT_SCHEMA_VERSION
    assert parse_snapshot_json(snapshot_to_json(snapshot)) == snapshot


def test_v3_preserves_governed_identity_topology_fingerprints_and_cutoff() -> None:
    snapshot = _parse_document(_v3_document())

    assert snapshot.schema_version == SNAPSHOT_SCHEMA_VERSION
    assert all(recipe.recipe_id is not None for recipe in snapshot.recipes)
    assert all(recipe.edition_number == 1 for recipe in snapshot.recipes)
    assert all(
        recipe.published_at is not None and recipe.published_at <= snapshot.cutoff
        for recipe in snapshot.recipes
    )
    assert all(event.occurred_at <= snapshot.cutoff for event in snapshot.events)
    assert all(len(recipe.structural_fingerprints) == 1 for recipe in snapshot.recipes)
    adaptation = next(recipe for recipe in snapshot.recipes if recipe.relation_kind == "adaptation")
    fork = next(event for event in snapshot.events if event.event_type == "fork")
    assert adaptation.id == fork.related_recipe_version_id
    assert adaptation.base_recipe_version_id == fork.recipe_version_id
    assert adaptation.declared_change_reason is None
    assert parse_snapshot_json(snapshot_to_json(snapshot)) == snapshot


def test_v3_digest_is_independent_of_record_and_fingerprint_order() -> None:
    original_document = _v3_document()
    first_recipe = cast(list[dict[str, Any]], original_document["recipes"])[0]
    fingerprints = cast(list[dict[str, Any]], first_recipe["structural_fingerprints"])
    fingerprints.append(
        {
            "algorithm_version": "recipe-structure-v2",
            "digest": "f" * 64,
        }
    )
    reordered_document = deepcopy(original_document)
    cast(list[object], reordered_document["recipes"]).reverse()
    cast(list[object], reordered_document["events"]).reverse()
    reordered_recipe = next(
        recipe
        for recipe in cast(list[dict[str, Any]], reordered_document["recipes"])
        if recipe["id"] == first_recipe["id"]
    )
    cast(list[object], reordered_recipe["structural_fingerprints"]).reverse()

    original = _parse_document(original_document)
    reordered = _parse_document(reordered_document)

    assert reordered.recipes == original.recipes
    assert reordered.events == original.events
    assert reordered.sha256 == original.sha256


def test_v3_revision_metadata_is_not_inferred_from_a_fork_signal() -> None:
    document = _v3_document()
    events = cast(list[dict[str, Any]], document["events"])
    fork = next(event for event in events if event["event_type"] == "fork")
    recipes = cast(list[dict[str, Any]], document["recipes"])
    child = next(recipe for recipe in recipes if recipe["id"] == fork["related_recipe_version_id"])
    child.update(
        {
            "recipe_id": fork["recipe_version_id"],
            "edition_number": 2,
            "base_recipe_version_id": fork["recipe_version_id"],
            "relation_kind": "revision",
            "declared_change_reason": "correction",
        }
    )

    with pytest.raises(SnapshotValidationError, match="fork child is not an adaptation"):
        _parse_document(document)


def test_v3_revision_accepts_a_null_weak_declared_reason() -> None:
    document = _v3_document()
    events = cast(list[dict[str, Any]], document["events"])
    fork = next(event for event in events if event["event_type"] == "fork")
    source_id = cast(str, fork["recipe_version_id"])
    child_id = cast(str, fork["related_recipe_version_id"])
    recipes = cast(list[dict[str, Any]], document["recipes"])
    source = next(recipe for recipe in recipes if recipe["id"] == source_id)
    child = next(recipe for recipe in recipes if recipe["id"] == child_id)
    child.update(
        {
            "recipe_id": source["recipe_id"],
            "edition_number": 2,
            "base_recipe_version_id": source_id,
            "relation_kind": "revision",
            "declared_change_reason": None,
        }
    )
    document["events"] = [
        event
        for event in events
        if event["id"] != fork["id"] and event["related_recipe_version_id"] != child_id
    ]

    snapshot = _parse_document(document)
    revision = next(recipe for recipe in snapshot.recipes if recipe.id == UUID(child_id))

    assert revision.relation_kind == "revision"
    assert revision.declared_change_reason is None


def test_v3_keeps_post_cutoff_recipes_as_context_but_excludes_them_from_training() -> None:
    document = _v3_document()
    template = cast(list[dict[str, Any]], document["recipes"])[0]
    future = deepcopy(template)
    future.update(
        {
            "id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            "recipe_id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            "created_at": "2026-06-02T00:00:00Z",
            "published_at": "2026-06-02T01:00:00Z",
            "title": "Future holdout context",
            "version_number": 99,
            "base_recipe_version_id": None,
            "relation_kind": "original",
            "structural_fingerprints": [
                {
                    "algorithm_version": "structure-v1",
                    "digest": "e" * 64,
                }
            ],
        }
    )
    cast(list[dict[str, Any]], document["recipes"]).append(future)

    snapshot = _parse_document(document)
    exact_id = UUID(cast(str, future["id"]))

    assert exact_id in {recipe.id for recipe in snapshot.recipes}
    assert exact_id not in {recipe.id for recipe in split_snapshot(snapshot).recipes}


def test_v3_keeps_post_cutoff_events_as_deterministic_holdout_without_private_fields() -> None:
    document = _v3_document()
    events = cast(list[dict[str, Any]], document["events"])
    post_cutoff_event = deepcopy(events[0])
    post_cutoff_event.update(
        {
            "id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
            "occurred_at": "2026-06-02T00:00:00Z",
        }
    )
    events.append(post_cutoff_event)

    without_holdout = _parse_document(_v3_document())
    snapshot = _parse_document(document)
    split = split_snapshot(snapshot)
    encoded = snapshot_to_json(snapshot)
    reparsed = parse_snapshot_json(encoded)

    assert UUID(cast(str, post_cutoff_event["id"])) in {event.id for event in split.holdout_events}
    assert snapshot.sha256 != without_holdout.sha256
    assert reparsed.sha256 == snapshot.sha256
    for forbidden_field in FORBIDDEN_PRIVACY_FIELDS:
        assert f'"{forbidden_field}"' not in encoded


def test_v3_publication_at_the_cutoff_is_not_available_to_training() -> None:
    document = _v3_document()
    recipe = cast(list[dict[str, Any]], document["recipes"])[0]
    exact_id = UUID(cast(str, recipe["id"]))
    recipe["published_at"] = cast(str, document["cutoff"])
    document["events"] = [
        event
        for event in cast(list[dict[str, Any]], document["events"])
        if event["recipe_version_id"] != str(exact_id)
        and event["related_recipe_version_id"] != str(exact_id)
    ]

    split = split_snapshot(_parse_document(document))

    assert exact_id not in {available.id for available in split.recipes}


@pytest.mark.parametrize("reference", ["source", "child"])
def test_v3_rejects_events_before_referenced_publication(reference: str) -> None:
    document = _v3_document()
    events = cast(list[dict[str, Any]], document["events"])
    event = (
        events[0]
        if reference == "source"
        else next(candidate for candidate in events if candidate["event_type"] == "fork")
    )
    referenced_id = (
        event["recipe_version_id"] if reference == "source" else event["related_recipe_version_id"]
    )
    recipe = next(
        candidate
        for candidate in cast(list[dict[str, Any]], document["recipes"])
        if candidate["id"] == referenced_id
    )
    recipe["published_at"] = (
        "2026-05-02T00:00:00Z" if reference == "source" else "2026-04-05T00:00:00Z"
    )

    with pytest.raises(SnapshotValidationError, match=f"before its {reference} recipe|fork child"):
        _parse_document(document)


def test_v3_rejects_fingerprint_payload_or_unknown_governance_fields() -> None:
    document = _v3_document()
    recipe = cast(list[dict[str, Any]], document["recipes"])[0]
    fingerprint = cast(list[dict[str, Any]], recipe["structural_fingerprints"])[0]
    fingerprint["canonical_payload"] = "must not leave the database"

    with pytest.raises(SnapshotValidationError, match="unexpected"):
        _parse_document(document)


def test_v3_requires_versioned_structural_fingerprint_metadata() -> None:
    document = _v3_document()
    recipe = cast(list[dict[str, Any]], document["recipes"])[0]
    recipe["structural_fingerprints"] = []

    with pytest.raises(SnapshotValidationError, match="fingerprint metadata"):
        _parse_document(document)


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
