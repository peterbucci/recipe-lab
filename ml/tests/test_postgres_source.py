import os
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
from app.models import (
    ACCOUNT_KIND_MEMBER,
    USER_STATUS_ACTIVE,
    Ingredient,
    IngredientPackageSize,
    PreferenceEvent,
    Recipe,
    RecipeEdition,
    RecipeIngredient,
    RecipeLineage,
    RecipeStructuralFingerprint,
    RecipeVersion,
    RecipeVersionPublication,
    User,
)
from app.seeds.identifiers import measurement_uuid
from app.services.account_lifecycle import tombstone_member_from_durable_deletion_evidence
from sqlalchemy import create_engine
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session

from recipe_lab_evaluation.dataset import SNAPSHOT_SCHEMA_VERSION, create_snapshot
from recipe_lab_evaluation.sources.postgres import (
    SnapshotExportError,
    _extract_from_connection,
    _ingredient_measure,
    _recipe_relation,
)
from recipe_lab_evaluation.split import split_snapshot

INGREDIENT_ID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
UNIT_ID = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
PACKAGE_SIZE_ID = UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc")


def test_export_rejects_sandbox_provenance_before_reading_recipes_or_events() -> None:
    connection = MagicMock(spec=Connection)
    connection.execute.return_value.scalar.side_effect = ["sandbox_generations", True]
    with pytest.raises(SnapshotExportError, match="sandbox data"):
        _extract_from_connection(connection, cutoff=datetime.now(UTC))
    statements = [str(call.args[0]) for call in connection.execute.call_args_list]
    assert len(statements) == 2
    assert all("sandbox_generations" in statement for statement in statements)


def test_postgres_exact_and_range_modes_keep_all_structured_fields() -> None:
    exact = _ingredient_measure(
        ingredient_id=INGREDIENT_ID,
        measure_mode="exact",
        quantity_min=Decimal("1.2500"),
        quantity_max=None,
        measurement_unit_id=UNIT_ID,
        package_size_id=PACKAGE_SIZE_ID,
    )
    ranged = _ingredient_measure(
        ingredient_id=INGREDIENT_ID,
        measure_mode="range",
        quantity_min=Decimal("2.0000"),
        quantity_max=Decimal("3.5000"),
        measurement_unit_id=UNIT_ID,
        package_size_id=None,
    )

    assert exact.kind == "exact"
    assert exact.quantity_min == Decimal("1.2500")
    assert exact.quantity_max is None
    assert exact.measurement_unit_id == UNIT_ID
    assert exact.package_size_id == PACKAGE_SIZE_ID
    assert exact.qualitative_value is None
    assert ranged.kind == "range"
    assert ranged.quantity_min == Decimal("2.0000")
    assert ranged.quantity_max == Decimal("3.5000")
    assert ranged.measurement_unit_id == UNIT_ID


@pytest.mark.parametrize("measure_mode", ["to_taste", "as_needed", "unspecified"])
def test_postgres_qualitative_modes_are_explicit_without_invented_amounts(
    measure_mode: str,
) -> None:
    measure = _ingredient_measure(
        ingredient_id=INGREDIENT_ID,
        measure_mode=measure_mode,
        quantity_min=None,
        quantity_max=None,
        measurement_unit_id=None,
        package_size_id=None,
    )

    assert measure.kind == "qualitative"
    assert measure.quantity_min is None
    assert measure.quantity_max is None
    assert measure.measurement_unit_id is None
    assert measure.package_size_id is None
    assert measure.qualitative_value == measure_mode


def test_postgres_rejects_an_unknown_measure_mode() -> None:
    with pytest.raises(SnapshotExportError, match="unsupported ingredient measure mode"):
        _ingredient_measure(
            ingredient_id=INGREDIENT_ID,
            measure_mode="free_text",
            quantity_min=None,
            quantity_max=None,
            measurement_unit_id=None,
            package_size_id=None,
        )


