from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation, localcontext
from fractions import Fraction
from typing import Literal, cast
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import (
    IngredientPackageSize,
    MeasurementConversionRule,
    MeasurementUnit,
)
from app.repositories.measurements import (
    get_active_ingredient_density_rules,
    get_ingredient_package_size,
    get_measurement_conversion_rule,
    get_measurement_unit,
)
from app.schemas.measurements import (
    ExactMeasureInput,
    ExactMeasureResponse,
    MeasurementConversionRequest,
    MeasurementConversionResponse,
    MeasurementDimension,
    MeasurementDisplayStyle,
    MeasurementSemantic,
    MeasurementUnitCatalogItem,
    MeasurementUnitSummary,
    QualitativeMeasureInput,
    QualitativeMeasureResponse,
    RangeMeasureResponse,
    StructuredMeasureInput,
    StructuredMeasureResponse,
    validate_measure_semantics,
)

type StoredMeasureKind = Literal[
    "exact",
    "range",
    "to_taste",
    "as_needed",
    "unspecified",
]

CONVERSION_QUANTUM = Decimal("0.000001")
_QUALITATIVE_DISPLAY: dict[str, str] = {
    "to_taste": "to taste",
    "as_needed": "as needed",
    "unspecified": "amount unspecified",
}


class MeasurementError(ValueError):
    code = "measurement_error"
    status_code = 422


class MeasurementUnitNotFoundError(MeasurementError):
    code = "measurement_unit_not_found"
    status_code = 404


class MeasurementUnitInactiveError(MeasurementError):
    code = "measurement_unit_inactive"


class MeasurementSemanticError(MeasurementError):
    code = "measurement_semantic_mismatch"


class MeasurementConversionUnsupportedError(MeasurementError):
    code = "measurement_conversion_unsupported"


class IngredientDensityRequiredError(MeasurementError):
    code = "ingredient_density_required"


class IngredientDensityAmbiguousError(MeasurementError):
    code = "ingredient_density_ambiguous"


class PackageSizeRequiredError(MeasurementError):
    code = "package_size_required"


class PackageSizeNotFoundError(MeasurementError):
    code = "package_size_not_found"
    status_code = 404


class PackageSizeInactiveError(MeasurementError):
    code = "package_size_inactive"


class MeasurementMetadataMismatchError(MeasurementError):
    code = "measurement_metadata_mismatch"


class MeasurementValueOutOfRangeError(MeasurementError):
    code = "measurement_value_out_of_range"


def measurement_unit_snapshot_label(symbol: str | None, canonical_label: str) -> str:
    """Choose the immutable unit label stored with authored recipe measurements."""

    return symbol or canonical_label


def measurement_unit_summary(unit: MeasurementUnit) -> MeasurementUnitSummary:
    """Serialize a unit without hiding its historical inactive state."""

    return MeasurementUnitSummary(
        id=unit.id,
        key=unit.key,
        dimension=cast(MeasurementDimension, unit.dimension),
        canonical_label=unit.canonical_label,
        plural_label=unit.plural_label,
        symbol=unit.symbol,
        display_style=cast(MeasurementDisplayStyle, unit.display_style),
        active=unit.active,
    )


def measurement_unit_catalog_item(unit: MeasurementUnit) -> MeasurementUnitCatalogItem:
    return MeasurementUnitCatalogItem(
        **measurement_unit_summary(unit).model_dump(),
        aliases=sorted((alias.alias for alias in unit.aliases), key=lambda value: value.casefold()),
        provenance=unit.provenance,
    )


def _require_active_unit(session: Session, unit_id: UUID) -> MeasurementUnit:
    unit = get_measurement_unit(session, unit_id)
    if unit is None:
        raise MeasurementUnitNotFoundError(f"Measurement unit {unit_id} was not found.")
    if not unit.active:
        raise MeasurementUnitInactiveError(
            f"Measurement unit {unit_id} is inactive and cannot be used for new measurements."
        )
    return unit


