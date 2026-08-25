from dataclasses import dataclass
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session, raiseload, selectinload

from app.models import (
    MeasurementUnit,
    RecipeIngredient,
    RecipeInstruction,
    RecipeInstructionAction,
    RecipeInstructionActionInput,
    RecipeInstructionActionMeasure,
    RecipeLineage,
    RecipeVersion,
)
from app.repositories.ingredients import curated_display_label, get_ingredient
from app.schemas.actions import (
    AddedIngredientOccurrenceReference,
    ExistingIngredientOccurrenceReference,
    IngredientOccurrenceReference,
    StructuredActionInput,
)
from app.schemas.measurements import (
    ExactMeasureInput,
    QualitativeMeasureInput,
    RangeMeasureInput,
    StructuredMeasureInput,
)
from app.schemas.recipe_forks import (
    AddIngredient,
    AddInstruction,
    RecipeForkRequest,
    RemoveIngredient,
    RemoveInstruction,
    ReplaceIngredient,
    SetIngredientMeasure,
    SetInstructionActions,
    UpdateInstruction,
)
from app.services.actions import (
    ActionContractError,
    ValidatedActionMeasure,
    validate_structured_actions,
)
from app.services.measurements import MeasurementError, validate_measure_input
from app.services.recipe_fingerprint_persistence import (
    fingerprint_and_store_recipe_version,
)


class InvalidRecipeEditsError(ValueError):
    """Raised when structurally valid edits cannot be applied to the source snapshot."""


@dataclass(slots=True)
class _IngredientDraft:
    source_id: UUID | None
    edit_ref: str | None
    ingredient_id: UUID
    name: str
    measure_mode: str
    quantity_min: Decimal | None
    quantity_max: Decimal | None
    measurement_unit_id: UUID | None
    unit_display: str | None
    package_size_id: UUID | None
    preparation_notes: str | None


@dataclass(slots=True)
class _ActionDraft:
    action_type_id: UUID
    ingredient_refs: tuple[IngredientOccurrenceReference, ...]
    measures: tuple[ValidatedActionMeasure, ...]


@dataclass(slots=True)
class _InstructionDraft:
    source_id: UUID | None
    text: str
    actions: list[_ActionDraft]


def _invalid(message: str) -> InvalidRecipeEditsError:
    return InvalidRecipeEditsError(message)


def _unit_display_snapshot(unit: MeasurementUnit) -> str:
    return unit.symbol or unit.canonical_label


def _validate_recipe_quantity_precision(value: Decimal) -> None:
    if value.copy_abs() >= Decimal("100000000"):
        raise _invalid("Recipe quantities may contain at most eight integer digits.")
    if value != value.quantize(Decimal("0.0001")):
        raise _invalid("Recipe quantities may contain at most four decimal places.")


def _validated_measure_fields(
    session: Session,
    measure: StructuredMeasureInput,
    ingredient_id: UUID,
) -> tuple[
    str,
    Decimal | None,
    Decimal | None,
    UUID | None,
    str | None,
    UUID | None,
]:
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
            raise RuntimeError("A validated exact measure has no curated unit.")
        _validate_recipe_quantity_precision(measure.value)
        return (
            "exact",
            measure.value,
            None,
            unit.id,
            _unit_display_snapshot(unit),
            measure.package_size_id,
        )
    if isinstance(measure, RangeMeasureInput):
        if unit is None:
            raise RuntimeError("A validated range measure has no curated unit.")
        _validate_recipe_quantity_precision(measure.minimum)
        _validate_recipe_quantity_precision(measure.maximum)
        return (
            "range",
            measure.minimum,
            measure.maximum,
            unit.id,
            _unit_display_snapshot(unit),
            measure.package_size_id,
        )
    if isinstance(measure, QualitativeMeasureInput):
        return measure.value, None, None, None, None, None
    raise AssertionError("Unsupported structured measure input.")


