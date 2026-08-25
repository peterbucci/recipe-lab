import os
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from app.models import (
    ACCOUNT_KIND_MEMBER,
    USER_STATUS_ACTIVE,
    Ingredient,
    IngredientPackageSize,
    RecipeIngredient,
    RecipeLineage,
    RecipeVersion,
    User,
)
from app.seeds.identifiers import measurement_uuid
from sqlalchemy import create_engine, delete
from sqlalchemy.orm import Session

from recipe_lab_evaluation.dataset import SNAPSHOT_SCHEMA_VERSION
from recipe_lab_evaluation.sources.postgres import (
    SnapshotExportError,
    _ingredient_measure,
    export_postgres_snapshot,
)

INGREDIENT_ID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
UNIT_ID = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
PACKAGE_SIZE_ID = UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc")


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


def test_export_reads_occurrence_preserving_structured_measures_from_migrated_postgres() -> None:
    database_url = os.environ.get("TEST_DATABASE_URL")
    if database_url is None:
        pytest.skip("TEST_DATABASE_URL is required for the PostgreSQL export integration test")

    user_id = uuid4()
    lineage_id = uuid4()
    recipe_id = uuid4()
    ingredient_id = uuid4()
    package_size_id = uuid4()
    gram_id = measurement_uuid("unit", "g")
    package_unit_id = measurement_uuid("unit", "package")
    unique_token = recipe_id.hex
    engine = create_engine(database_url, pool_pre_ping=True)
    fixture_committed = False

    try:
        with Session(engine) as session, session.begin():
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
                )
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

            # Insert out of authored order. The export must sort by display order while
            # preserving all three occurrences of the same canonical ingredient.
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
        fixture_committed = True

        snapshot = export_postgres_snapshot(
            database_url=database_url,
            dataset_id=f"rcp-25b-export-{unique_token}",
            cutoff=datetime(2100, 1, 1, tzinfo=UTC),
            limitations=("Integration fixture only.",),
        )
        exported_recipe = next(recipe for recipe in snapshot.recipes if recipe.id == recipe_id)
        measures = exported_recipe.ingredient_measures

        assert snapshot.schema_version == SNAPSHOT_SCHEMA_VERSION
        assert [measure.kind for measure in measures] == ["range", "qualitative", "exact"]
        assert [measure.ingredient_id for measure in measures] == [ingredient_id] * 3
        assert measures[0].quantity_min == Decimal("2")
        assert measures[0].quantity_max == Decimal("3")
        assert measures[0].measurement_unit_id == gram_id
        assert measures[1].qualitative_value == "as_needed"
        assert measures[1].measurement_unit_id is None
        assert measures[2].quantity_min == Decimal("1")
        assert measures[2].measurement_unit_id == package_unit_id
        assert measures[2].package_size_id == package_size_id
    finally:
        if fixture_committed:
            with engine.begin() as connection:
                connection.execute(
                    delete(RecipeIngredient).where(RecipeIngredient.recipe_version_id == recipe_id)
                )
                connection.execute(
                    delete(IngredientPackageSize).where(IngredientPackageSize.id == package_size_id)
                )
                connection.execute(delete(RecipeVersion).where(RecipeVersion.id == recipe_id))
                connection.execute(delete(RecipeLineage).where(RecipeLineage.id == lineage_id))
                connection.execute(delete(Ingredient).where(Ingredient.id == ingredient_id))
                connection.execute(delete(User).where(User.id == user_id))
        engine.dispose()