def validate_measure_input(
    session: Session,
    *,
    semantic: MeasurementSemantic,
    measure: StructuredMeasureInput,
    ingredient_id: UUID | None = None,
) -> MeasurementUnit | None:
    """Resolve and validate a new structured measure against the active catalog."""

    if isinstance(measure, QualitativeMeasureInput):
        try:
            validate_measure_semantics(measure, semantic, None)
        except ValueError as error:
            raise MeasurementSemanticError(str(error)) from error
        return None

    unit = _require_active_unit(session, measure.unit_id)
    try:
        validate_measure_semantics(
            measure,
            semantic,
            cast(MeasurementDimension, unit.dimension),
        )
    except ValueError as error:
        raise MeasurementSemanticError(str(error)) from error

    if measure.package_size_id is not None:
        if semantic != "ingredient_amount" or ingredient_id is None:
            raise MeasurementMetadataMismatchError(
                "Package-size metadata requires one explicit ingredient amount."
            )
        package_size = _active_package_size(session, measure.package_size_id)
        if package_size.ingredient_id != ingredient_id:
            raise MeasurementMetadataMismatchError(
                "The package size does not belong to the measured ingredient."
            )
        if package_size.package_unit_id != unit.id:
            raise MeasurementMetadataMismatchError(
                "The package size does not describe the selected package unit."
            )
    return unit


def _natural_decimal(value: Decimal) -> str:
    if value == 0:
        return "0"
    return format(value.normalize(), "f")


def _display_unit(
    unit: MeasurementUnit,
    *,
    singular: bool,
) -> str | None:
    if unit.display_style == "hidden":
        return None
    if unit.display_style == "symbol":
        if unit.symbol is None:
            raise RuntimeError(f"Symbol-style measurement unit {unit.id} has no symbol.")
        return unit.symbol
    if unit.display_style == "word":
        return unit.canonical_label if singular else unit.plural_label
    raise RuntimeError(f"Measurement unit {unit.id} has unsupported display style.")


def format_measure(
    *,
    kind: str,
    quantity_min: Decimal | None,
    quantity_max: Decimal | None,
    unit: MeasurementUnit | None,
) -> tuple[str, str | None]:
    """Return natural display text and the exact curated display unit."""

    if kind in _QUALITATIVE_DISPLAY:
        if quantity_min is not None or quantity_max is not None or unit is not None:
            raise ValueError("qualitative measures cannot contain numeric values or units")
        return _QUALITATIVE_DISPLAY[kind], None

    if kind == "exact":
        if quantity_min is None or quantity_max is not None or unit is None:
            raise ValueError("exact measures require one value and one unit")
        display_unit = _display_unit(unit, singular=abs(quantity_min) == 1)
        value_text = _natural_decimal(quantity_min)
        return (f"{value_text} {display_unit}" if display_unit else value_text), display_unit

    if kind == "range":
        if quantity_min is None or quantity_max is None or unit is None:
            raise ValueError("range measures require two values and one unit")
        if quantity_min >= quantity_max:
            raise ValueError("measurement range minimum must be less than maximum")
        display_unit = _display_unit(unit, singular=abs(quantity_max) == 1)
        value_text = f"{_natural_decimal(quantity_min)}–{_natural_decimal(quantity_max)}"
        return (f"{value_text} {display_unit}" if display_unit else value_text), display_unit

    raise ValueError(f"Unsupported stored measure kind {kind!r}.")


