from decimal import Decimal, InvalidOperation
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    model_validator,
)

type MeasurementDimension = Literal[
    "mass",
    "volume",
    "count",
    "time",
    "temperature",
    "package",
]
type MeasurementDisplayStyle = Literal["symbol", "word", "hidden"]
type MeasurementSemantic = Literal[
    "ingredient_amount",
    "action_duration",
    "temperature",
]
type QualitativeMeasureValue = Literal["to_taste", "as_needed", "unspecified"]

SEMANTIC_DIMENSIONS: dict[MeasurementSemantic, frozenset[MeasurementDimension]] = {
    "ingredient_amount": frozenset({"mass", "volume", "count", "package"}),
    "action_duration": frozenset({"time"}),
    "temperature": frozenset({"temperature"}),
}


def _finite_decimal(value: object) -> object:
    if isinstance(value, bool):
        raise ValueError("boolean values are not valid measurement amounts")
    try:
        parsed = value if isinstance(value, Decimal) else Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as error:
        raise ValueError("measurement amounts must be decimal numbers") from error
    if not parsed.is_finite():
        raise ValueError("measurement amounts must be finite")
    _sign, digits, exponent = parsed.as_tuple()
    if not isinstance(exponent, int):
        raise ValueError("measurement amounts must have a finite decimal exponent")
    decimal_places = max(-exponent, 0)
    integer_digits = max(len(digits) + exponent, 0)
    if decimal_places > 6:
        raise ValueError("measurement amounts may contain at most six decimal places")
    if integer_digits > 12:
        raise ValueError("measurement amounts may contain at most twelve integer digits")
    return parsed


MeasurementDecimal = Annotated[
    Decimal,
    BeforeValidator(_finite_decimal),
    Field(max_digits=18, decimal_places=6),
]
ConvertedMeasurementDecimal = Annotated[
    Decimal,
    Field(max_digits=24, decimal_places=6),
]


class MeasurementInputSchema(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ExactMeasureInput(MeasurementInputSchema):
    kind: Literal["exact"]
    value: MeasurementDecimal
    unit_id: UUID
    package_size_id: UUID | None = None


class RangeMeasureInput(MeasurementInputSchema):
    kind: Literal["range"]
    minimum: MeasurementDecimal
    maximum: MeasurementDecimal
    unit_id: UUID
    package_size_id: UUID | None = None

    @model_validator(mode="after")
    def ordered_range(self) -> "RangeMeasureInput":
        if self.minimum >= self.maximum:
            raise ValueError("measurement range minimum must be less than maximum")
        return self


class QualitativeMeasureInput(MeasurementInputSchema):
    kind: Literal["qualitative"]
    value: QualitativeMeasureValue


StructuredMeasureInput = Annotated[
    ExactMeasureInput | RangeMeasureInput | QualitativeMeasureInput,
    Field(discriminator="kind"),
]


def validate_measure_semantics(
    measure: ExactMeasureInput | RangeMeasureInput | QualitativeMeasureInput,
    semantic: MeasurementSemantic,
    unit_dimension: MeasurementDimension | None,
) -> None:
    """Apply context rules independently of persistence or catalog lookup."""

    if isinstance(measure, QualitativeMeasureInput):
        if semantic != "ingredient_amount":
            raise ValueError("qualitative measures are supported only for ingredient amounts")
        if unit_dimension is not None:
            raise ValueError("qualitative measures cannot have a measurement unit")
        return

    if unit_dimension is None or unit_dimension not in SEMANTIC_DIMENSIONS[semantic]:
        raise ValueError(f"a {unit_dimension or 'missing'} unit cannot measure {semantic}")

    if semantic in {"ingredient_amount", "action_duration"}:
        values = (
            (measure.value,)
            if isinstance(measure, ExactMeasureInput)
            else (measure.minimum, measure.maximum)
        )
        if any(value <= 0 for value in values):
            raise ValueError(f"{semantic} numeric values must be greater than zero")


class MeasurementResponseSchema(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class MeasurementUnitSummary(MeasurementResponseSchema):
    id: UUID
    key: str = Field(min_length=1, max_length=64)
    dimension: MeasurementDimension
    canonical_label: str = Field(min_length=1, max_length=64)
    plural_label: str = Field(min_length=1, max_length=64)
    symbol: str | None = Field(default=None, min_length=1, max_length=16)
    display_style: MeasurementDisplayStyle
    active: bool


class MeasurementUnitCatalogItem(MeasurementUnitSummary):
    aliases: list[str] = Field(default_factory=list)
    provenance: str = Field(min_length=1)


class MeasurementUnitCatalogPage(MeasurementResponseSchema):
    items: list[MeasurementUnitCatalogItem]


class ExactMeasureResponse(MeasurementResponseSchema):
    kind: Literal["exact"]
    value: MeasurementDecimal
    unit: MeasurementUnitSummary
    package_size_id: UUID | None
    display_unit: str | None
    display: str = Field(min_length=1)


class RangeMeasureResponse(MeasurementResponseSchema):
    kind: Literal["range"]
    minimum: MeasurementDecimal
    maximum: MeasurementDecimal
    unit: MeasurementUnitSummary
    package_size_id: UUID | None
    display_unit: str | None
    display: str = Field(min_length=1)


class QualitativeMeasureResponse(MeasurementResponseSchema):
    kind: Literal["qualitative"]
    value: QualitativeMeasureValue
    unit: None = None
    display_unit: None = None
    display: str = Field(min_length=1)


StructuredMeasureResponse = Annotated[
    ExactMeasureResponse | RangeMeasureResponse | QualitativeMeasureResponse,
    Field(discriminator="kind"),
]


class MeasurementConversionRequest(MeasurementInputSchema):
    semantic: MeasurementSemantic
    value: MeasurementDecimal
    from_unit_id: UUID
    target_unit_id: UUID
    ingredient_id: UUID | None = None
    package_size_id: UUID | None = None


class MeasurementConversionResponse(MeasurementResponseSchema):
    semantic: MeasurementSemantic
    source_value: MeasurementDecimal
    source_unit: MeasurementUnitSummary
    value: ConvertedMeasurementDecimal
    unit: MeasurementUnitSummary
    display_unit: str | None
    display: str = Field(min_length=1)


# Short aliases make the catalog contracts convenient for clients without
# creating a second, drifting schema definition.
CatalogUnit = MeasurementUnitCatalogItem
UnitSummary = MeasurementUnitSummary
