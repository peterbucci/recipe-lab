from collections.abc import Sequence
from decimal import Decimal
from typing import cast
from uuid import UUID, uuid4

import pytest
from pytest import MonkeyPatch
from sqlalchemy.orm import Session

from app.models import (
    IngredientDensityRule,
    IngredientPackageSize,
    MeasurementConversionRule,
    MeasurementUnit,
    MeasurementUnitAlias,
)
from app.schemas.measurements import ExactMeasureInput, MeasurementConversionRequest
from app.services import measurements

TEST_SESSION = cast(Session, object())


def test_measurement_unit_snapshot_label_prefers_symbol() -> None:
    assert measurements.measurement_unit_snapshot_label("g", "gram") == "g"
    assert measurements.measurement_unit_snapshot_label(None, "pinch") == "pinch"


def _unit(
    key: str,
    dimension: str,
    *,
    family: str | None = None,
    symbol: str | None = None,
    display_style: str = "symbol",
    active: bool = True,
) -> MeasurementUnit:
    canonical = key.replace("-", " ")
    return MeasurementUnit(
        id=uuid4(),
        key=key,
        dimension=dimension,
        conversion_family=family or key,
        canonical_label=canonical,
        plural_label=f"{canonical}s",
        symbol=symbol,
        display_style=display_style,
        active=active,
        provenance="Reviewed test metadata.",
    )


def _rule(
    unit: MeasurementUnit,
    base: MeasurementUnit,
    *,
    scale_numerator: int,
    scale_denominator: int = 1,
    offset_numerator: int = 0,
    offset_denominator: int = 1,
) -> MeasurementConversionRule:
    return MeasurementConversionRule(
        unit_id=unit.id,
        base_unit_id=base.id,
        scale_numerator=scale_numerator,
        scale_denominator=scale_denominator,
        offset_numerator=offset_numerator,
        offset_denominator=offset_denominator,
        active=True,
        provenance="Reviewed test conversion.",
    )


def _install_catalog(
    monkeypatch: MonkeyPatch,
    *,
    units: Sequence[MeasurementUnit],
    rules: Sequence[MeasurementConversionRule] = (),
    densities: dict[UUID, list[IngredientDensityRule]] | None = None,
    packages: Sequence[IngredientPackageSize] = (),
) -> None:
    units_by_id = {unit.id: unit for unit in units}
    rules_by_id = {rule.unit_id: rule for rule in rules}
    packages_by_id = {package.id: package for package in packages}
    densities_by_ingredient = densities or {}

    monkeypatch.setattr(
        measurements,
        "get_measurement_unit",
        lambda _session, unit_id: units_by_id.get(unit_id),
    )
    monkeypatch.setattr(
        measurements,
        "get_measurement_conversion_rule",
        lambda _session, unit_id: rules_by_id.get(unit_id),
    )
    monkeypatch.setattr(
        measurements,
        "get_active_ingredient_density_rules",
        lambda _session, ingredient_id: densities_by_ingredient.get(ingredient_id, []),
    )
    monkeypatch.setattr(
        measurements,
        "get_ingredient_package_size",
        lambda _session, package_size_id: packages_by_id.get(package_size_id),
    )


def test_catalog_serialization_and_historical_inactive_measure_display() -> None:
    gram = _unit("gram", "mass", family="metric-mass", symbol="g", active=False)
    gram.aliases.append(
        MeasurementUnitAlias(
            id=uuid4(),
            measurement_unit_id=gram.id,
            alias="gramme",
        )
    )

    item = measurements.measurement_unit_catalog_item(gram)
    measure = measurements.serialize_measure(
        kind="exact",
        quantity_min=Decimal("1.500000"),
        quantity_max=None,
        unit=gram,
        package_size_id=None,
    )

    assert item.aliases == ["gramme"]
    assert item.active is False
    assert measure.unit is not None
    assert measure.unit.active is False
    assert measure.display == "1.5 g"


def test_new_measure_validation_rejects_inactive_units(monkeypatch: MonkeyPatch) -> None:
    gram = _unit("gram", "mass", symbol="g", active=False)
    _install_catalog(monkeypatch, units=[gram])

    with pytest.raises(measurements.MeasurementUnitInactiveError):
        measurements.validate_measure_input(
            TEST_SESSION,
            semantic="ingredient_amount",
            measure=ExactMeasureInput(kind="exact", value=Decimal("1"), unit_id=gram.id),
        )


def test_same_family_conversion_uses_exact_rational_rules(monkeypatch: MonkeyPatch) -> None:
    gram = _unit("gram", "mass", family="metric-mass", symbol="g")
    kilogram = _unit("kilogram", "mass", family="metric-mass", symbol="kg")
    rules = [
        _rule(gram, gram, scale_numerator=1),
        _rule(kilogram, gram, scale_numerator=1000),
    ]
    _install_catalog(monkeypatch, units=[gram, kilogram], rules=rules)

    response = measurements.convert_measurement(
        TEST_SESSION,
        MeasurementConversionRequest(
            semantic="ingredient_amount",
            value=Decimal("1.25"),
            from_unit_id=kilogram.id,
            target_unit_id=gram.id,
        ),
    )

    assert response.value == Decimal("1250.000000")
    assert response.display == "1250 g"


