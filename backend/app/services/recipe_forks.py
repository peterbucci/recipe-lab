from dataclasses import dataclass
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session, raiseload, selectinload

from app.models import RecipeIngredient, RecipeInstruction, RecipeLineage, RecipeVersion
from app.repositories.ingredients import curated_display_label, get_ingredient
from app.schemas.recipe_forks import (
    AddIngredient,
    AddInstruction,
    RecipeForkRequest,
    RemoveIngredient,
    RemoveInstruction,
    ReplaceIngredient,
    SetIngredientQuantity,
    SetIngredientUnit,
    UpdateInstruction,
)


class InvalidRecipeEditsError(ValueError):
    """Raised when structurally valid edits cannot be applied to the source snapshot."""


@dataclass(slots=True)
class _IngredientDraft:
    source_id: UUID | None
    ingredient_id: UUID
    name: str
    quantity: Decimal | None
    unit: str | None
    preparation_notes: str | None


@dataclass(slots=True)
class _InstructionDraft:
    source_id: UUID | None
    text: str


def _invalid(message: str) -> InvalidRecipeEditsError:
    return InvalidRecipeEditsError(message)


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
            selectinload(RecipeVersion.instructions),
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
            ingredient_id=item.ingredient_id,
            name=item.name,
            quantity=item.quantity,
            unit=item.unit,
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
            additions.append(
                _IngredientDraft(
                    source_id=None,
                    ingredient_id=ingredient_id,
                    name=display_name,
                    quantity=edit.quantity,
                    unit=edit.unit,
                    preparation_notes=edit.preparation_notes,
                )
            )
            continue

        draft = drafts[edit.recipe_ingredient_id]
        if isinstance(edit, SetIngredientQuantity):
            draft.quantity = edit.quantity
        elif isinstance(edit, SetIngredientUnit):
            draft.unit = edit.unit
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
        item.id: _InstructionDraft(source_id=item.id, text=item.instruction)
        for item in source.instructions
    }
    edited_targets: set[UUID] = set()

    for edit in payload.instruction_edits:
        if isinstance(edit, AddInstruction):
            continue
        target_id = edit.recipe_instruction_id
        if target_id not in drafts:
            raise _invalid(
                f"Instruction row {target_id} does not belong to the source recipe version."
            )
        if target_id in edited_targets:
            raise _invalid(f"Instruction row {target_id} has conflicting or duplicate edits.")
        edited_targets.add(target_id)

    return drafts


def _apply_instruction_edits(
    source: RecipeVersion,
    payload: RecipeForkRequest,
) -> list[_InstructionDraft]:
    drafts = _validate_instruction_targets(source, payload)
    removed_ids: set[UUID] = set()
    additions: list[_InstructionDraft] = []

    for edit in payload.instruction_edits:
        if isinstance(edit, AddInstruction):
            additions.append(_InstructionDraft(source_id=None, text=edit.text))
        elif isinstance(edit, UpdateInstruction):
            drafts[edit.recipe_instruction_id].text = edit.text
        elif isinstance(edit, RemoveInstruction):
            removed_ids.add(edit.recipe_instruction_id)

    result = [drafts[item.id] for item in source.instructions if item.id not in removed_ids]
    result.extend(additions)
    if not result:
        raise _invalid("A recipe version must contain at least one instruction.")
    return result


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
    instruction_drafts = _apply_instruction_edits(source, payload)

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

    session.add_all(
        [
            RecipeIngredient(
                recipe_version_id=child.id,
                ingredient_id=draft.ingredient_id,
                name=draft.name,
                quantity=draft.quantity,
                unit=draft.unit,
                preparation_notes=draft.preparation_notes,
                display_order=display_order,
            )
            for display_order, draft in enumerate(ingredient_drafts)
        ]
    )
    session.add_all(
        [
            RecipeInstruction(
                recipe_version_id=child.id,
                instruction=draft.text,
                display_order=display_order,
            )
            for display_order, draft in enumerate(instruction_drafts)
        ]
    )
    session.flush()
    return child.id