def test_relation_semantics_are_derived_from_edition_topology() -> None:
    original_id = uuid4()
    source_id = uuid4()
    adaptation_id = uuid4()
    revision_id = uuid4()

    assert _recipe_relation(
        recipe_version_id=original_id,
        edition_number=1,
        parent_version_id=None,
        previous_recipe_version_id=None,
        declared_change_reason=None,
    ) == ("original", None, None)
    assert _recipe_relation(
        recipe_version_id=adaptation_id,
        edition_number=1,
        parent_version_id=source_id,
        previous_recipe_version_id=None,
        declared_change_reason=None,
    ) == ("adaptation", source_id, None)
    assert _recipe_relation(
        recipe_version_id=revision_id,
        edition_number=2,
        parent_version_id=None,
        previous_recipe_version_id=original_id,
        declared_change_reason="correction",
    ) == ("revision", original_id, "correction")
    assert _recipe_relation(
        recipe_version_id=uuid4(),
        edition_number=3,
        parent_version_id=None,
        previous_recipe_version_id=revision_id,
        declared_change_reason=None,
    ) == ("revision", revision_id, None)


@pytest.mark.parametrize(
    ("edition_number", "parent_version_id", "previous_version_id", "reason"),
    [
        (2, uuid4(), uuid4(), "update"),
        (1, None, None, "correction"),
        (2, None, uuid4(), "unsupported"),
    ],
)
def test_relation_semantics_fail_closed_for_ambiguous_or_unsupported_revisions(
    edition_number: int,
    parent_version_id: UUID | None,
    previous_version_id: UUID | None,
    reason: str | None,
) -> None:
    with pytest.raises(SnapshotExportError):
        _recipe_relation(
            recipe_version_id=uuid4(),
            edition_number=edition_number,
            parent_version_id=parent_version_id,
            previous_recipe_version_id=previous_version_id,
            declared_change_reason=reason,
        )


