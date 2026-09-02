import hashlib
import json
from dataclasses import dataclass
from decimal import Decimal
from typing import Literal, cast
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import (
    RECIPE_DRAFT_STATUS_DISCARDED,
    MeasurementUnit,
    RecipeCategory,
    RecipeDraft,
    RecipeDraftCategory,
    RecipeDraftIngredient,
    RecipeDraftInstruction,
    RecipeDraftInstructionAction,
    RecipeDraftInstructionActionInput,
    RecipeDraftInstructionActionMeasure,
)
from app.repositories.catalog_requests import get_catalog_request
from app.repositories.ingredients import curated_display_label, get_ingredient
from app.repositories.recipe_categories import resolve_active_recipe_categories
from app.repositories.recipe_drafts import (
    get_owned_recipe_draft,
    get_owned_recipe_draft_by_creation_action,
    get_public_recipe_snapshot_for_draft,
    insert_recipe_draft_shell,
)
from app.schemas.actions import (
    ActionNumericMeasureResponse,
    AddedIngredientOccurrenceReference,
    StructuredActionInput,
)
from app.schemas.ingredient_catalog import CatalogRequestStatus, IngredientCatalogItem
from app.schemas.measurements import (
    ExactMeasureInput,
    QualitativeMeasureInput,
    RangeMeasureInput,
    StructuredMeasureInput,
)
from app.schemas.recipe_categories import RecipeCategorySummary
from app.schemas.recipe_drafts import (
    RecipeDraftActionInput,
    RecipeDraftActionResponse,
    RecipeDraftCatalogSelectionInput,
    RecipeDraftCatalogSelectionResponse,
    RecipeDraftDetailResponse,
    RecipeDraftIngredientInput,
    RecipeDraftIngredientRequestState,
    RecipeDraftIngredientResponse,
    RecipeDraftIngredientSelectionResponse,
    RecipeDraftInstructionResponse,
    RecipeDraftRequestSelectionInput,
    RecipeDraftRequestSelectionResponse,
    RecipeDraftUpdateRequest,
)
from app.services.actions import (
    ActionContractError,
    ValidatedActionMeasure,
    cooking_action_type_summary,
    validate_structured_actions,
)
from app.services.measurements import MeasurementError, serialize_measure, validate_measure_input


class InvalidRecipeDraftError(ValueError):
    """Raised when submitted private authoring state violates the curated contract."""


class RecipeDraftRevisionConflictError(ValueError):
    """Raised when a stale editor attempts to replace or discard a newer revision."""


class RecipeDraftCreationIdempotencyConflictError(RuntimeError):
    """Raised when one creation action cannot safely resolve to an active draft."""


RECIPE_DRAFT_CREATION_FINGERPRINT_SCHEMA = "recipe-draft-creation"
RECIPE_DRAFT_CREATION_FINGERPRINT_VERSION = 1


@dataclass(frozen=True, slots=True)
class _MeasureFields:
    mode: str
    quantity_min: Decimal | None
    quantity_max: Decimal | None
    measurement_unit_id: UUID | None
    unit_display: str | None
    package_size_id: UUID | None


@dataclass(frozen=True, slots=True)
class _ValidatedIngredient:
    ref: str
    selection_kind: str
    ingredient_id: UUID | None
    ingredient_request_id: UUID | None
    name: str | None
    measure: _MeasureFields
    preparation_notes: str | None


@dataclass(frozen=True, slots=True)
class _ValidatedAction:
    action_type_id: UUID
    ingredient_refs: tuple[str, ...]
    measures: tuple[ValidatedActionMeasure, ...]


@dataclass(frozen=True, slots=True)
class _ValidatedInstruction:
    title: str | None
    text: str
    actions: tuple[_ValidatedAction, ...]


def _invalid(message: str) -> InvalidRecipeDraftError:
    return InvalidRecipeDraftError(message)


def _unit_display(symbol: str | None, canonical_label: str) -> str:
    return symbol or canonical_label


def _current_unit_display(unit: MeasurementUnit | None) -> str | None:
    """Use current curated labels when an immutable source becomes an editable draft."""

    if unit is None:
        return None
    return _unit_display(unit.symbol, unit.canonical_label)


