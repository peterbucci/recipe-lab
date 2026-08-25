from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from app.models import CookingActionType, MeasurementUnit
from app.schemas.actions import StructuredActionInput
from app.schemas.measurements import ExactMeasureInput, RangeMeasureInput
from app.services.actions import ActionContractError, validate_structured_actions


def _unit(session: Session, *, key: str, dimension: str) -> MeasurementUnit:
    unit = MeasurementUnit(
        key=key,
        dimension=dimension,
        conversion_family=f"{key}-family",
        canonical_label=key,
        plural_label=f"{key}s",
        symbol=None,
        display_style="word",
        active=True,
        provenance="Reviewed action service-test unit.",
    )
    session.add(unit)
    session.flush()
    return unit


def test_action_validation_reuses_duration_and_temperature_measure_semantics(
    db_session: Session,
) -> None:
    suffix = uuid4().hex[:8]
    action_type = CookingActionType(
        key=f"service-bake-{suffix}",
        canonical_verb=f"Service bake {suffix}",
        active=True,
        provenance="Reviewed action service-test metadata.",
    )
    db_session.add(action_type)
    db_session.flush()
    minute = _unit(db_session, key=f"service-minute-{suffix}", dimension="time")
    celsius = _unit(db_session, key=f"service-celsius-{suffix}", dimension="temperature")
    action = StructuredActionInput(
        action_type_id=action_type.id,
        duration=RangeMeasureInput(
            kind="range",
            minimum=Decimal("20"),
            maximum=Decimal("25"),
            unit_id=minute.id,
        ),
        temperature=ExactMeasureInput(
            kind="exact",
            value=Decimal("-10"),
            unit_id=celsius.id,
        ),
    )

    validated = validate_structured_actions(db_session, [action])

    assert validated[0].action_type_id == action_type.id
    assert [measure.semantic for measure in validated[0].measures] == [
        "duration",
        "temperature",
    ]
    assert validated[0].measures[0].quantity_max == Decimal("25")
    assert validated[0].measures[1].quantity_min == Decimal("-10")


def test_action_validation_rejects_inactive_types_and_wrong_unit_dimensions(
    db_session: Session,
) -> None:
    suffix = uuid4().hex[:8]
    inactive = CookingActionType(
        key=f"service-inactive-{suffix}",
        canonical_verb=f"Service inactive {suffix}",
        active=False,
        provenance="Retired action service-test metadata.",
    )
    active = CookingActionType(
        key=f"service-active-{suffix}",
        canonical_verb=f"Service active {suffix}",
        active=True,
        provenance="Reviewed action service-test metadata.",
    )
    db_session.add_all([inactive, active])
    db_session.flush()
    mass = _unit(db_session, key=f"service-gram-{suffix}", dimension="mass")

    with pytest.raises(ActionContractError, match="inactive"):
        validate_structured_actions(
            db_session,
            [StructuredActionInput(action_type_id=inactive.id)],
        )
    with pytest.raises(ActionContractError, match="measurement_semantic_mismatch"):
        validate_structured_actions(
            db_session,
            [
                StructuredActionInput(
                    action_type_id=active.id,
                    duration=ExactMeasureInput(
                        kind="exact",
                        value=Decimal("1"),
                        unit_id=mass.id,
                    ),
                )
            ],
        )