def serialize_measure(
    *,
    kind: str,
    quantity_min: Decimal | None,
    quantity_max: Decimal | None,
    unit: MeasurementUnit | None,
    package_size_id: UUID | None,
) -> StructuredMeasureResponse:
    """Build the public measure union, including historical inactive units.

    Natural display is regenerated from the referenced curated unit. Unit keys
    and labels are immutable catalog metadata; the recipe ``unit_display``
    column is only a preserved legacy/storage snapshot and integrity aid.
    """

    display, display_unit = format_measure(
        kind=kind,
        quantity_min=quantity_min,
        quantity_max=quantity_max,
        unit=unit,
    )
    if kind == "exact":
        if quantity_min is None or unit is None:
            raise ValueError("exact measure storage is incomplete")
        return ExactMeasureResponse(
            kind="exact",
            value=quantity_min,
            unit=measurement_unit_summary(unit),
            package_size_id=package_size_id,
            display_unit=display_unit,
            display=display,
        )
    if kind == "range":
        if quantity_min is None or quantity_max is None or unit is None:
            raise ValueError("range measure storage is incomplete")
        return RangeMeasureResponse(
            kind="range",
            minimum=quantity_min,
            maximum=quantity_max,
            unit=measurement_unit_summary(unit),
            package_size_id=package_size_id,
            display_unit=display_unit,
            display=display,
        )
    if package_size_id is not None:
        raise ValueError("qualitative measure storage cannot contain package-size metadata")
    return QualitativeMeasureResponse(
        kind="qualitative",
        value=cast(Literal["to_taste", "as_needed", "unspecified"], kind),
        display=display,
    )


def _fraction(value: Decimal) -> Fraction:
    return Fraction(value)


def _rule_scale(rule: MeasurementConversionRule) -> Fraction:
    return Fraction(rule.scale_numerator, rule.scale_denominator)


def _rule_offset(rule: MeasurementConversionRule) -> Fraction:
    return Fraction(rule.offset_numerator, rule.offset_denominator)


def _to_base(value: Fraction, rule: MeasurementConversionRule) -> Fraction:
    return (value + _rule_offset(rule)) * _rule_scale(rule)


def _from_base(value: Fraction, rule: MeasurementConversionRule) -> Fraction:
    return value / _rule_scale(rule) - _rule_offset(rule)


def _same_dimension_fraction(
    session: Session,
    *,
    value: Fraction,
    source: MeasurementUnit,
    target: MeasurementUnit,
) -> Fraction:
    if source.id == target.id:
        return value
    if source.dimension != target.dimension:
        raise MeasurementConversionUnsupportedError(
            f"{source.dimension} and {target.dimension} units are not directly convertible."
        )
    if source.dimension == "count":
        raise MeasurementConversionUnsupportedError(
            "Distinct count units are not interchangeable without explicit item metadata."
        )
    if source.dimension == "package":
        raise PackageSizeRequiredError(
            "Package units require an explicit reviewed ingredient package size."
        )

    source_rule = get_measurement_conversion_rule(session, source.id)
    target_rule = get_measurement_conversion_rule(session, target.id)
    if source_rule is None or target_rule is None:
        raise MeasurementConversionUnsupportedError(
            "Both units require active reviewed conversion rules."
        )
    if (
        source.conversion_family != target.conversion_family
        or source_rule.base_unit_id != target_rule.base_unit_id
    ):
        raise MeasurementConversionUnsupportedError(
            "The units do not share one reviewed conversion family and base unit."
        )

    base_unit = get_measurement_unit(session, source_rule.base_unit_id)
    if (
        base_unit is None
        or not base_unit.active
        or base_unit.dimension != source.dimension
        or base_unit.conversion_family != source.conversion_family
    ):
        raise MeasurementConversionUnsupportedError(
            "The reviewed conversion base unit is unavailable or inconsistent."
        )
    return _from_base(_to_base(value, source_rule), target_rule)