def test_conversion_rejects_nonzero_values_that_round_to_zero(
    monkeypatch: MonkeyPatch,
) -> None:
    gram = _unit("gram", "mass", family="metric-mass", symbol="g")
    kilogram = _unit("kilogram", "mass", family="metric-mass", symbol="kg")
    rules = [
        _rule(gram, gram, scale_numerator=1),
        _rule(kilogram, gram, scale_numerator=1000),
    ]
    _install_catalog(monkeypatch, units=[gram, kilogram], rules=rules)

    with pytest.raises(
        measurements.MeasurementValueOutOfRangeError,
        match="smaller than the supported six-decimal precision",
    ):
        measurements.convert_measurement(
            TEST_SESSION,
            MeasurementConversionRequest(
                semantic="ingredient_amount",
                value=Decimal("0.000500"),
                from_unit_id=gram.id,
                target_unit_id=kilogram.id,
            ),
        )

    response = measurements.convert_measurement(
        TEST_SESSION,
        MeasurementConversionRequest(
            semantic="ingredient_amount",
            value=Decimal("0.000501"),
            from_unit_id=gram.id,
            target_unit_id=kilogram.id,
        ),
    )

    assert response.value == Decimal("0.000001")


def test_conversion_revalidates_positive_target_semantics(
    monkeypatch: MonkeyPatch,
) -> None:
    source = _unit("source-gram", "mass", family="reviewed-offset-mass", symbol="sg")
    target = _unit("target-gram", "mass", family="reviewed-offset-mass", symbol="tg")
    rules = [
        _rule(source, source, scale_numerator=1),
        _rule(target, source, scale_numerator=1, offset_numerator=10),
    ]
    _install_catalog(monkeypatch, units=[source, target], rules=rules)

    with pytest.raises(
        measurements.MeasurementSemanticError,
        match="ingredient_amount numeric values must be greater than zero",
    ):
        measurements.convert_measurement(
            TEST_SESSION,
            MeasurementConversionRequest(
                semantic="ingredient_amount",
                value=Decimal("5"),
                from_unit_id=source.id,
                target_unit_id=target.id,
            ),
        )


def test_word_unit_with_symbol_uses_labels_and_upper_bound_pluralization() -> None:
    cup = _unit("cup", "volume", symbol="cup", display_style="word")

    singular_display, singular_unit = measurements.format_measure(
        kind="range",
        quantity_min=Decimal("0.5"),
        quantity_max=Decimal("1"),
        unit=cup,
    )
    plural_display, plural_unit = measurements.format_measure(
        kind="range",
        quantity_min=Decimal("1"),
        quantity_max=Decimal("2"),
        unit=cup,
    )

    assert (singular_display, singular_unit) == ("0.5–1 cup", "cup")
    assert (plural_display, plural_unit) == ("1–2 cups", "cups")


def test_affine_temperature_conversion_keeps_signed_values(monkeypatch: MonkeyPatch) -> None:
    celsius = _unit("celsius", "temperature", family="temperature", symbol="°C")
    fahrenheit = _unit("fahrenheit", "temperature", family="temperature", symbol="°F")
    rules = [
        _rule(celsius, celsius, scale_numerator=1),
        _rule(
            fahrenheit,
            celsius,
            scale_numerator=5,
            scale_denominator=9,
            offset_numerator=-32,
        ),
    ]
    _install_catalog(monkeypatch, units=[celsius, fahrenheit], rules=rules)

    response = measurements.convert_measurement(
        TEST_SESSION,
        MeasurementConversionRequest(
            semantic="temperature",
            value=Decimal("-40"),
            from_unit_id=fahrenheit.id,
            target_unit_id=celsius.id,
        ),
    )

    assert response.value == Decimal("-40.000000")
    assert response.display == "-40 °C"


def test_distinct_count_units_and_unreviewed_density_are_never_inferred(
    monkeypatch: MonkeyPatch,
) -> None:
    count = _unit("count", "count", display_style="hidden")
    clove = _unit("clove", "count", display_style="word")
    gram = _unit("gram", "mass", symbol="g")
    milliliter = _unit("milliliter", "volume", symbol="ml")
    _install_catalog(monkeypatch, units=[count, clove, gram, milliliter])

    with pytest.raises(measurements.MeasurementConversionUnsupportedError):
        measurements.convert_measurement(
            TEST_SESSION,
            MeasurementConversionRequest(
                semantic="ingredient_amount",
                value=Decimal("2"),
                from_unit_id=count.id,
                target_unit_id=clove.id,
            ),
        )
    with pytest.raises(measurements.IngredientDensityRequiredError):
        measurements.convert_measurement(
            TEST_SESSION,
            MeasurementConversionRequest(
                semantic="ingredient_amount",
                value=Decimal("100"),
                from_unit_id=gram.id,
                target_unit_id=milliliter.id,
                ingredient_id=uuid4(),
            ),
        )