def _measure_fields(
    session: Session,
    *,
    measure: StructuredMeasureInput,
    ingredient_id: UUID | None,
) -> _MeasureFields:
    try:
        unit = validate_measure_input(
            session,
            semantic="ingredient_amount",
            measure=measure,
            ingredient_id=ingredient_id,
        )
    except MeasurementError as error:
        raise _invalid(f"{error.code}: {error}") from error

    if isinstance(measure, ExactMeasureInput):
        if unit is None:
            raise RuntimeError("A validated exact draft measure has no curated unit.")
        return _MeasureFields(
            mode="exact",
            quantity_min=measure.value,
            quantity_max=None,
            measurement_unit_id=unit.id,
            unit_display=_unit_display(unit.symbol, unit.canonical_label),
            package_size_id=measure.package_size_id,
        )
    if isinstance(measure, RangeMeasureInput):
        if unit is None:
            raise RuntimeError("A validated range draft measure has no curated unit.")
        return _MeasureFields(
            mode="range",
            quantity_min=measure.minimum,
            quantity_max=measure.maximum,
            measurement_unit_id=unit.id,
            unit_display=_unit_display(unit.symbol, unit.canonical_label),
            package_size_id=measure.package_size_id,
        )
    if isinstance(measure, QualitativeMeasureInput):
        return _MeasureFields(
            mode=measure.value,
            quantity_min=None,
            quantity_max=None,
            measurement_unit_id=None,
            unit_display=None,
            package_size_id=None,
        )
    raise AssertionError("Unsupported structured draft measure.")


def _validate_ingredient(
    session: Session,
    *,
    author_user_id: UUID,
    item: RecipeDraftIngredientInput,
) -> _ValidatedIngredient:
    selection = item.selection
    if isinstance(selection, RecipeDraftCatalogSelectionInput):
        ingredient = get_ingredient(session, selection.ingredient_id)
        if ingredient is None:
            raise _invalid("The selected ingredient is not available in the curated catalog.")
        display_name = curated_display_label(ingredient, selection.display_name)
        if display_name is None:
            raise _invalid("The selected ingredient label does not belong to its curated identity.")
        ingredient_id: UUID | None = ingredient.id
        ingredient_request_id: UUID | None = None
        selection_kind = "catalog"
        name: str | None = display_name
    elif isinstance(selection, RecipeDraftRequestSelectionInput):
        request = get_catalog_request(session, selection.ingredient_request_id)
        if request is None or request.requester_user_id != author_user_id:
            raise _invalid("The selected ingredient request is not available for this draft.")
        ingredient_id = None
        ingredient_request_id = request.id
        selection_kind = "request"
        name = None
    else:
        raise AssertionError("Unsupported draft ingredient selection.")

    return _ValidatedIngredient(
        ref=item.ref,
        selection_kind=selection_kind,
        ingredient_id=ingredient_id,
        ingredient_request_id=ingredient_request_id,
        name=name,
        measure=_measure_fields(
            session,
            measure=item.measure,
            ingredient_id=ingredient_id,
        ),
        preparation_notes=item.preparation_notes,
    )


def _validate_action(
    session: Session,
    *,
    item: RecipeDraftActionInput,
) -> _ValidatedAction:
    translated = StructuredActionInput(
        action_type_id=item.action_type_id,
        ingredient_refs=[
            AddedIngredientOccurrenceReference(
                kind="added",
                ingredient_edit_ref=ingredient_ref,
            )
            for ingredient_ref in item.ingredient_refs
        ],
        duration=item.duration,
        temperature=item.temperature,
    )
    try:
        validated = validate_structured_actions(session, [translated])[0]
    except ActionContractError as error:
        raise _invalid(str(error)) from error
    return _ValidatedAction(
        action_type_id=validated.action_type_id,
        ingredient_refs=tuple(item.ingredient_refs),
        measures=validated.measures,
    )