def _set_draft_measure(
    draft: _IngredientDraft,
    fields: tuple[
        str,
        Decimal | None,
        Decimal | None,
        UUID | None,
        str | None,
        UUID | None,
    ],
) -> None:
    (
        draft.measure_mode,
        draft.quantity_min,
        draft.quantity_max,
        draft.measurement_unit_id,
        draft.unit_display,
        draft.package_size_id,
    ) = fields


def _load_source_after_lineage_lock(
    session: Session,
    source_version_id: UUID,
) -> RecipeVersion | None:
    lineage_id = session.scalar(
        select(RecipeVersion.lineage_id).where(RecipeVersion.id == source_version_id)
    )
    if lineage_id is None:
        return None

    locked_lineage_id = session.scalar(
        select(RecipeLineage.id).where(RecipeLineage.id == lineage_id).with_for_update()
    )
    if locked_lineage_id is None:
        return None

    statement = (
        select(RecipeVersion)
        .options(
            selectinload(RecipeVersion.ingredients),
            selectinload(RecipeVersion.instructions)
            .selectinload(RecipeInstruction.actions)
            .options(
                selectinload(RecipeInstructionAction.inputs),
                selectinload(RecipeInstructionAction.measures),
            ),
            raiseload("*"),
        )
        .where(RecipeVersion.id == source_version_id)
    )
    return session.scalar(statement)


def _validate_ingredient_targets(
    source: RecipeVersion,
    payload: RecipeForkRequest,
) -> dict[UUID, _IngredientDraft]:
    drafts = {
        item.id: _IngredientDraft(
            source_id=item.id,
            edit_ref=None,
            ingredient_id=item.ingredient_id,
            name=item.name,
            measure_mode=item.measure_mode,
            quantity_min=item.quantity_min,
            quantity_max=item.quantity_max,
            measurement_unit_id=item.measurement_unit_id,
            unit_display=item.unit_display,
            package_size_id=item.package_size_id,
            preparation_notes=item.preparation_notes,
        )
        for item in source.ingredients
    }
    operations_by_target: dict[UUID, set[str]] = {}

    for edit in payload.ingredient_edits:
        if isinstance(edit, AddIngredient):
            continue

        target_id = edit.recipe_ingredient_id
        if target_id not in drafts:
            raise _invalid(
                f"Ingredient row {target_id} does not belong to the source recipe version."
            )

        prior_operations = operations_by_target.setdefault(target_id, set())
        if edit.op in prior_operations:
            raise _invalid(f"Ingredient row {target_id} has more than one {edit.op} edit.")
        if edit.op == "remove" and prior_operations:
            raise _invalid(
                f"Ingredient row {target_id} cannot be removed and edited in the same fork."
            )
        if "remove" in prior_operations:
            raise _invalid(
                f"Ingredient row {target_id} cannot be removed and edited in the same fork."
            )
        prior_operations.add(edit.op)

    return drafts


def _resolve_required_catalog_selection(
    session: Session,
    ingredient_id: UUID,
    submitted_display_name: str,
) -> tuple[UUID, str]:
    """Verify a stable identity/label pair without creating or inferring metadata."""

    ingredient = get_ingredient(session, ingredient_id)
    if ingredient is None:
        raise _invalid(
            f"Ingredient {ingredient_id} is not in the curated catalog and cannot be published."
        )
    display_name = curated_display_label(ingredient, submitted_display_name)
    if display_name is None:
        raise _invalid(
            f'"{submitted_display_name}" is not a curated name or alias for '
            f"ingredient {ingredient_id}."
        )
    return ingredient.id, display_name