def _density_fraction(
    session: Session,
    *,
    value: Fraction,
    source: MeasurementUnit,
    target: MeasurementUnit,
    ingredient_id: UUID | None,
) -> Fraction:
    if ingredient_id is None:
        raise IngredientDensityRequiredError(
            "Mass-to-volume conversion requires a reviewed ingredient-specific density."
        )

    candidates: set[Fraction] = set()
    for density in get_active_ingredient_density_rules(session, ingredient_id):
        if density.mass_unit.dimension != "mass" or density.volume_unit.dimension != "volume":
            continue
        if not density.mass_unit.active or not density.volume_unit.active:
            continue
        try:
            if source.dimension == "mass":
                mass_value = _same_dimension_fraction(
                    session,
                    value=value,
                    source=source,
                    target=density.mass_unit,
                )
                density_value = (
                    mass_value * _fraction(density.volume_value) / _fraction(density.mass_value)
                )
                converted = _same_dimension_fraction(
                    session,
                    value=density_value,
                    source=density.volume_unit,
                    target=target,
                )
            else:
                volume_value = _same_dimension_fraction(
                    session,
                    value=value,
                    source=source,
                    target=density.volume_unit,
                )
                density_value = (
                    volume_value * _fraction(density.mass_value) / _fraction(density.volume_value)
                )
                converted = _same_dimension_fraction(
                    session,
                    value=density_value,
                    source=density.mass_unit,
                    target=target,
                )
        except MeasurementConversionUnsupportedError:
            continue
        candidates.add(converted)

    if not candidates:
        raise IngredientDensityRequiredError(
            "No active reviewed density supports this ingredient and unit pair."
        )
    if len(candidates) > 1:
        raise IngredientDensityAmbiguousError(
            "Conflicting reviewed densities support this ingredient and unit pair."
        )
    return next(iter(candidates))


def _non_package_fraction(
    session: Session,
    *,
    value: Fraction,
    source: MeasurementUnit,
    target: MeasurementUnit,
    ingredient_id: UUID | None,
) -> Fraction:
    if source.dimension == target.dimension:
        return _same_dimension_fraction(
            session,
            value=value,
            source=source,
            target=target,
        )
    if {source.dimension, target.dimension} == {"mass", "volume"}:
        return _density_fraction(
            session,
            value=value,
            source=source,
            target=target,
            ingredient_id=ingredient_id,
        )
    raise MeasurementConversionUnsupportedError(
        f"{source.dimension} and {target.dimension} units are not convertible."
    )


def _active_package_size(
    session: Session,
    package_size_id: UUID,
) -> IngredientPackageSize:
    package_size = get_ingredient_package_size(session, package_size_id)
    if package_size is None:
        raise PackageSizeNotFoundError(f"Package size {package_size_id} was not found.")
    if not package_size.active:
        raise PackageSizeInactiveError(
            f"Package size {package_size_id} is inactive and cannot be used for conversion."
        )
    if not package_size.package_unit.active or not package_size.content_unit.active:
        raise PackageSizeInactiveError("The package size references an inactive measurement unit.")
    if (
        package_size.package_unit.dimension != "package"
        or package_size.content_unit.dimension == "package"
    ):
        raise MeasurementMetadataMismatchError(
            "The package size does not define one package unit and one content unit."
        )
    return package_size


def _package_fraction(
    session: Session,
    *,
    value: Fraction,
    source: MeasurementUnit,
    target: MeasurementUnit,
    ingredient_id: UUID | None,
    package_size_id: UUID | None,
) -> Fraction:
    if package_size_id is None:
        raise PackageSizeRequiredError(
            "Package conversion requires an explicit reviewed ingredient package size."
        )
    package_size = _active_package_size(session, package_size_id)
    if ingredient_id is not None and ingredient_id != package_size.ingredient_id:
        raise MeasurementMetadataMismatchError(
            "The package size does not belong to the requested ingredient."
        )
    resolved_ingredient_id = package_size.ingredient_id
    content_value = _fraction(package_size.content_value)

    if source.dimension == "package":
        if source.id != package_size.package_unit_id or target.dimension == "package":
            raise MeasurementMetadataMismatchError(
                "The selected package size does not connect the requested package units."
            )
        unpacked = value * content_value
        return _non_package_fraction(
            session,
            value=unpacked,
            source=package_size.content_unit,
            target=target,
            ingredient_id=resolved_ingredient_id,
        )

    if target.dimension == "package":
        if target.id != package_size.package_unit_id:
            raise MeasurementMetadataMismatchError(
                "The selected package size does not describe the target package unit."
            )
        content_amount = _non_package_fraction(
            session,
            value=value,
            source=source,
            target=package_size.content_unit,
            ingredient_id=resolved_ingredient_id,
        )
        return content_amount / content_value

    raise MeasurementMetadataMismatchError(
        "Package-size metadata cannot be applied when neither unit is a package."
    )