def _validate_document(
    session: Session,
    *,
    author_user_id: UUID,
    payload: RecipeDraftUpdateRequest,
) -> tuple[list[_ValidatedIngredient], list[_ValidatedInstruction]]:
    ingredients = [
        _validate_ingredient(session, author_user_id=author_user_id, item=item)
        for item in payload.ingredients
    ]
    ingredients_by_ref = {ingredient.ref: ingredient for ingredient in ingredients}

    instructions: list[_ValidatedInstruction] = []
    for item in payload.instructions:
        actions: list[_ValidatedAction] = []
        for action in item.actions:
            unresolved = [
                ingredient_ref
                for ingredient_ref in action.ingredient_refs
                if ingredients_by_ref[ingredient_ref].selection_kind != "catalog"
            ]
            if unresolved:
                raise _invalid(
                    "Structured actions may reference only catalog-backed ingredient "
                    f"slots; unresolved refs={unresolved!r}."
                )
            actions.append(_validate_action(session, item=action))
        instructions.append(
            _ValidatedInstruction(
                title=item.title,
                text=item.text,
                actions=tuple(actions),
            )
        )
    return ingredients, instructions


def _insert_validated_document(
    session: Session,
    *,
    draft: RecipeDraft,
    categories: list[RecipeCategory],
    ingredients: list[_ValidatedIngredient],
    instructions: list[_ValidatedInstruction],
) -> None:
    session.add_all(
        [
            RecipeDraftCategory(
                recipe_draft_id=draft.id,
                recipe_category_id=category.id,
                display_order=display_order,
            )
            for display_order, category in enumerate(categories)
        ]
    )

    ingredient_rows = [
        RecipeDraftIngredient(
            recipe_draft_id=draft.id,
            selection_kind=item.selection_kind,
            ingredient_id=item.ingredient_id,
            ingredient_request_id=item.ingredient_request_id,
            name=item.name,
            measure_mode=item.measure.mode,
            quantity_min=item.measure.quantity_min,
            quantity_max=item.measure.quantity_max,
            measurement_unit_id=item.measure.measurement_unit_id,
            unit_display=item.measure.unit_display,
            package_size_id=item.measure.package_size_id,
            preparation_notes=item.preparation_notes,
            display_order=display_order,
        )
        for display_order, item in enumerate(ingredients)
    ]
    session.add_all(ingredient_rows)
    session.flush()
    ingredient_ids = {
        item.ref: row.id for item, row in zip(ingredients, ingredient_rows, strict=True)
    }

    instruction_rows = [
        RecipeDraftInstruction(
            recipe_draft_id=draft.id,
            title=item.title,
            instruction=item.text,
            display_order=display_order,
        )
        for display_order, item in enumerate(instructions)
    ]
    session.add_all(instruction_rows)
    session.flush()

    for instruction, instruction_row in zip(instructions, instruction_rows, strict=True):
        action_rows = [
            RecipeDraftInstructionAction(
                recipe_draft_id=draft.id,
                recipe_draft_instruction_id=instruction_row.id,
                action_type_id=action.action_type_id,
                display_order=display_order,
            )
            for display_order, action in enumerate(instruction.actions)
        ]
        session.add_all(action_rows)
        session.flush()
        for action, action_row in zip(instruction.actions, action_rows, strict=True):
            session.add_all(
                [
                    RecipeDraftInstructionActionInput(
                        recipe_draft_id=draft.id,
                        recipe_draft_instruction_action_id=action_row.id,
                        recipe_draft_ingredient_id=ingredient_ids[ingredient_ref],
                        display_order=display_order,
                    )
                    for display_order, ingredient_ref in enumerate(action.ingredient_refs)
                ]
            )
            session.add_all(
                [
                    RecipeDraftInstructionActionMeasure(
                        recipe_draft_instruction_action_id=action_row.id,
                        semantic=measure.semantic,
                        measure_mode=measure.measure_mode,
                        quantity_min=measure.quantity_min,
                        quantity_max=measure.quantity_max,
                        measurement_unit_id=measure.measurement_unit_id,
                        unit_display=measure.unit_display,
                    )
                    for measure in action.measures
                ]
            )
    session.flush()