def _apply_ingredient_edits(
    session: Session,
    source: RecipeVersion,
    payload: RecipeForkRequest,
) -> list[_IngredientDraft]:
    drafts = _validate_ingredient_targets(source, payload)
    removed_ids: set[UUID] = set()
    additions: list[_IngredientDraft] = []

    for edit in payload.ingredient_edits:
        if isinstance(edit, AddIngredient):
            ingredient_id, display_name = _resolve_required_catalog_selection(
                session,
                edit.ingredient_id,
                edit.display_name,
            )
            (
                measure_mode,
                quantity_min,
                quantity_max,
                measurement_unit_id,
                unit_display,
                package_size_id,
            ) = _validated_measure_fields(session, edit.measure, ingredient_id)
            additions.append(
                _IngredientDraft(
                    source_id=None,
                    edit_ref=edit.edit_ref,
                    ingredient_id=ingredient_id,
                    name=display_name,
                    measure_mode=measure_mode,
                    quantity_min=quantity_min,
                    quantity_max=quantity_max,
                    measurement_unit_id=measurement_unit_id,
                    unit_display=unit_display,
                    package_size_id=package_size_id,
                    preparation_notes=edit.preparation_notes,
                )
            )
            continue

        draft = drafts[edit.recipe_ingredient_id]
        if isinstance(edit, SetIngredientMeasure):
            _set_draft_measure(
                draft,
                _validated_measure_fields(session, edit.measure, draft.ingredient_id),
            )
        elif isinstance(edit, ReplaceIngredient):
            replacement_id, display_name = _resolve_required_catalog_selection(
                session,
                edit.ingredient_id,
                edit.display_name,
            )
            if (
                replacement_id == draft.ingredient_id
                and display_name.strip().lower() == draft.name.strip().lower()
            ):
                raise _invalid(
                    f'Ingredient row {edit.recipe_ingredient_id} already uses "{display_name}".'
                )
            draft.ingredient_id = replacement_id
            draft.name = display_name
            # Package-size metadata is ingredient-specific. Keep the authored
            # measure, but never carry another ingredient's reviewed package
            # relationship across a replacement.
            draft.package_size_id = None
        elif isinstance(edit, RemoveIngredient):
            removed_ids.add(edit.recipe_ingredient_id)

    result = [drafts[item.id] for item in source.ingredients if item.id not in removed_ids]
    result.extend(additions)
    if not result:
        raise _invalid("A recipe version must contain at least one ingredient.")
    return result


def _validate_instruction_targets(
    source: RecipeVersion,
    payload: RecipeForkRequest,
) -> dict[UUID, _InstructionDraft]:
    drafts = {
        item.id: _InstructionDraft(
            source_id=item.id,
            text=item.instruction,
            actions=[
                _ActionDraft(
                    action_type_id=action.action_type_id,
                    ingredient_refs=tuple(
                        ExistingIngredientOccurrenceReference(
                            kind="existing",
                            recipe_ingredient_id=action_input.recipe_ingredient_id,
                        )
                        for action_input in action.inputs
                    ),
                    measures=tuple(
                        ValidatedActionMeasure(
                            semantic=measure.semantic,
                            measure_mode=measure.measure_mode,
                            quantity_min=measure.quantity_min,
                            quantity_max=measure.quantity_max,
                            measurement_unit_id=measure.measurement_unit_id,
                            unit_display=measure.unit_display,
                        )
                        for measure in action.measures
                    ),
                )
                for action in item.actions
            ],
        )
        for item in source.instructions
    }
    operations_by_target: dict[UUID, set[str]] = {}

    for edit in payload.instruction_edits:
        if isinstance(edit, AddInstruction):
            continue
        target_id = edit.recipe_instruction_id
        if target_id not in drafts:
            raise _invalid(
                f"Instruction row {target_id} does not belong to the source recipe version."
            )
        prior_operations = operations_by_target.setdefault(target_id, set())
        if edit.op in prior_operations:
            raise _invalid(f"Instruction row {target_id} has more than one {edit.op} edit.")
        if edit.op == "remove" and prior_operations:
            raise _invalid(
                f"Instruction row {target_id} cannot be removed and edited in the same fork."
            )
        if "remove" in prior_operations:
            raise _invalid(
                f"Instruction row {target_id} cannot be removed and edited in the same fork."
            )
        prior_operations.add(edit.op)

    return drafts


def _validated_action_drafts(
    session: Session,
    actions: list[StructuredActionInput],
) -> list[_ActionDraft]:
    try:
        validated = validate_structured_actions(session, actions)
    except ActionContractError as error:
        raise _invalid(str(error)) from error
    return [
        _ActionDraft(
            action_type_id=action.action_type_id,
            ingredient_refs=action.inputs,
            measures=action.measures,
        )
        for action in validated
    ]


