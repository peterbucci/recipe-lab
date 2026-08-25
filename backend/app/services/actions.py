from dataclasses import dataclass
from decimal import Decimal
from typing import cast
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import (
    ACTION_PARAMETER_DURATION,
    ACTION_PARAMETER_TEMPERATURE,
    CookingActionType,
    RecipeInstructionAction,
    RecipeInstructionActionMeasure,
)
from app.repositories.actions import get_cooking_action_types
from app.schemas.actions import (
    ActionNumericMeasureInput,
    ActionNumericMeasureResponse,
    CookingActionTypeCatalogItem,
    CookingActionTypeSummary,
    IngredientOccurrenceReference,
    RecipeInstructionActionResponse,
    StructuredActionInput,
)
from app.schemas.measurements import ExactMeasureInput, MeasurementSemantic, RangeMeasureInput
from app.services.measurements import MeasurementError, serialize_measure, validate_measure_input


class ActionContractError(ValueError):
    """Raised when an authored action cannot satisfy the reviewed contract."""


@dataclass(frozen=True, slots=True)
class ValidatedActionMeasure:
    semantic: str
    measure_mode: str
    quantity_min: Decimal
    quantity_max: Decimal | None
    measurement_unit_id: UUID
    unit_display: str


@dataclass(frozen=True, slots=True)
class ValidatedStructuredAction:
    action_type_id: UUID
    inputs: tuple[IngredientOccurrenceReference, ...]
    measures: tuple[ValidatedActionMeasure, ...]


def cooking_action_type_summary(action_type: CookingActionType) -> CookingActionTypeSummary:
    return CookingActionTypeSummary(
        id=action_type.id,
        key=action_type.key,
        canonical_verb=action_type.canonical_verb,
        active=action_type.active,
    )


def cooking_action_type_catalog_item(
    action_type: CookingActionType,
) -> CookingActionTypeCatalogItem:
    return CookingActionTypeCatalogItem(
        **cooking_action_type_summary(action_type).model_dump(),
        provenance=action_type.provenance,
    )


def _unit_display_snapshot(symbol: str | None, canonical_label: str) -> str:
    return symbol or canonical_label


def _validate_action_measure(
    session: Session,
    *,
    semantic: MeasurementSemantic,
    stored_semantic: str,
    measure: ActionNumericMeasureInput,
) -> ValidatedActionMeasure:
    try:
        unit = validate_measure_input(session, semantic=semantic, measure=measure)
    except MeasurementError as error:
        raise ActionContractError(f"{error.code}: {error}") from error
    if unit is None:
        raise RuntimeError("A validated numeric action measure has no curated unit.")

    if isinstance(measure, ExactMeasureInput):
        return ValidatedActionMeasure(
            semantic=stored_semantic,
            measure_mode="exact",
            quantity_min=measure.value,
            quantity_max=None,
            measurement_unit_id=unit.id,
            unit_display=_unit_display_snapshot(unit.symbol, unit.canonical_label),
        )
    if isinstance(measure, RangeMeasureInput):
        return ValidatedActionMeasure(
            semantic=stored_semantic,
            measure_mode="range",
            quantity_min=measure.minimum,
            quantity_max=measure.maximum,
            measurement_unit_id=unit.id,
            unit_display=_unit_display_snapshot(unit.symbol, unit.canonical_label),
        )
    raise AssertionError("Unsupported action measure input.")


def validate_structured_actions(
    session: Session,
    actions: list[StructuredActionInput],
) -> list[ValidatedStructuredAction]:
    """Resolve action types and numeric semantics without resolving recipe-local inputs."""

    action_types = get_cooking_action_types(
        session,
        {action.action_type_id for action in actions},
    )
    validated: list[ValidatedStructuredAction] = []
    for action in actions:
        action_type = action_types.get(action.action_type_id)
        if action_type is None:
            raise ActionContractError(f"Cooking action type {action.action_type_id} was not found.")
        if not action_type.active:
            raise ActionContractError(
                f"Cooking action type {action.action_type_id} is inactive and cannot be selected."
            )

        measures: list[ValidatedActionMeasure] = []
        if action.duration is not None:
            measures.append(
                _validate_action_measure(
                    session,
                    semantic="action_duration",
                    stored_semantic=ACTION_PARAMETER_DURATION,
                    measure=action.duration,
                )
            )
        if action.temperature is not None:
            measures.append(
                _validate_action_measure(
                    session,
                    semantic="temperature",
                    stored_semantic=ACTION_PARAMETER_TEMPERATURE,
                    measure=action.temperature,
                )
            )
        validated.append(
            ValidatedStructuredAction(
                action_type_id=action_type.id,
                inputs=tuple(action.ingredient_refs),
                measures=tuple(measures),
            )
        )
    return validated


def _serialized_action_measure(
    measure: RecipeInstructionActionMeasure,
) -> ActionNumericMeasureResponse:
    return cast(
        ActionNumericMeasureResponse,
        serialize_measure(
            kind=measure.measure_mode,
            quantity_min=measure.quantity_min,
            quantity_max=measure.quantity_max,
            unit=measure.measurement_unit,
            package_size_id=None,
        ),
    )


def serialize_instruction_action(
    action: RecipeInstructionAction,
) -> RecipeInstructionActionResponse:
    measures = {measure.semantic: measure for measure in action.measures}
    if len(measures) != len(action.measures):
        raise RuntimeError(f"Action {action.id} contains duplicate parameter semantics.")
    unsupported = set(measures) - {
        ACTION_PARAMETER_DURATION,
        ACTION_PARAMETER_TEMPERATURE,
    }
    if unsupported:
        raise RuntimeError(f"Action {action.id} contains unsupported parameters {unsupported}.")

    duration = measures.get(ACTION_PARAMETER_DURATION)
    temperature = measures.get(ACTION_PARAMETER_TEMPERATURE)
    return RecipeInstructionActionResponse(
        id=action.id,
        action_type=cooking_action_type_summary(action.action_type),
        display_order=action.display_order,
        ingredient_occurrence_ids=[item.recipe_ingredient_id for item in action.inputs],
        duration=_serialized_action_measure(duration) if duration is not None else None,
        temperature=(_serialized_action_measure(temperature) if temperature is not None else None),
    )
