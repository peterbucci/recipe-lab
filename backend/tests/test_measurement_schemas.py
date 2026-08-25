from decimal import Decimal
from uuid import uuid4

import pytest
from pydantic import TypeAdapter, ValidationError

from app.schemas.measurements import (
    ExactMeasureInput,
    QualitativeMeasureInput,
    RangeMeasureInput,
    StructuredMeasureInput,
    validate_measure_semantics,
)

MEASURE_ADAPTER: TypeAdapter[StructuredMeasureInput] = TypeAdapter(StructuredMeasureInput)


def test_measure_inputs_are_discriminated_and_preserve_decimal_values() -> None:
    unit_id = uuid4()

    exact = MEASURE_ADAPTER.validate_python(
        {"kind": "exact", "value": "1.250000", "unit_id": str(unit_id)}
    )
    ranged = MEASURE_ADAPTER.validate_python(
        {
            "kind": "range",
            "minimum": "2.5",
            "maximum": "3.75",
            "unit_id": str(unit_id),
        }
    )
    qualitative = MEASURE_ADAPTER.validate_python({"kind": "qualitative", "value": "to_taste"})

    assert isinstance(exact, ExactMeasureInput)
    assert exact.value == Decimal("1.250000")
    assert exact.unit_id == unit_id
    assert isinstance(ranged, RangeMeasureInput)
    assert (ranged.minimum, ranged.maximum) == (Decimal("2.5"), Decimal("3.75"))
    assert isinstance(qualitative, QualitativeMeasureInput)
    assert qualitative.value == "to_taste"


@pytest.mark.parametrize(
    "payload",
    [
        {"kind": "exact", "value": True, "unit_id": str(uuid4())},
        {"kind": "exact", "value": "NaN", "unit_id": str(uuid4())},
        {"kind": "exact", "value": "Infinity", "unit_id": str(uuid4())},
        {"kind": "exact", "value": "1.0000001", "unit_id": str(uuid4())},
        {"kind": "exact", "value": "1234567890123.000000", "unit_id": str(uuid4())},
        {
            "kind": "range",
            "minimum": "2",
            "maximum": "2",
            "unit_id": str(uuid4()),
        },
        {
            "kind": "range",
            "minimum": "3",
            "maximum": "2",
            "unit_id": str(uuid4()),
        },
        {"kind": "qualitative", "value": "pinch", "unit_id": str(uuid4())},
    ],
)
def test_measure_inputs_reject_ambiguous_or_unrepresentable_values(
    payload: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        MEASURE_ADAPTER.validate_python(payload)


def test_semantic_validation_keeps_signed_temperature_separate_from_positive_contexts() -> None:
    unit_id = uuid4()
    below_freezing = ExactMeasureInput(kind="exact", value=Decimal("-40"), unit_id=unit_id)
    positive = ExactMeasureInput(kind="exact", value=Decimal("5"), unit_id=unit_id)
    zero = ExactMeasureInput(kind="exact", value=Decimal("0"), unit_id=unit_id)
    qualitative = QualitativeMeasureInput(kind="qualitative", value="as_needed")

    validate_measure_semantics(below_freezing, "temperature", "temperature")
    validate_measure_semantics(positive, "action_duration", "time")
    validate_measure_semantics(qualitative, "ingredient_amount", None)

    with pytest.raises(ValueError, match="greater than zero"):
        validate_measure_semantics(zero, "ingredient_amount", "mass")
    with pytest.raises(ValueError, match="cannot measure"):
        validate_measure_semantics(positive, "action_duration", "temperature")
    with pytest.raises(ValueError, match="only for ingredient"):
        validate_measure_semantics(qualitative, "temperature", None)