def _apply_instruction_edits(
    session: Session,
    source: RecipeVersion,
    payload: RecipeForkRequest,
) -> list[_InstructionDraft]:
    drafts = _validate_instruction_targets(source, payload)
    removed_ids: set[UUID] = set()
    additions: list[_InstructionDraft] = []

    for edit in payload.instruction_edits:
        if isinstance(edit, AddInstruction):
            additions.append(
                _InstructionDraft(
                    source_id=None,
                    text=edit.text,
                    actions=_validated_action_drafts(session, edit.actions),
                )
            )
        elif isinstance(edit, UpdateInstruction):
            drafts[edit.recipe_instruction_id].text = edit.text
        elif isinstance(edit, SetInstructionActions):
            drafts[edit.recipe_instruction_id].actions = _validated_action_drafts(
                session,
                edit.actions,
            )
        elif isinstance(edit, RemoveInstruction):
            removed_ids.add(edit.recipe_instruction_id)

    result = [drafts[item.id] for item in source.instructions if item.id not in removed_ids]
    result.extend(additions)
    if not result:
        raise _invalid("A recipe version must contain at least one instruction.")
    incomplete = [draft.source_id for draft in result if not draft.actions]
    if incomplete:
        raise _invalid(
            "Every published instruction requires at least one structured cooking action; "
            f"unmapped instruction rows={incomplete}."
        )
    return result


def _persist_ingredients(
    session: Session,
    *,
    child_id: UUID,
    drafts: list[_IngredientDraft],
) -> dict[tuple[str, UUID | str], UUID]:
    rows = [
        RecipeIngredient(
            recipe_version_id=child_id,
            ingredient_id=draft.ingredient_id,
            name=draft.name,
            measure_mode=draft.measure_mode,
            quantity_min=draft.quantity_min,
            quantity_max=draft.quantity_max,
            measurement_unit_id=draft.measurement_unit_id,
            unit_display=draft.unit_display,
            package_size_id=draft.package_size_id,
            preparation_notes=draft.preparation_notes,
            display_order=display_order,
        )
        for display_order, draft in enumerate(drafts)
    ]
    session.add_all(rows)
    session.flush()

    occurrence_ids: dict[tuple[str, UUID | str], UUID] = {}
    for draft, row in zip(drafts, rows, strict=True):
        if draft.source_id is not None:
            occurrence_ids[("existing", draft.source_id)] = row.id
        if draft.edit_ref is not None:
            occurrence_ids[("added", draft.edit_ref)] = row.id
    return occurrence_ids


def _resolve_action_input(
    reference: IngredientOccurrenceReference,
    occurrence_ids: dict[tuple[str, UUID | str], UUID],
) -> UUID:
    key: tuple[str, UUID | str]
    if isinstance(reference, ExistingIngredientOccurrenceReference):
        key = ("existing", reference.recipe_ingredient_id)
    elif isinstance(reference, AddedIngredientOccurrenceReference):
        key = ("added", reference.ingredient_edit_ref)
    else:
        raise AssertionError("Unsupported ingredient occurrence reference.")
    resolved = occurrence_ids.get(key)
    if resolved is None:
        raise _invalid(
            "A structured action references an ingredient occurrence that is not present "
            f"in the child recipe: {reference.model_dump(mode='json')}."
        )
    return resolved