def test_reviewed_density_is_scoped_to_the_exact_ingredient(monkeypatch: MonkeyPatch) -> None:
    gram = _unit("gram", "mass", symbol="g")
    milliliter = _unit("milliliter", "volume", symbol="ml")
    ingredient_id = uuid4()
    density = IngredientDensityRule(
        id=uuid4(),
        ingredient_id=ingredient_id,
        mass_unit_id=gram.id,
        volume_unit_id=milliliter.id,
        mass_value=Decimal("100"),
        volume_value=Decimal("80"),
        active=True,
        provenance="Reviewed test density.",
    )
    density.mass_unit = gram
    density.volume_unit = milliliter
    _install_catalog(
        monkeypatch,
        units=[gram, milliliter],
        densities={ingredient_id: [density]},
    )

    response = measurements.convert_measurement(
        TEST_SESSION,
        MeasurementConversionRequest(
            semantic="ingredient_amount",
            value=Decimal("50"),
            from_unit_id=gram.id,
            target_unit_id=milliliter.id,
            ingredient_id=ingredient_id,
        ),
    )

    assert response.value == Decimal("40.000000")
    with pytest.raises(measurements.IngredientDensityRequiredError):
        measurements.convert_measurement(
            TEST_SESSION,
            MeasurementConversionRequest(
                semantic="ingredient_amount",
                value=Decimal("50"),
                from_unit_id=gram.id,
                target_unit_id=milliliter.id,
                ingredient_id=uuid4(),
            ),
        )


def test_package_conversion_requires_the_exact_reviewed_size(monkeypatch: MonkeyPatch) -> None:
    can = _unit("can", "package", display_style="word")
    gram = _unit("gram", "mass", symbol="g")
    ingredient_id = uuid4()
    package = IngredientPackageSize(
        id=uuid4(),
        ingredient_id=ingredient_id,
        package_unit_id=can.id,
        content_unit_id=gram.id,
        content_value=Decimal("400"),
        label="400 g can",
        active=True,
        provenance="Reviewed test package size.",
    )
    package.package_unit = can
    package.content_unit = gram
    _install_catalog(monkeypatch, units=[can, gram], packages=[package])

    with pytest.raises(measurements.PackageSizeRequiredError):
        measurements.convert_measurement(
            TEST_SESSION,
            MeasurementConversionRequest(
                semantic="ingredient_amount",
                value=Decimal("2"),
                from_unit_id=can.id,
                target_unit_id=gram.id,
            ),
        )

    response = measurements.convert_measurement(
        TEST_SESSION,
        MeasurementConversionRequest(
            semantic="ingredient_amount",
            value=Decimal("2"),
            from_unit_id=can.id,
            target_unit_id=gram.id,
            ingredient_id=ingredient_id,
            package_size_id=package.id,
        ),
    )
    assert response.value == Decimal("800.000000")


def test_recipe_measure_package_metadata_is_scoped_to_ingredient_and_unit(
    monkeypatch: MonkeyPatch,
) -> None:
    can = _unit("can", "package", display_style="word")
    gram = _unit("gram", "mass", symbol="g")
    ingredient_id = uuid4()
    package = IngredientPackageSize(
        id=uuid4(),
        ingredient_id=ingredient_id,
        package_unit_id=can.id,
        content_unit_id=gram.id,
        content_value=Decimal("400"),
        label="400 g can",
        active=True,
        provenance="Reviewed recipe package test size.",
    )
    package.package_unit = can
    package.content_unit = gram
    _install_catalog(monkeypatch, units=[can, gram], packages=[package])
    measure = ExactMeasureInput(
        kind="exact",
        value=Decimal("2"),
        unit_id=can.id,
        package_size_id=package.id,
    )

    assert (
        measurements.validate_measure_input(
            TEST_SESSION,
            semantic="ingredient_amount",
            measure=measure,
            ingredient_id=ingredient_id,
        )
        is can
    )
    with pytest.raises(measurements.MeasurementMetadataMismatchError):
        measurements.validate_measure_input(
            TEST_SESSION,
            semantic="ingredient_amount",
            measure=measure,
            ingredient_id=uuid4(),
        )
    with pytest.raises(measurements.MeasurementMetadataMismatchError):
        measurements.validate_measure_input(
            TEST_SESSION,
            semantic="ingredient_amount",
            measure=measure.model_copy(update={"unit_id": gram.id}),
            ingredient_id=ingredient_id,
        )


def test_same_package_unit_is_an_identity_without_package_inference(
    monkeypatch: MonkeyPatch,
) -> None:
    can = _unit("can", "package", display_style="word")
    _install_catalog(monkeypatch, units=[can])

    response = measurements.convert_measurement(
        TEST_SESSION,
        MeasurementConversionRequest(
            semantic="ingredient_amount",
            value=Decimal("2"),
            from_unit_id=can.id,
            target_unit_id=can.id,
        ),
    )

    assert response.value == Decimal("2.000000")
    assert response.display == "2 cans"
