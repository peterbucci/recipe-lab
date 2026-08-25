from decimal import Decimal
from typing import cast
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    Ingredient,
    IngredientDensityRule,
    IngredientPackageSize,
    MeasurementConversionRule,
    MeasurementUnit,
    MeasurementUnitAlias,
    RecipeIngredient,
    RecipeLineage,
    RecipeVersion,
    User,
)


def _constraint_name(error: IntegrityError) -> str | None:
    diagnostic = getattr(error.orig, "diag", None)
    return cast(str | None, getattr(diagnostic, "constraint_name", None))


def _unit(
    session: Session,
    key: str,
    dimension: str,
    *,
    symbol: str | None,
    display_style: str,
) -> MeasurementUnit:
    unit = MeasurementUnit(
        key=key,
        dimension=dimension,
        conversion_family=f"{key}-family",
        canonical_label=key,
        plural_label=f"{key}s",
        symbol=symbol,
        display_style=display_style,
        active=True,
        provenance="Reviewed model-test metadata.",
    )
    session.add(unit)
    session.flush()
    return unit


def test_measurement_catalog_models_round_trip_reviewed_metadata(db_session: Session) -> None:
    suffix = uuid4().hex[:10]
    gram = _unit(
        db_session,
        f"gram-{suffix}",
        "mass",
        symbol="g-test",
        display_style="symbol",
    )
    alias = MeasurementUnitAlias(
        measurement_unit_id=gram.id,
        alias=f"gram alias {suffix}",
    )
    rule = MeasurementConversionRule(
        unit_id=gram.id,
        base_unit_id=gram.id,
        scale_numerator=1,
        scale_denominator=1,
        offset_numerator=0,
        offset_denominator=1,
        active=True,
        provenance="Reviewed identity conversion.",
    )
    db_session.add_all([alias, rule])
    db_session.flush()
    db_session.expire_all()

    loaded = db_session.get(MeasurementUnit, gram.id)
    assert loaded is not None
    assert loaded.dimension == "mass"
    assert [item.alias for item in loaded.aliases] == [alias.alias]
    assert loaded.conversion_rule is not None
    assert loaded.conversion_rule.scale_numerator == 1


def test_measurement_unit_symbol_display_requires_a_symbol(db_session: Session) -> None:
    suffix = uuid4().hex[:10]
    invalid = MeasurementUnit(
        key=f"invalid-symbol-{suffix}",
        dimension="mass",
        conversion_family=f"invalid-symbol-{suffix}",
        canonical_label=f"invalid symbol {suffix}",
        plural_label=f"invalid symbols {suffix}",
        symbol=None,
        display_style="symbol",
        active=True,
        provenance="Invalid model-test metadata.",
    )

    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.add(invalid)
            db_session.flush()

    assert _constraint_name(error.value) == "ck_measurement_units_symbol_style_requires_symbol"


def test_density_and_package_models_require_positive_reviewed_values(
    db_session: Session,
) -> None:
    suffix = uuid4().hex[:10]
    ingredient = Ingredient(canonical_name=f"Measurement model ingredient {suffix}")
    db_session.add(ingredient)
    db_session.flush()
    gram = _unit(
        db_session,
        f"density-gram-{suffix}",
        "mass",
        symbol="dg",
        display_style="symbol",
    )
    milliliter = _unit(
        db_session,
        f"density-ml-{suffix}",
        "volume",
        symbol="dml",
        display_style="symbol",
    )
    package = _unit(
        db_session,
        f"density-package-{suffix}",
        "package",
        symbol=None,
        display_style="word",
    )
    density = IngredientDensityRule(
        ingredient_id=ingredient.id,
        mass_unit_id=gram.id,
        volume_unit_id=milliliter.id,
        mass_value=Decimal("100.000000"),
        volume_value=Decimal("80.000000"),
        active=True,
        provenance="Reviewed model-test density.",
    )
    package_size = IngredientPackageSize(
        ingredient_id=ingredient.id,
        package_unit_id=package.id,
        content_unit_id=gram.id,
        content_value=Decimal("400.000000"),
        label="400 g model-test package",
        active=True,
        provenance="Reviewed model-test package size.",
    )
    db_session.add_all([density, package_size])
    db_session.flush()

    assert density.mass_value == Decimal("100.000000")
    assert package_size.content_value == Decimal("400.000000")

    invalid = IngredientPackageSize(
        ingredient_id=ingredient.id,
        package_unit_id=package.id,
        content_unit_id=milliliter.id,
        content_value=Decimal("0"),
        label="Invalid empty package",
        active=True,
        provenance="Invalid model-test package size.",
    )
    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.add(invalid)
            db_session.flush()

    assert _constraint_name(error.value) == ("ck_ingredient_package_sizes_content_value_positive")


def test_recipe_package_size_must_belong_to_the_selected_ingredient(
    db_session: Session,
) -> None:
    suffix = uuid4().hex[:10]
    packaged_ingredient = Ingredient(canonical_name=f"Packaged ingredient {suffix}")
    other_ingredient = Ingredient(canonical_name=f"Other ingredient {suffix}")
    user = User(
        email=f"package-owner-{suffix}@example.com",
        display_name="Package ownership test",
    )
    db_session.add_all([packaged_ingredient, other_ingredient, user])
    db_session.flush()
    package_unit = _unit(
        db_session,
        f"package-owner-unit-{suffix}",
        "package",
        symbol=None,
        display_style="word",
    )
    content_unit = _unit(
        db_session,
        f"package-owner-content-{suffix}",
        "mass",
        symbol=f"p{suffix[:4]}",
        display_style="symbol",
    )
    package_size = IngredientPackageSize(
        ingredient_id=packaged_ingredient.id,
        package_unit_id=package_unit.id,
        content_unit_id=content_unit.id,
        content_value=Decimal("400.000000"),
        label=f"400 g ownership package {suffix}",
        active=True,
        provenance="Reviewed package ownership test metadata.",
    )
    lineage = RecipeLineage(created_by_user_id=user.id)
    db_session.add_all([package_size, lineage])
    db_session.flush()
    version = RecipeVersion(
        lineage_id=lineage.id,
        parent_version_id=None,
        created_by_user_id=user.id,
        version_number=1,
        title="Package ownership recipe",
        description=None,
        servings=Decimal("1.00"),
    )
    db_session.add(version)
    db_session.flush()

    invalid_row = RecipeIngredient(
        recipe_version_id=version.id,
        ingredient_id=other_ingredient.id,
        name=other_ingredient.canonical_name,
        measure_mode="exact",
        quantity_min=Decimal("1.0000"),
        quantity_max=None,
        measurement_unit_id=package_unit.id,
        unit_display=package_unit.canonical_label,
        package_size_id=package_size.id,
        preparation_notes=None,
        display_order=0,
    )
    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.add(invalid_row)
            db_session.flush()

    assert _constraint_name(error.value) == (
        "fk_recipe_version_ingredients_package_size_ingredient_unit"
    )

    wrong_unit_row = RecipeIngredient(
        recipe_version_id=version.id,
        ingredient_id=packaged_ingredient.id,
        name=packaged_ingredient.canonical_name,
        measure_mode="exact",
        quantity_min=Decimal("1.0000"),
        quantity_max=None,
        measurement_unit_id=content_unit.id,
        unit_display=content_unit.symbol,
        package_size_id=package_size.id,
        preparation_notes=None,
        display_order=0,
    )
    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.add(wrong_unit_row)
            db_session.flush()

    assert _constraint_name(error.value) == (
        "fk_recipe_version_ingredients_package_size_ingredient_unit"
    )