def create_recipe_draft(
    session: Session,
    *,
    author_user_id: UUID,
    creation_action_id: UUID,
    source_version_id: UUID | None,
) -> RecipeDraft | None:
    """Create or recover one blank/or-source draft for a member-scoped action."""

    request_fingerprint = recipe_draft_creation_request_fingerprint(source_version_id)
    existing = get_owned_recipe_draft_by_creation_action(
        session,
        author_user_id=author_user_id,
        creation_action_id=creation_action_id,
    )
    if existing is not None:
        return _resolve_recipe_draft_creation_replay(
            existing,
            request_fingerprint=request_fingerprint,
        )

    source = None
    if source_version_id is not None:
        source = get_public_recipe_snapshot_for_draft(session, source_version_id)
        if source is None:
            return None

    inserted_id = insert_recipe_draft_shell(
        session,
        author_user_id=author_user_id,
        creation_action_id=creation_action_id,
        creation_request_fingerprint=request_fingerprint,
        source_version_id=source.id if source is not None else None,
        title=source.title if source is not None else "",
        description=source.description if source is not None else None,
        servings=source.servings if source is not None else None,
        total_time_minutes=source.total_time_minutes if source is not None else None,
        active_time_minutes=source.active_time_minutes if source is not None else None,
        difficulty=source.difficulty if source is not None else None,
        notes=source.notes if source is not None else None,
    )
    if inserted_id is None:
        concurrent = get_owned_recipe_draft_by_creation_action(
            session,
            author_user_id=author_user_id,
            creation_action_id=creation_action_id,
        )
        if concurrent is None:
            raise RuntimeError("The draft creation idempotency conflict could not be resolved.")
        return _resolve_recipe_draft_creation_replay(
            concurrent,
            request_fingerprint=request_fingerprint,
        )

    draft = get_owned_recipe_draft(
        session,
        author_user_id=author_user_id,
        draft_id=inserted_id,
    )
    if draft is None:
        raise RuntimeError("The newly inserted private draft shell could not be reloaded.")
    if source is None:
        return draft

    session.add_all(
        [
            RecipeDraftCategory(
                recipe_draft_id=draft.id,
                recipe_category_id=item.recipe_category_id,
                display_order=item.display_order,
            )
            for item in source.categories
        ]
    )

    ingredient_rows = [
        RecipeDraftIngredient(
            recipe_draft_id=draft.id,
            selection_kind="catalog",
            ingredient_id=item.ingredient_id,
            ingredient_request_id=None,
            name=item.name,
            measure_mode=item.measure_mode,
            quantity_min=item.quantity_min,
            quantity_max=item.quantity_max,
            measurement_unit_id=item.measurement_unit_id,
            unit_display=_current_unit_display(item.measurement_unit),
            package_size_id=item.package_size_id,
            preparation_notes=item.preparation_notes,
            display_order=item.display_order,
        )
        for item in source.ingredients
    ]
    session.add_all(ingredient_rows)
    session.flush()
    ingredient_ids = {
        source_item.id: draft_item.id
        for source_item, draft_item in zip(source.ingredients, ingredient_rows, strict=True)
    }

    instruction_rows = [
        RecipeDraftInstruction(
            recipe_draft_id=draft.id,
            title=item.title,
            instruction=item.instruction,
            display_order=item.display_order,
        )
        for item in source.instructions
    ]
    session.add_all(instruction_rows)
    session.flush()
    for source_instruction, draft_instruction in zip(
        source.instructions,
        instruction_rows,
        strict=True,
    ):
        action_rows = [
            RecipeDraftInstructionAction(
                recipe_draft_id=draft.id,
                recipe_draft_instruction_id=draft_instruction.id,
                action_type_id=action.action_type_id,
                display_order=action.display_order,
            )
            for action in source_instruction.actions
        ]
        session.add_all(action_rows)
        session.flush()
        for source_action, draft_action in zip(
            source_instruction.actions,
            action_rows,
            strict=True,
        ):
            session.add_all(
                [
                    RecipeDraftInstructionActionInput(
                        recipe_draft_id=draft.id,
                        recipe_draft_instruction_action_id=draft_action.id,
                        recipe_draft_ingredient_id=ingredient_ids[
                            source_input.recipe_ingredient_id
                        ],
                        display_order=source_input.display_order,
                    )
                    for source_input in source_action.inputs
                ]
            )
            session.add_all(
                [
                    RecipeDraftInstructionActionMeasure(
                        recipe_draft_instruction_action_id=draft_action.id,
                        semantic=measure.semantic,
                        measure_mode=measure.measure_mode,
                        quantity_min=measure.quantity_min,
                        quantity_max=measure.quantity_max,
                        measurement_unit_id=measure.measurement_unit_id,
                        unit_display=_current_unit_display(measure.measurement_unit),
                    )
                    for measure in source_action.measures
                ]
            )
    session.flush()
    return draft