def test_export_reads_occurrence_preserving_structured_measures_from_migrated_postgres() -> None:
    database_url = os.environ.get("TEST_DATABASE_URL")
    if database_url is None:
        pytest.skip("TEST_DATABASE_URL is required for the PostgreSQL export integration test")

    user_id = uuid4()
    deleted_user_id = uuid4()
    lineage_id = uuid4()
    stable_recipe_id = uuid4()
    adaptation_recipe_id = uuid4()
    withdrawn_recipe_id = uuid4()
    restored_after_cutoff_recipe_id = uuid4()
    future_adaptation_recipe_id = uuid4()
    recipe_id = uuid4()
    revision_id = uuid4()
    adaptation_id = uuid4()
    withdrawn_id = uuid4()
    restored_after_cutoff_id = uuid4()
    future_revision_id = uuid4()
    future_adaptation_id = uuid4()
    ingredient_id = uuid4()
    package_size_id = uuid4()
    included_view_id = uuid4()
    deleted_view_id = uuid4()
    post_cutoff_view_id = uuid4()
    included_fork_id = uuid4()
    post_cutoff_fork_id = uuid4()
    gram_id = measurement_uuid("unit", "g")
    package_unit_id = measurement_uuid("unit", "package")
    unique_token = recipe_id.hex
    cutoff = datetime(2026, 6, 1, tzinfo=UTC)
    created_at = cutoff - timedelta(days=10)
    engine = create_engine(database_url, pool_pre_ping=True)

    with engine.connect() as connection:
        transaction = connection.begin()
        session = Session(bind=connection)
        try:
            session.add(
                User(
                    id=user_id,
                    email=f"snapshot-export-{unique_token}@example.invalid",
                    display_name="Snapshot Export Test",
                    handle=None,
                    account_kind=ACCOUNT_KIND_MEMBER,
                    status=USER_STATUS_ACTIVE,
                )
            )
            session.add(
                User(
                    id=deleted_user_id,
                    email=f"deleting-export-{unique_token}@example.invalid",
                    display_name="Deleting Export Test",
                    handle=None,
                    account_kind=ACCOUNT_KIND_MEMBER,
                    status=USER_STATUS_ACTIVE,
                    created_at=created_at,
                )
            )
            session.flush()
            session.add(
                Ingredient(
                    id=ingredient_id,
                    canonical_name=f"Snapshot export ingredient {unique_token}",
                    category_id=None,
                )
            )
            session.add(
                RecipeLineage(
                    id=lineage_id,
                    created_by_user_id=user_id,
                )
            )
            session.flush()
            session.add(
                RecipeVersion(
                    id=recipe_id,
                    lineage_id=lineage_id,
                    parent_version_id=None,
                    created_by_user_id=user_id,
                    version_number=1,
                    title=f"Snapshot export recipe {unique_token}",
                    description=None,
                    servings=Decimal("2"),
                    created_at=created_at,
                )
            )
            session.add_all(
                [
                    RecipeVersion(
                        id=revision_id,
                        lineage_id=lineage_id,
                        parent_version_id=None,
                        created_by_user_id=user_id,
                        version_number=2,
                        title=f"Snapshot export corrected recipe {unique_token}",
                        description=None,
                        servings=Decimal("2"),
                        created_at=cutoff - timedelta(days=8),
                    ),
                    RecipeVersion(
                        id=adaptation_id,
                        lineage_id=lineage_id,
                        parent_version_id=revision_id,
                        created_by_user_id=user_id,
                        version_number=3,
                        title=f"Snapshot export adaptation {unique_token}",
                        description=None,
                        servings=Decimal("2"),
                        created_at=cutoff - timedelta(days=6),
                    ),
                    RecipeVersion(
                        id=withdrawn_id,
                        lineage_id=lineage_id,
                        parent_version_id=revision_id,
                        created_by_user_id=user_id,
                        version_number=4,
                        title=f"Snapshot export withdrawn adaptation {unique_token}",
                        description=None,
                        servings=Decimal("2"),
                        created_at=cutoff - timedelta(days=4),
                    ),
                    RecipeVersion(
                        id=restored_after_cutoff_id,
                        lineage_id=lineage_id,
                        parent_version_id=revision_id,
                        created_by_user_id=user_id,
                        version_number=6,
                        title=f"Snapshot export restored adaptation {unique_token}",
                        description=None,
                        servings=Decimal("2"),
                        created_at=cutoff - timedelta(days=4),
                    ),
                    RecipeVersion(
                        id=future_revision_id,
                        lineage_id=lineage_id,
                        parent_version_id=None,
                        created_by_user_id=user_id,
                        version_number=5,
                        title=f"Snapshot export future update {unique_token}",
                        description=None,
                        servings=Decimal("2"),
                        created_at=cutoff + timedelta(days=1),
                    ),
                    RecipeVersion(
                        id=future_adaptation_id,
                        lineage_id=lineage_id,
                        parent_version_id=revision_id,
                        created_by_user_id=user_id,
                        version_number=7,
                        title=f"Snapshot export future adaptation {unique_token}",
                        description=None,
                        servings=Decimal("2"),
                        created_at=cutoff + timedelta(days=1),
                    ),
                ]
            )
            session.add(
                IngredientPackageSize(
                    id=package_size_id,
                    ingredient_id=ingredient_id,
                    package_unit_id=package_unit_id,
                    content_unit_id=gram_id,
                    content_value=Decimal("400"),
                    label="400 g test package",
                    active=True,
                    provenance="RCP-25B PostgreSQL export integration fixture.",
                )
            )
            session.flush()

            # Insert out of authored order before publication seals the snapshot.
            # The export must sort by display order while preserving all three
            # occurrences of the same canonical ingredient.
            session.add_all(
                [
                    RecipeIngredient(
                        id=uuid4(),
                        recipe_version_id=recipe_id,
                        ingredient_id=ingredient_id,
                        name="Snapshot export ingredient",
                        measure_mode="exact",
                        quantity_min=Decimal("1"),
                        quantity_max=None,
                        measurement_unit_id=package_unit_id,
                        unit_display="package",
                        package_size_id=package_size_id,
                        preparation_notes=None,
                        display_order=2,
                    ),
                    RecipeIngredient(
                        id=uuid4(),
                        recipe_version_id=recipe_id,
                        ingredient_id=ingredient_id,
                        name="Snapshot export ingredient",
                        measure_mode="range",
                        quantity_min=Decimal("2"),
                        quantity_max=Decimal("3"),
                        measurement_unit_id=gram_id,
                        unit_display="g",
                        package_size_id=None,
                        preparation_notes=None,
                        display_order=0,
                    ),
                    RecipeIngredient(
                        id=uuid4(),
                        recipe_version_id=recipe_id,
                        ingredient_id=ingredient_id,
                        name="Snapshot export ingredient",
                        measure_mode="as_needed",
                        quantity_min=None,
                        quantity_max=None,
                        measurement_unit_id=None,
                        unit_display=None,
                        package_size_id=None,
                        preparation_notes=None,
                        display_order=1,
                    ),
                ]
            )
            session.flush()

            restored_after_cutoff_publication = RecipeVersionPublication(
                recipe_version_id=restored_after_cutoff_id,
                state="moderation_hidden",
                moderation_hidden_at=cutoff - timedelta(days=2),
                state_changed_at=cutoff - timedelta(days=2),
                actor_user_id=user_id,
                state_changed_by_user_id=user_id,
                published_at=cutoff - timedelta(days=3),
            )
            session.add_all(
                [
                    RecipeVersionPublication(
                        recipe_version_id=recipe_id,
                        state="published",
                        actor_user_id=user_id,
                        state_changed_by_user_id=user_id,
                        published_at=cutoff - timedelta(days=9),
                        state_changed_at=cutoff - timedelta(days=9),
                    ),
                    RecipeVersionPublication(
                        recipe_version_id=revision_id,
                        state="published",
                        actor_user_id=user_id,
                        state_changed_by_user_id=user_id,
                        published_at=cutoff - timedelta(days=7),
                        state_changed_at=cutoff - timedelta(days=7),
                    ),
                    RecipeVersionPublication(
                        recipe_version_id=adaptation_id,
                        state="published",
                        actor_user_id=user_id,
                        state_changed_by_user_id=user_id,
                        published_at=cutoff - timedelta(days=5),
                        state_changed_at=cutoff - timedelta(days=5),
                    ),
                    RecipeVersionPublication(
                        recipe_version_id=withdrawn_id,
                        state="author_withdrawn",
                        author_withdrawn_at=cutoff - timedelta(days=2),
                        actor_user_id=user_id,
                        state_changed_by_user_id=user_id,
                        published_at=cutoff - timedelta(days=3),
                        state_changed_at=cutoff - timedelta(days=2),
                    ),
                    RecipeVersionPublication(
                        recipe_version_id=future_revision_id,
                        state="published",
                        actor_user_id=user_id,
                        state_changed_by_user_id=user_id,
                        published_at=cutoff + timedelta(days=1),
                        state_changed_at=cutoff + timedelta(days=1),
                    ),
                    RecipeVersionPublication(
                        recipe_version_id=future_adaptation_id,
                        state="published",
                        actor_user_id=user_id,
                        state_changed_by_user_id=user_id,
                        published_at=cutoff + timedelta(days=1, hours=1),
                        state_changed_at=cutoff + timedelta(days=1, hours=1),
                    ),
                    restored_after_cutoff_publication,
                ]
            )
            session.add_all(
                [
                    Recipe(
                        id=stable_recipe_id,
                        lineage_id=lineage_id,
                        attributed_author_user_id=user_id,
                        owner_user_id=user_id,
                        current_recipe_version_id=future_revision_id,
                        created_at=cutoff - timedelta(days=9),
                    ),
                    Recipe(
                        id=adaptation_recipe_id,
                        lineage_id=lineage_id,
                        attributed_author_user_id=user_id,
                        owner_user_id=user_id,
                        current_recipe_version_id=adaptation_id,
                        created_at=cutoff - timedelta(days=5),
                    ),
                    Recipe(
                        id=withdrawn_recipe_id,
                        lineage_id=lineage_id,
                        attributed_author_user_id=user_id,
                        owner_user_id=user_id,
                        current_recipe_version_id=withdrawn_id,
                        created_at=cutoff - timedelta(days=3),
                    ),
                    Recipe(
                        id=restored_after_cutoff_recipe_id,
                        lineage_id=lineage_id,
                        attributed_author_user_id=user_id,
                        owner_user_id=user_id,
                        current_recipe_version_id=restored_after_cutoff_id,
                        created_at=cutoff - timedelta(days=3),
                    ),
                    Recipe(
                        id=future_adaptation_recipe_id,
                        lineage_id=lineage_id,
                        attributed_author_user_id=user_id,
                        owner_user_id=user_id,
                        current_recipe_version_id=future_adaptation_id,
                        created_at=cutoff + timedelta(days=1, hours=1),
                    ),
                ]
            )
            session.add_all(
                [
                    RecipeEdition(
                        recipe_version_id=recipe_id,
                        recipe_id=stable_recipe_id,
                        lineage_id=lineage_id,
                        attributed_author_user_id=user_id,
                        edition_number=1,
                        relation_kind="original",
                        previous_recipe_version_id=None,
                        declared_change_reason=None,
                    ),
                    RecipeEdition(
                        recipe_version_id=revision_id,
                        recipe_id=stable_recipe_id,
                        lineage_id=lineage_id,
                        attributed_author_user_id=user_id,
                        edition_number=2,
                        relation_kind="revision",
                        previous_recipe_version_id=recipe_id,
                        declared_change_reason="correction",
                    ),
                    RecipeEdition(
                        recipe_version_id=future_revision_id,
                        recipe_id=stable_recipe_id,
                        lineage_id=lineage_id,
                        attributed_author_user_id=user_id,
                        edition_number=3,
                        relation_kind="revision",
                        previous_recipe_version_id=revision_id,
                        declared_change_reason="update",
                    ),
                    RecipeEdition(
                        recipe_version_id=adaptation_id,
                        recipe_id=adaptation_recipe_id,
                        lineage_id=lineage_id,
                        attributed_author_user_id=user_id,
                        edition_number=1,
                        relation_kind="adaptation",
                        previous_recipe_version_id=None,
                        declared_change_reason=None,
                    ),
                    RecipeEdition(
                        recipe_version_id=withdrawn_id,
                        recipe_id=withdrawn_recipe_id,
                        lineage_id=lineage_id,
                        attributed_author_user_id=user_id,
                        edition_number=1,
                        relation_kind="adaptation",
                        previous_recipe_version_id=None,
                        declared_change_reason=None,
                    ),
                    RecipeEdition(
                        recipe_version_id=restored_after_cutoff_id,
                        recipe_id=restored_after_cutoff_recipe_id,
                        lineage_id=lineage_id,
                        attributed_author_user_id=user_id,
                        edition_number=1,
                        relation_kind="adaptation",
                        previous_recipe_version_id=None,
                        declared_change_reason=None,
                    ),
                    RecipeEdition(
                        recipe_version_id=future_adaptation_id,
                        recipe_id=future_adaptation_recipe_id,
                        lineage_id=lineage_id,
                        attributed_author_user_id=user_id,
                        edition_number=1,
                        relation_kind="adaptation",
                        previous_recipe_version_id=None,
                        declared_change_reason=None,
                    ),
                ]
            )
            session.add_all(
                [
                    RecipeStructuralFingerprint(
                        recipe_version_id=version_id,
                        algorithm_version="recipe-structure-v1",
                        digest=f"{digest_number:064x}",
                        canonical_payload="{}",
                    )
                    for digest_number, version_id in enumerate(
                        (
                            recipe_id,
                            revision_id,
                            adaptation_id,
                            withdrawn_id,
                            restored_after_cutoff_id,
                            future_revision_id,
                            future_adaptation_id,
                        ),
                        start=1,
                    )
                ]
            )
            session.flush()
            restored_after_cutoff_publication.state = "published"
            restored_after_cutoff_publication.moderation_hidden_at = None
            restored_after_cutoff_publication.state_changed_at = cutoff + timedelta(days=1)
            session.flush()

            session.add_all(
                [
                    PreferenceEvent(
                        id=included_view_id,
                        action_id=uuid4(),
                        user_id=user_id,
                        recipe_version_id=recipe_id,
                        event_type="view",
                        saved_value=None,
                        rating_value=None,
                        related_recipe_version_id=None,
                        request_fingerprint=None,
                        occurred_at=cutoff - timedelta(days=1),
                    ),
                    PreferenceEvent(
                        id=uuid4(),
                        action_id=uuid4(),
                        user_id=user_id,
                        recipe_version_id=recipe_id,
                        event_type="view",
                        saved_value=None,
                        rating_value=None,
                        related_recipe_version_id=None,
                        request_fingerprint=None,
                        occurred_at=created_at + timedelta(hours=12),
                    ),
                    PreferenceEvent(
                        id=deleted_view_id,
                        action_id=uuid4(),
                        user_id=deleted_user_id,
                        recipe_version_id=recipe_id,
                        event_type="view",
                        saved_value=None,
                        rating_value=None,
                        related_recipe_version_id=None,
                        request_fingerprint=None,
                        occurred_at=cutoff - timedelta(days=1),
                    ),
                    PreferenceEvent(
                        id=post_cutoff_view_id,
                        action_id=uuid4(),
                        user_id=user_id,
                        recipe_version_id=recipe_id,
                        event_type="view",
                        saved_value=None,
                        rating_value=None,
                        related_recipe_version_id=None,
                        request_fingerprint=None,
                        occurred_at=cutoff + timedelta(seconds=1),
                    ),
                    PreferenceEvent(
                        id=included_fork_id,
                        action_id=uuid4(),
                        user_id=user_id,
                        recipe_version_id=revision_id,
                        event_type="fork",
                        saved_value=None,
                        rating_value=None,
                        related_recipe_version_id=adaptation_id,
                        request_fingerprint="a" * 64,
                        occurred_at=cutoff - timedelta(days=1),
                    ),
                    PreferenceEvent(
                        id=post_cutoff_fork_id,
                        action_id=uuid4(),
                        user_id=user_id,
                        recipe_version_id=revision_id,
                        event_type="fork",
                        saved_value=None,
                        rating_value=None,
                        related_recipe_version_id=future_adaptation_id,
                        request_fingerprint="d" * 64,
                        occurred_at=cutoff + timedelta(days=2),
                    ),
                    PreferenceEvent(
                        id=uuid4(),
                        action_id=uuid4(),
                        user_id=user_id,
                        recipe_version_id=recipe_id,
                        event_type="fork",
                        saved_value=None,
                        rating_value=None,
                        related_recipe_version_id=revision_id,
                        request_fingerprint="b" * 64,
                        occurred_at=cutoff - timedelta(days=1),
                    ),
                    PreferenceEvent(
                        id=uuid4(),
                        action_id=uuid4(),
                        user_id=user_id,
                        recipe_version_id=revision_id,
                        event_type="fork",
                        saved_value=None,
                        rating_value=None,
                        related_recipe_version_id=withdrawn_id,
                        request_fingerprint="c" * 64,
                        occurred_at=cutoff - timedelta(days=1),
                    ),
                ]
            )
            session.flush()

            _recipes_before_deletion, events_before_deletion = _extract_from_connection(
                connection,
                cutoff=cutoff,
            )
            assert deleted_view_id in {event.id for event in events_before_deletion}

            tombstone_member_from_durable_deletion_evidence(
                session,
                user_id=deleted_user_id,
                deleted_at=cutoff,
            )
            session.flush()

            recipes, events = _extract_from_connection(connection, cutoff=cutoff)
            snapshot = create_snapshot(
                dataset_id=f"rcp-53g-export-{unique_token}",
                cutoff=cutoff,
                limitations=("Integration fixture only.",),
                recipes=recipes,
                events=events,
                schema_version=SNAPSHOT_SCHEMA_VERSION,
            )
            exported_recipe = next(recipe for recipe in snapshot.recipes if recipe.id == recipe_id)
            exported_revision = next(
                recipe for recipe in snapshot.recipes if recipe.id == revision_id
            )
            exported_adaptation = next(
                recipe for recipe in snapshot.recipes if recipe.id == adaptation_id
            )
            exported_future_revision = next(
                recipe for recipe in snapshot.recipes if recipe.id == future_revision_id
            )
            exported_future_adaptation = next(
                recipe for recipe in snapshot.recipes if recipe.id == future_adaptation_id
            )
            measures = exported_recipe.ingredient_measures

            assert snapshot.schema_version == SNAPSHOT_SCHEMA_VERSION
            assert {recipe.id for recipe in snapshot.recipes} == {
                recipe_id,
                revision_id,
                adaptation_id,
                future_revision_id,
                future_adaptation_id,
            }
            assert exported_recipe.recipe_id == stable_recipe_id
            assert exported_recipe.relation_kind == "original"
            assert exported_recipe.base_recipe_version_id is None
            assert exported_revision.recipe_id == stable_recipe_id
            assert exported_revision.edition_number == 2
            assert exported_revision.relation_kind == "revision"
            assert exported_revision.base_recipe_version_id == recipe_id
            assert exported_revision.declared_change_reason == "correction"
            assert exported_adaptation.relation_kind == "adaptation"
            assert exported_adaptation.base_recipe_version_id == revision_id
            assert exported_future_revision.relation_kind == "revision"
            assert exported_future_revision.base_recipe_version_id == revision_id
            assert exported_future_revision.declared_change_reason == "update"
            assert exported_future_adaptation.relation_kind == "adaptation"
            assert exported_future_adaptation.base_recipe_version_id == revision_id
            assert exported_recipe.structural_fingerprints[0].algorithm_version == (
                "recipe-structure-v1"
            )
            assert [measure.kind for measure in measures] == [
                "range",
                "qualitative",
                "exact",
            ]
            assert [measure.ingredient_id for measure in measures] == [ingredient_id] * 3
            assert measures[0].quantity_min == Decimal("2")
            assert measures[0].quantity_max == Decimal("3")
            assert measures[0].measurement_unit_id == gram_id
            assert measures[1].qualitative_value == "as_needed"
            assert measures[1].measurement_unit_id is None
            assert measures[2].quantity_min == Decimal("1")
            assert measures[2].measurement_unit_id == package_unit_id
            assert measures[2].package_size_id == package_size_id
            assert {event.id for event in snapshot.events} == {
                included_view_id,
                post_cutoff_view_id,
                included_fork_id,
                post_cutoff_fork_id,
            }
            assert deleted_view_id not in {event.id for event in snapshot.events}
            assert {event.id for event in split_snapshot(snapshot).holdout_events} == {
                post_cutoff_view_id,
                post_cutoff_fork_id,
            }
            assert {recipe.id for recipe in split_snapshot(snapshot).recipes} == {
                recipe_id,
                revision_id,
                adaptation_id,
            }
        finally:
            session.close()
            if transaction.is_active:
                transaction.rollback()
    engine.dispose()
