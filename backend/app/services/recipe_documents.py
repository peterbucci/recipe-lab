"""Typed recipe documents and transaction-neutral ORM materializers.

The document graph is the boundary between loaded or validated recipe content
and its mutable-draft or immutable-version storage shape. Materializers allocate
all local UUIDs up front and stage rows without flushing or committing; the
calling application service remains the transaction owner.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Literal, cast
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.models import (
    RECIPE_DRAFT_SELECTION_CATALOG,
    RECIPE_DRAFT_SELECTION_REQUEST,
    MeasurementUnit,
    RecipeDraft,
    RecipeDraftCategory,
    RecipeDraftIngredient,
    RecipeDraftInstruction,
    RecipeDraftInstructionAction,
    RecipeDraftInstructionActionInput,
    RecipeDraftInstructionActionMeasure,
    RecipeIngredient,
    RecipeInstruction,
    RecipeInstructionAction,
    RecipeInstructionActionInput,
    RecipeInstructionActionMeasure,
    RecipeVersion,
    RecipeVersionCategory,
)
from app.services.measurements import measurement_unit_snapshot_label
from app.services.recipe_fingerprint_persistence import canonical_unit_from_measurement
from app.services.recipe_fingerprints import (
    CanonicalUnit,
    RecipeStructure,
    StructuralAction,
    StructuralIngredient,
    StructuralInstruction,
    StructuralMeasure,
)

type RecipeDocumentSelectionKind = Literal["catalog", "request"]


class RecipeDocumentMaterializationError(RuntimeError):
    """Raised when an internally constructed document graph is inconsistent."""


@dataclass(frozen=True, slots=True)
class RecipeDocumentIngredientMeasure:
    mode: str
    quantity_min: Decimal | None
    quantity_max: Decimal | None
    measurement_unit_id: UUID | None
    unit_display: str | None
    package_size_id: UUID | None
    canonical_unit: CanonicalUnit | None = None


@dataclass(frozen=True, slots=True)
class RecipeDocumentActionMeasure:
    semantic: str
    mode: str
    quantity_min: Decimal
    quantity_max: Decimal | None
    measurement_unit_id: UUID
    unit_display: str
    canonical_unit: CanonicalUnit | None = None


@dataclass(frozen=True, slots=True)
class RecipeDocumentCategory:
    category_id: UUID
    name: str
    slug: str
    display_order: int


@dataclass(frozen=True, slots=True)
class RecipeDocumentIngredient:
    ref: str
    selection_kind: RecipeDocumentSelectionKind
    ingredient_id: UUID | None
    ingredient_request_id: UUID | None
    name: str | None
    measure: RecipeDocumentIngredientMeasure
    preparation_notes: str | None
    display_order: int


@dataclass(frozen=True, slots=True)
class RecipeDocumentActionInput:
    ingredient_ref: str
    display_order: int


@dataclass(frozen=True, slots=True)
class RecipeDocumentAction:
    ref: str
    action_type_id: UUID
    action_type_key: str | None
    inputs: tuple[RecipeDocumentActionInput, ...]
    measures: tuple[RecipeDocumentActionMeasure, ...]
    display_order: int

    @property
    def ingredient_refs(self) -> tuple[str, ...]:
        return tuple(item.ingredient_ref for item in self.inputs)


@dataclass(frozen=True, slots=True)
class RecipeDocumentInstruction:
    ref: str
    title: str | None
    text: str
    actions: tuple[RecipeDocumentAction, ...]
    display_order: int


@dataclass(frozen=True, slots=True)
class RecipeDocument:
    title: str
    description: str | None
    servings: Decimal | None
    total_time_minutes: int | None
    active_time_minutes: int | None
    difficulty: str | None
    notes: str | None
    categories: tuple[RecipeDocumentCategory, ...]
    ingredients: tuple[RecipeDocumentIngredient, ...]
    instructions: tuple[RecipeDocumentInstruction, ...]


@dataclass(frozen=True, slots=True)
class MutableRecipeDocumentRows:
    categories: tuple[RecipeDraftCategory, ...]
    ingredients: tuple[RecipeDraftIngredient, ...]
    instructions: tuple[RecipeDraftInstruction, ...]
    actions: tuple[RecipeDraftInstructionAction, ...]
    action_inputs: tuple[RecipeDraftInstructionActionInput, ...]
    action_measures: tuple[RecipeDraftInstructionActionMeasure, ...]

    @property
    def all_rows(self) -> tuple[object, ...]:
        return (
            *self.categories,
            *self.ingredients,
            *self.instructions,
            *self.actions,
            *self.action_inputs,
            *self.action_measures,
        )


@dataclass(frozen=True, slots=True)
class ImmutableRecipeDocumentRows:
    categories: tuple[RecipeVersionCategory, ...]
    ingredients: tuple[RecipeIngredient, ...]
    instructions: tuple[RecipeInstruction, ...]
    actions: tuple[RecipeInstructionAction, ...]
    action_inputs: tuple[RecipeInstructionActionInput, ...]
    action_measures: tuple[RecipeInstructionActionMeasure, ...]

    @property
    def all_rows(self) -> tuple[object, ...]:
        return (
            *self.categories,
            *self.ingredients,
            *self.instructions,
            *self.actions,
            *self.action_inputs,
            *self.action_measures,
        )


def empty_recipe_document() -> RecipeDocument:
    return RecipeDocument(
        title="",
        description=None,
        servings=None,
        total_time_minutes=None,
        active_time_minutes=None,
        difficulty=None,
        notes=None,
        categories=(),
        ingredients=(),
        instructions=(),
    )


def _editable_unit_display(unit: MeasurementUnit | None) -> str | None:
    if unit is None:
        return None
    return measurement_unit_snapshot_label(unit.symbol, unit.canonical_label)


def _ingredient_measure(
    *,
    mode: str,
    quantity_min: Decimal | None,
    quantity_max: Decimal | None,
    measurement_unit_id: UUID | None,
    unit_display: str | None,
    package_size_id: UUID | None,
    measurement_unit: MeasurementUnit | None,
    include_canonical_unit: bool,
) -> RecipeDocumentIngredientMeasure:
    return RecipeDocumentIngredientMeasure(
        mode=mode,
        quantity_min=quantity_min,
        quantity_max=quantity_max,
        measurement_unit_id=measurement_unit_id,
        unit_display=unit_display,
        package_size_id=package_size_id,
        canonical_unit=(
            canonical_unit_from_measurement(measurement_unit) if include_canonical_unit else None
        ),
    )


def _action_measure(
    measure: RecipeDraftInstructionActionMeasure | RecipeInstructionActionMeasure,
    *,
    refresh_unit_display: bool,
    include_canonical_unit: bool,
) -> RecipeDocumentActionMeasure:
    return RecipeDocumentActionMeasure(
        semantic=measure.semantic,
        mode=measure.measure_mode,
        quantity_min=measure.quantity_min,
        quantity_max=measure.quantity_max,
        measurement_unit_id=measure.measurement_unit_id,
        unit_display=(
            cast(str, _editable_unit_display(measure.measurement_unit))
            if refresh_unit_display
            else measure.unit_display
        ),
        canonical_unit=(
            canonical_unit_from_measurement(measure.measurement_unit)
            if include_canonical_unit
            else None
        ),
    )


def recipe_document_from_version(source: RecipeVersion) -> RecipeDocument:
    """Adapt a public immutable snapshot into current editable draft content."""

    ingredient_refs = {
        item.id: f"source-ingredient:{index:04d}" for index, item in enumerate(source.ingredients)
    }
    instructions: list[RecipeDocumentInstruction] = []
    for instruction_index, instruction in enumerate(source.instructions):
        actions: list[RecipeDocumentAction] = []
        for action_index, action in enumerate(instruction.actions):
            actions.append(
                RecipeDocumentAction(
                    ref=f"source-action:{instruction_index:04d}:{action_index:04d}",
                    action_type_id=action.action_type_id,
                    action_type_key=action.action_type.key,
                    inputs=tuple(
                        RecipeDocumentActionInput(
                            ingredient_ref=ingredient_refs[item.recipe_ingredient_id],
                            display_order=item.display_order,
                        )
                        for item in action.inputs
                    ),
                    measures=tuple(
                        _action_measure(
                            measure,
                            refresh_unit_display=True,
                            include_canonical_unit=False,
                        )
                        for measure in action.measures
                    ),
                    display_order=action.display_order,
                )
            )
        instructions.append(
            RecipeDocumentInstruction(
                ref=f"source-instruction:{instruction_index:04d}",
                title=instruction.title,
                text=instruction.instruction,
                actions=tuple(actions),
                display_order=instruction.display_order,
            )
        )
    return RecipeDocument(
        title=source.title,
        description=source.description,
        servings=source.servings,
        total_time_minutes=source.total_time_minutes,
        active_time_minutes=source.active_time_minutes,
        difficulty=source.difficulty,
        notes=source.notes,
        categories=tuple(
            RecipeDocumentCategory(
                category_id=item.recipe_category_id,
                name=item.category_name,
                slug=item.category_slug,
                display_order=item.display_order,
            )
            for item in source.categories
        ),
        ingredients=tuple(
            RecipeDocumentIngredient(
                ref=ingredient_refs[item.id],
                selection_kind="catalog",
                ingredient_id=item.ingredient_id,
                ingredient_request_id=None,
                name=item.name,
                measure=_ingredient_measure(
                    mode=item.measure_mode,
                    quantity_min=item.quantity_min,
                    quantity_max=item.quantity_max,
                    measurement_unit_id=item.measurement_unit_id,
                    unit_display=_editable_unit_display(item.measurement_unit),
                    package_size_id=item.package_size_id,
                    measurement_unit=item.measurement_unit,
                    include_canonical_unit=False,
                ),
                preparation_notes=item.preparation_notes,
                display_order=item.display_order,
            )
            for item in source.ingredients
        ),
        instructions=tuple(instructions),
    )


def _selection_kind(value: str) -> RecipeDocumentSelectionKind:
    if value not in {RECIPE_DRAFT_SELECTION_CATALOG, RECIPE_DRAFT_SELECTION_REQUEST}:
        raise RecipeDocumentMaterializationError(
            f"Unsupported recipe document ingredient selection {value!r}."
        )
    return cast(RecipeDocumentSelectionKind, value)


def recipe_document_from_draft(draft: RecipeDraft) -> RecipeDocument:
    """Adapt one fully loaded private draft without changing persisted snapshots."""

    ingredient_refs = {
        item.id: f"draft-ingredient:{index:04d}" for index, item in enumerate(draft.ingredients)
    }
    instructions: list[RecipeDocumentInstruction] = []
    for instruction_index, instruction in enumerate(draft.instructions):
        actions: list[RecipeDocumentAction] = []
        for action_index, action in enumerate(instruction.actions):
            actions.append(
                RecipeDocumentAction(
                    ref=f"draft-action:{instruction_index:04d}:{action_index:04d}",
                    action_type_id=action.action_type_id,
                    action_type_key=action.action_type.key,
                    inputs=tuple(
                        RecipeDocumentActionInput(
                            ingredient_ref=ingredient_refs[item.recipe_draft_ingredient_id],
                            display_order=item.display_order,
                        )
                        for item in action.inputs
                    ),
                    measures=tuple(
                        _action_measure(
                            measure,
                            refresh_unit_display=False,
                            include_canonical_unit=True,
                        )
                        for measure in action.measures
                    ),
                    display_order=action.display_order,
                )
            )
        instructions.append(
            RecipeDocumentInstruction(
                ref=f"draft-instruction:{instruction_index:04d}",
                title=instruction.title,
                text=instruction.instruction,
                actions=tuple(actions),
                display_order=instruction.display_order,
            )
        )
    return RecipeDocument(
        title=draft.title,
        description=draft.description,
        servings=draft.servings,
        total_time_minutes=draft.total_time_minutes,
        active_time_minutes=draft.active_time_minutes,
        difficulty=draft.difficulty,
        notes=draft.notes,
        categories=tuple(
            RecipeDocumentCategory(
                category_id=item.recipe_category_id,
                name=item.category.name,
                slug=item.category.slug,
                display_order=item.display_order,
            )
            for item in draft.categories
        ),
        ingredients=tuple(
            RecipeDocumentIngredient(
                ref=ingredient_refs[item.id],
                selection_kind=_selection_kind(item.selection_kind),
                ingredient_id=item.ingredient_id,
                ingredient_request_id=item.ingredient_request_id,
                name=item.name,
                measure=_ingredient_measure(
                    mode=item.measure_mode,
                    quantity_min=item.quantity_min,
                    quantity_max=item.quantity_max,
                    measurement_unit_id=item.measurement_unit_id,
                    unit_display=item.unit_display,
                    package_size_id=item.package_size_id,
                    measurement_unit=item.measurement_unit,
                    include_canonical_unit=True,
                ),
                preparation_notes=item.preparation_notes,
                display_order=item.display_order,
            )
            for item in draft.ingredients
        ),
        instructions=tuple(instructions),
    )


def apply_mutable_recipe_document_header(
    target: RecipeDraft,
    document: RecipeDocument,
) -> None:
    target.title = document.title
    target.description = document.description
    target.servings = document.servings
    target.total_time_minutes = document.total_time_minutes
    target.active_time_minutes = document.active_time_minutes
    target.difficulty = document.difficulty
    target.notes = document.notes


def _allocate_ids(refs: tuple[str, ...], *, kind: str) -> dict[str, UUID]:
    if len(refs) != len(set(refs)):
        raise RecipeDocumentMaterializationError(
            f"Recipe document contains duplicate {kind} references."
        )
    return {ref: uuid4() for ref in refs}


def _document_ids(
    document: RecipeDocument,
) -> tuple[dict[str, UUID], dict[str, UUID], dict[str, UUID]]:
    ingredient_ids = _allocate_ids(
        tuple(item.ref for item in document.ingredients),
        kind="ingredient",
    )
    instruction_ids = _allocate_ids(
        tuple(item.ref for item in document.instructions),
        kind="instruction",
    )
    actions = tuple(
        action for instruction in document.instructions for action in instruction.actions
    )
    action_ids = _allocate_ids(tuple(item.ref for item in actions), kind="action")
    for action in actions:
        missing = set(action.ingredient_refs) - ingredient_ids.keys()
        if missing:
            raise RecipeDocumentMaterializationError(
                f"Recipe document action references unknown ingredient slots: {sorted(missing)!r}."
            )
    return ingredient_ids, instruction_ids, action_ids


def materialize_mutable_recipe_document(
    session: Session,
    *,
    draft: RecipeDraft,
    document: RecipeDocument,
) -> MutableRecipeDocumentRows:
    """Stage a complete mutable document without flushing or committing."""

    ingredient_ids, instruction_ids, action_ids = _document_ids(document)
    ingredient_kinds = {item.ref: item.selection_kind for item in document.ingredients}
    actions = tuple(
        action for instruction in document.instructions for action in instruction.actions
    )
    for action in actions:
        unresolved = [
            ref
            for ref in action.ingredient_refs
            if ingredient_kinds[ref] != RECIPE_DRAFT_SELECTION_CATALOG
        ]
        if unresolved:
            raise RecipeDocumentMaterializationError(
                "Structured actions may reference only catalog-backed ingredient slots."
            )
    apply_mutable_recipe_document_header(draft, document)
    rows = MutableRecipeDocumentRows(
        categories=tuple(
            RecipeDraftCategory(
                recipe_draft_id=draft.id,
                recipe_category_id=item.category_id,
                display_order=item.display_order,
            )
            for item in document.categories
        ),
        ingredients=tuple(
            RecipeDraftIngredient(
                id=ingredient_ids[item.ref],
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
                display_order=item.display_order,
            )
            for item in document.ingredients
        ),
        instructions=tuple(
            RecipeDraftInstruction(
                id=instruction_ids[item.ref],
                recipe_draft_id=draft.id,
                title=item.title,
                instruction=item.text,
                display_order=item.display_order,
            )
            for item in document.instructions
        ),
        actions=tuple(
            RecipeDraftInstructionAction(
                id=action_ids[action.ref],
                recipe_draft_id=draft.id,
                recipe_draft_instruction_id=instruction_ids[instruction.ref],
                action_type_id=action.action_type_id,
                display_order=action.display_order,
            )
            for instruction in document.instructions
            for action in instruction.actions
        ),
        action_inputs=tuple(
            RecipeDraftInstructionActionInput(
                id=uuid4(),
                recipe_draft_id=draft.id,
                recipe_draft_instruction_action_id=action_ids[action.ref],
                recipe_draft_ingredient_id=ingredient_ids[item.ingredient_ref],
                display_order=item.display_order,
            )
            for instruction in document.instructions
            for action in instruction.actions
            for item in action.inputs
        ),
        action_measures=tuple(
            RecipeDraftInstructionActionMeasure(
                recipe_draft_instruction_action_id=action_ids[action.ref],
                semantic=measure.semantic,
                measure_mode=measure.mode,
                quantity_min=measure.quantity_min,
                quantity_max=measure.quantity_max,
                measurement_unit_id=measure.measurement_unit_id,
                unit_display=measure.unit_display,
            )
            for instruction in document.instructions
            for action in instruction.actions
            for measure in action.measures
        ),
    )
    session.add_all(rows.all_rows)
    return rows


def materialize_immutable_recipe_document(
    session: Session,
    *,
    recipe_version_id: UUID,
    document: RecipeDocument,
) -> ImmutableRecipeDocumentRows:
    """Stage a complete immutable snapshot without flushing or committing."""

    ingredient_ids, instruction_ids, action_ids = _document_ids(document)
    for item in document.ingredients:
        if (
            item.selection_kind != RECIPE_DRAFT_SELECTION_CATALOG
            or item.ingredient_id is None
            or item.name is None
        ):
            raise RecipeDocumentMaterializationError(
                "Immutable recipe documents require catalog-backed ingredients."
            )
    rows = ImmutableRecipeDocumentRows(
        categories=tuple(
            RecipeVersionCategory(
                recipe_version_id=recipe_version_id,
                recipe_category_id=item.category_id,
                category_name=item.name,
                category_slug=item.slug,
                display_order=item.display_order,
            )
            for item in document.categories
        ),
        ingredients=tuple(
            RecipeIngredient(
                id=ingredient_ids[item.ref],
                recipe_version_id=recipe_version_id,
                ingredient_id=cast(UUID, item.ingredient_id),
                name=cast(str, item.name),
                measure_mode=item.measure.mode,
                quantity_min=item.measure.quantity_min,
                quantity_max=item.measure.quantity_max,
                measurement_unit_id=item.measure.measurement_unit_id,
                unit_display=item.measure.unit_display,
                package_size_id=item.measure.package_size_id,
                preparation_notes=item.preparation_notes,
                display_order=item.display_order,
            )
            for item in document.ingredients
        ),
        instructions=tuple(
            RecipeInstruction(
                id=instruction_ids[item.ref],
                recipe_version_id=recipe_version_id,
                title=item.title,
                instruction=item.text,
                display_order=item.display_order,
            )
            for item in document.instructions
        ),
        actions=tuple(
            RecipeInstructionAction(
                id=action_ids[action.ref],
                recipe_version_id=recipe_version_id,
                recipe_instruction_id=instruction_ids[instruction.ref],
                action_type_id=action.action_type_id,
                display_order=action.display_order,
            )
            for instruction in document.instructions
            for action in instruction.actions
        ),
        action_inputs=tuple(
            RecipeInstructionActionInput(
                id=uuid4(),
                recipe_version_id=recipe_version_id,
                recipe_instruction_action_id=action_ids[action.ref],
                recipe_ingredient_id=ingredient_ids[item.ingredient_ref],
                display_order=item.display_order,
            )
            for instruction in document.instructions
            for action in instruction.actions
            for item in action.inputs
        ),
        action_measures=tuple(
            RecipeInstructionActionMeasure(
                recipe_instruction_action_id=action_ids[action.ref],
                semantic=measure.semantic,
                measure_mode=measure.mode,
                quantity_min=measure.quantity_min,
                quantity_max=measure.quantity_max,
                measurement_unit_id=measure.measurement_unit_id,
                unit_display=measure.unit_display,
            )
            for instruction in document.instructions
            for action in instruction.actions
            for measure in action.measures
        ),
    )
    session.add_all(rows.all_rows)
    return rows


def _structural_action_measure(
    measures: dict[str, RecipeDocumentActionMeasure],
    semantic: str,
) -> StructuralMeasure | None:
    measure = measures.get(semantic)
    if measure is None:
        return None
    return StructuralMeasure(
        mode=measure.mode,
        quantity_min=measure.quantity_min,
        quantity_max=measure.quantity_max,
        unit=measure.canonical_unit,
    )


def recipe_structure_from_document(document: RecipeDocument) -> RecipeStructure:
    """Project the typed storage document into fingerprint-v1 structure fields."""

    ingredients = tuple(
        StructuralIngredient(
            occurrence_key=item.ref,
            ingredient_identity=(str(item.ingredient_id) if item.ingredient_id else None),
            measure=StructuralMeasure(
                mode=item.measure.mode,
                quantity_min=item.measure.quantity_min,
                quantity_max=item.measure.quantity_max,
                unit=item.measure.canonical_unit,
                package_size_identity=(
                    str(item.measure.package_size_id)
                    if item.measure.package_size_id is not None
                    else None
                ),
            ),
        )
        for item in document.ingredients
    )
    instructions: list[StructuralInstruction] = []
    for instruction in document.instructions:
        actions: list[StructuralAction] = []
        for action in instruction.actions:
            measures = {measure.semantic: measure for measure in action.measures}
            actions.append(
                StructuralAction(
                    action_type_key=action.action_type_key,
                    ingredient_occurrence_keys=action.ingredient_refs,
                    duration=_structural_action_measure(measures, "duration"),
                    temperature=_structural_action_measure(measures, "temperature"),
                )
            )
        instructions.append(StructuralInstruction(actions=tuple(actions)))
    return RecipeStructure(ingredients=ingredients, instructions=tuple(instructions))