def recipe_draft_creation_request_fingerprint(source_version_id: UUID | None) -> str:
    """Hash one versioned canonical blank-or-source creation intent."""

    document = {
        "intent": "blank" if source_version_id is None else "source",
        "schema": RECIPE_DRAFT_CREATION_FINGERPRINT_SCHEMA,
        "source_version_id": str(source_version_id) if source_version_id is not None else None,
        "version": RECIPE_DRAFT_CREATION_FINGERPRINT_VERSION,
    }
    canonical = json.dumps(document, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _resolve_recipe_draft_creation_replay(
    draft: RecipeDraft,
    *,
    request_fingerprint: str,
) -> RecipeDraft:
    if draft.creation_request_fingerprint != request_fingerprint:
        raise RecipeDraftCreationIdempotencyConflictError(
            "The draft creation action is already bound to another request."
        )
    if draft.status != "active":
        raise RecipeDraftCreationIdempotencyConflictError(
            "The draft creation action is already bound to a completed draft."
        )
    return draft


def replace_recipe_draft(
    session: Session,
    *,
    author_user_id: UUID,
    draft_id: UUID,
    payload: RecipeDraftUpdateRequest,
) -> RecipeDraft | None:
    draft = get_owned_recipe_draft(
        session,
        author_user_id=author_user_id,
        draft_id=draft_id,
        for_update=True,
    )
    if draft is None:
        return None
    if draft.revision != payload.revision:
        raise RecipeDraftRevisionConflictError("The draft has a newer saved revision.")

    ingredients, instructions = _validate_document(
        session,
        author_user_id=author_user_id,
        payload=payload,
    )
    categories = resolve_active_recipe_categories(session, payload.category_ids)
    if categories is None:
        raise _invalid("Select only active curated recipe categories.")

    draft.categories.clear()
    session.flush()
    draft.instructions.clear()
    session.flush()
    draft.ingredients.clear()
    session.flush()
    draft.title = payload.title
    draft.description = payload.description
    draft.servings = payload.servings
    draft.total_time_minutes = payload.total_time_minutes
    draft.active_time_minutes = payload.active_time_minutes
    draft.difficulty = payload.difficulty
    draft.notes = payload.notes
    draft.revision += 1
    _insert_validated_document(
        session,
        draft=draft,
        categories=list(categories),
        ingredients=ingredients,
        instructions=instructions,
    )
    session.flush()
    return draft


def discard_recipe_draft(
    session: Session,
    *,
    author_user_id: UUID,
    draft_id: UUID,
    expected_revision: int,
) -> bool:
    draft = get_owned_recipe_draft(
        session,
        author_user_id=author_user_id,
        draft_id=draft_id,
        for_update=True,
    )
    if draft is None:
        return False
    if draft.revision != expected_revision:
        raise RecipeDraftRevisionConflictError("The draft has a newer saved revision.")
    draft.instructions.clear()
    session.flush()
    draft.ingredients.clear()
    session.flush()
    draft.categories.clear()
    session.flush()
    draft.title = ""
    draft.description = None
    draft.servings = None
    draft.total_time_minutes = None
    draft.active_time_minutes = None
    draft.difficulty = None
    draft.notes = None
    draft.status = RECIPE_DRAFT_STATUS_DISCARDED
    session.flush()
    return True


def _catalog_item(ingredient: object) -> IngredientCatalogItem:
    from app.models import Ingredient

    if not isinstance(ingredient, Ingredient):
        raise RuntimeError("A draft catalog selection is missing its ingredient relationship.")
    return IngredientCatalogItem(
        id=ingredient.id,
        canonical_name=ingredient.canonical_name,
        aliases=sorted(
            (alias.alias for alias in ingredient.aliases),
            key=lambda value: (value.casefold(), value),
        ),
    )


def _ingredient_response(item: RecipeDraftIngredient) -> RecipeDraftIngredientResponse:
    selection: RecipeDraftIngredientSelectionResponse
    if item.selection_kind == "catalog":
        if item.ingredient is None or item.name is None:
            raise RuntimeError("A catalog-backed draft slot is incomplete.")
        selection = RecipeDraftCatalogSelectionResponse(
            ingredient=_catalog_item(item.ingredient),
            display_name=item.name,
        )
    elif item.selection_kind == "request":
        request = item.ingredient_request
        if request is None:
            raise RuntimeError("An unresolved draft slot is missing its request.")
        resolved = (
            _catalog_item(request.resolved_ingredient)
            if request.resolved_ingredient is not None
            else None
        )
        selection = RecipeDraftRequestSelectionResponse(
            request=RecipeDraftIngredientRequestState(
                id=request.id,
                proposed_name=request.proposed_name,
                status=cast(CatalogRequestStatus, request.status),
                resolved_ingredient=resolved,
            )
        )
    else:
        raise RuntimeError(f"Unsupported draft ingredient selection {item.selection_kind!r}.")
    return RecipeDraftIngredientResponse(
        id=item.id,
        selection=selection,
        measure=serialize_measure(
            kind=item.measure_mode,
            quantity_min=item.quantity_min,
            quantity_max=item.quantity_max,
            unit=item.measurement_unit,
            package_size_id=item.package_size_id,
        ),
        preparation_notes=item.preparation_notes,
        display_order=item.display_order,
    )


def _action_measure_response(
    measure: RecipeDraftInstructionActionMeasure,
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


def _action_response(item: RecipeDraftInstructionAction) -> RecipeDraftActionResponse:
    measures = {measure.semantic: measure for measure in item.measures}
    if len(measures) != len(item.measures):
        raise RuntimeError(f"Draft action {item.id} has duplicate measure semantics.")
    duration = measures.get("duration")
    temperature = measures.get("temperature")
    return RecipeDraftActionResponse(
        id=item.id,
        action_type=cooking_action_type_summary(item.action_type),
        ingredient_occurrence_ids=[
            input_item.recipe_draft_ingredient_id for input_item in item.inputs
        ],
        duration=_action_measure_response(duration) if duration is not None else None,
        temperature=(_action_measure_response(temperature) if temperature is not None else None),
        display_order=item.display_order,
    )


def recipe_draft_detail_response(draft: RecipeDraft) -> RecipeDraftDetailResponse:
    return RecipeDraftDetailResponse(
        id=draft.id,
        source_version_id=draft.source_version_id,
        status=cast(Literal["active"], draft.status),
        revision=draft.revision,
        title=draft.title,
        description=draft.description,
        servings=draft.servings,
        total_time_minutes=draft.total_time_minutes,
        active_time_minutes=draft.active_time_minutes,
        difficulty=cast(Literal["easy", "medium", "hard"] | None, draft.difficulty),
        notes=draft.notes,
        categories=[
            RecipeCategorySummary(
                id=item.category.id,
                name=item.category.name,
                slug=item.category.slug,
            )
            for item in draft.categories
        ],
        ingredients=[_ingredient_response(item) for item in draft.ingredients],
        instructions=[
            RecipeDraftInstructionResponse(
                id=item.id,
                title=item.title,
                text=item.instruction,
                actions=[_action_response(action) for action in item.actions],
                display_order=item.display_order,
            )
            for item in draft.instructions
        ],
        created_at=draft.created_at,
        updated_at=draft.updated_at,
    )