def _quantize_conversion(value: Fraction) -> Decimal:
    with localcontext() as context:
        context.prec = 60
        try:
            converted = Decimal(value.numerator) / Decimal(value.denominator)
            quantized = converted.quantize(CONVERSION_QUANTUM, rounding=ROUND_HALF_EVEN)
        except (InvalidOperation, OverflowError) as error:
            raise MeasurementValueOutOfRangeError(
                "The converted value exceeds the supported decimal range."
            ) from error
    if quantized != 0 and quantized.copy_abs().adjusted() >= 18:
        raise MeasurementValueOutOfRangeError(
            "The converted value exceeds the supported decimal range."
        )
    if value != 0 and quantized == 0:
        raise MeasurementValueOutOfRangeError(
            "The converted value is smaller than the supported six-decimal precision."
        )
    return quantized


def convert_measurement(
    session: Session,
    payload: MeasurementConversionRequest,
) -> MeasurementConversionResponse:
    """Perform one deterministic reviewed conversion without intermediate rounding."""

    source = _require_active_unit(session, payload.from_unit_id)
    target = _require_active_unit(session, payload.target_unit_id)
    input_measure = ExactMeasureInput(
        kind="exact",
        value=payload.value,
        unit_id=source.id,
    )
    for unit in (source, target):
        try:
            validate_measure_semantics(
                input_measure,
                payload.semantic,
                cast(MeasurementDimension, unit.dimension),
            )
        except ValueError as error:
            raise MeasurementSemanticError(str(error)) from error

    source_or_target_is_package = "package" in {source.dimension, target.dimension}
    if source.id == target.id:
        if payload.package_size_id is not None:
            if source.dimension != "package":
                raise MeasurementMetadataMismatchError(
                    "Package-size metadata is valid only for package conversions."
                )
            package_size = _active_package_size(session, payload.package_size_id)
            if package_size.package_unit_id != source.id:
                raise MeasurementMetadataMismatchError(
                    "The selected package size does not describe the requested package unit."
                )
            if (
                payload.ingredient_id is not None
                and payload.ingredient_id != package_size.ingredient_id
            ):
                raise MeasurementMetadataMismatchError(
                    "The package size does not belong to the requested ingredient."
                )
        converted_fraction = _fraction(payload.value)
    elif source_or_target_is_package:
        converted_fraction = _package_fraction(
            session,
            value=_fraction(payload.value),
            source=source,
            target=target,
            ingredient_id=payload.ingredient_id,
            package_size_id=payload.package_size_id,
        )
    else:
        if payload.package_size_id is not None:
            raise MeasurementMetadataMismatchError(
                "Package-size metadata is valid only for package conversions."
            )
        converted_fraction = _non_package_fraction(
            session,
            value=_fraction(payload.value),
            source=source,
            target=target,
            ingredient_id=payload.ingredient_id,
        )

    converted = _quantize_conversion(converted_fraction)
    converted_measure = input_measure.model_copy(update={"value": converted, "unit_id": target.id})
    try:
        validate_measure_semantics(
            converted_measure,
            payload.semantic,
            cast(MeasurementDimension, target.dimension),
        )
    except ValueError as error:
        raise MeasurementSemanticError(str(error)) from error
    display, display_unit = format_measure(
        kind="exact",
        quantity_min=converted,
        quantity_max=None,
        unit=target,
    )
    return MeasurementConversionResponse(
        semantic=payload.semantic,
        source_value=payload.value,
        source_unit=measurement_unit_summary(source),
        value=converted,
        unit=measurement_unit_summary(target),
        display_unit=display_unit,
        display=display,
    )