def _validate_action_references(
    ingredient_drafts: list[_IngredientDraft],
    instruction_drafts: list[_InstructionDraft],
) -> None:
    available: set[tuple[str, UUID | str]] = set()
    for draft in ingredient_drafts:
        if draft.source_id is not None:
            available.add(("existing", draft.source_id))
        if draft.edit_ref is not None:
            available.add(("added", draft.edit_ref))

    for instruction in instruction_drafts:
        for action in instruction.actions:
            for reference in action.ingredient_refs:
                if isinstance(reference, ExistingIngredientOccurrenceReference):
                    key: tuple[str, UUID | str] = (
                        "existing",
                        reference.recipe_ingredient_id,
                    )
                elif isinstance(reference, AddedIngredientOccurrenceReference):
                    key = ("added", reference.ingredient_edit_ref)
                else:
                    raise AssertionError("Unsupported ingredient occurrence reference.")
                if key not in available:
                    raise _invalid(
                        "A structured action references an ingredient occurrence that is not "
                        f"present in the child recipe: {reference.model_dump(mode='json')}."
                    )


def _persist_instructions(
    session: Session,
    *,
    child_id: UUID,
    drafts: list[_InstructionDraft],
    occurrence_ids: dict[tuple[str, UUID | str], UUID],
) -> None:
    instruction_rows = [
        RecipeInstruction(
            recipe_version_id=child_id,
            instruction=draft.text,
            display_order=display_order,
        )
        for display_order, draft in enumerate(drafts)
    ]
    session.add_all(instruction_rows)
    session.flush()

    action_pairs: list[tuple[_ActionDraft, RecipeInstructionAction]] = []
    for instruction_draft, instruction_row in zip(drafts, instruction_rows, strict=True):
        for display_order, action_draft in enumerate(instruction_draft.actions):
            action_row = RecipeInstructionAction(
                recipe_version_id=child_id,
                recipe_instruction_id=instruction_row.id,
                action_type_id=action_draft.action_type_id,
                display_order=display_order,
            )
            session.add(action_row)
            action_pairs.append((action_draft, action_row))
    session.flush()

    for action_draft, action_row in action_pairs:
        for display_order, reference in enumerate(action_draft.ingredient_refs):
            session.add(
                RecipeInstructionActionInput(
                    recipe_version_id=child_id,
                    recipe_instruction_action_id=action_row.id,
                    recipe_ingredient_id=_resolve_action_input(reference, occurrence_ids),
                    display_order=display_order,
                )
            )
        for measure in action_draft.measures:
            session.add(
                RecipeInstructionActionMeasure(
                    recipe_instruction_action_id=action_row.id,
                    semantic=measure.semantic,
                    measure_mode=measure.measure_mode,
                    quantity_min=measure.quantity_min,
                    quantity_max=measure.quantity_max,
                    measurement_unit_id=measure.measurement_unit_id,
                    unit_display=measure.unit_display,
                )
            )
    session.flush()


def fork_recipe_version(
    session: Session,
    *,
    source_version_id: UUID,
    author_user_id: UUID,
    payload: RecipeForkRequest,
) -> UUID | None:
    """Clone one snapshot and apply edits without committing the caller's transaction."""

    source = _load_source_after_lineage_lock(session, source_version_id)
    if source is None:
        return None

    ingredient_drafts = _apply_ingredient_edits(session, source, payload)
    instruction_drafts = _apply_instruction_edits(session, source, payload)
    _validate_action_references(ingredient_drafts, instruction_drafts)

    highest_version = session.scalar(
        select(func.max(RecipeVersion.version_number)).where(
            RecipeVersion.lineage_id == source.lineage_id
        )
    )
    next_version_number = (highest_version or 0) + 1

    child = RecipeVersion(
        lineage_id=source.lineage_id,
        parent_version_id=source.id,
        created_by_user_id=author_user_id,
        version_number=next_version_number,
        title=payload.title,
        description=payload.description,
        servings=payload.servings,
    )
    session.add(child)
    session.flush()

    occurrence_ids = _persist_ingredients(
        session,
        child_id=child.id,
        drafts=ingredient_drafts,
    )
    _persist_instructions(
        session,
        child_id=child.id,
        drafts=instruction_drafts,
        occurrence_ids=occurrence_ids,
    )
    fingerprint_result = fingerprint_and_store_recipe_version(session, child.id)
    if fingerprint_result.state == "incomplete":
        raise RuntimeError(
            "A validated complete child recipe did not produce a structural fingerprint."
        )
    return child.id
