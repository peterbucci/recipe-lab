"""Concrete ORM copies from a private draft into an immutable recipe snapshot."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    RecipeDraft,
    RecipeIngredient,
    RecipeInstruction,
    RecipeInstructionAction,
    RecipeInstructionActionInput,
    RecipeInstructionActionMeasure,
    RecipeLineage,
    RecipeVersion,
    RecipeVersionCategory,
)
from app.policies.recipe_visibility import publicly_readable_recipe_version_filter


class RecipeForkSourceUnavailableError(RuntimeError):
    """Raised when a source-backed draft's immutable public parent is unavailable."""


def create_recipe_version_identity(
    session: Session,
    *,
    draft: RecipeDraft,
    author_user_id: UUID,
) -> RecipeVersion:
    """Allocate the lineage position and immutable version header for one draft."""

    source_version_id = draft.source_version_id
    parent_version_id: UUID | None = None
    if source_version_id is None:
        lineage = RecipeLineage(created_by_user_id=author_user_id)
        session.add(lineage)
        session.flush()
        lineage_id = lineage.id
        version_number = 1
    else:
        source_lineage_id = session.scalar(
            select(RecipeVersion.lineage_id).where(
                RecipeVersion.id == source_version_id,
                publicly_readable_recipe_version_filter(),
            )
        )
        if source_lineage_id is None:
            raise RecipeForkSourceUnavailableError(
                "The public source recipe is no longer available."
            )
        locked_lineage_id = session.scalar(
            select(RecipeLineage.id).where(RecipeLineage.id == source_lineage_id).with_for_update()
        )
        if locked_lineage_id is None:
            raise RecipeForkSourceUnavailableError(
                "The public source recipe is no longer available."
            )
        confirmed_lineage_id = session.scalar(
            select(RecipeVersion.lineage_id).where(
                RecipeVersion.id == source_version_id,
                RecipeVersion.lineage_id == locked_lineage_id,
                publicly_readable_recipe_version_filter(),
            )
        )
        if confirmed_lineage_id != locked_lineage_id:
            raise RecipeForkSourceUnavailableError(
                "The public source recipe is no longer available."
            )
        highest_version = session.scalar(
            select(func.max(RecipeVersion.version_number)).where(
                RecipeVersion.lineage_id == locked_lineage_id
            )
        )
        lineage_id = locked_lineage_id
        parent_version_id = source_version_id
        version_number = (highest_version or 0) + 1

    version = RecipeVersion(
        lineage_id=lineage_id,
        parent_version_id=parent_version_id,
        created_by_user_id=author_user_id,
        version_number=version_number,
        title=draft.title,
        description=draft.description,
        servings=draft.servings,
        total_time_minutes=draft.total_time_minutes,
        active_time_minutes=draft.active_time_minutes,
        difficulty=draft.difficulty,
        notes=draft.notes,
    )
    session.add(version)
    session.flush()
    return version


def copy_recipe_version_categories(
    session: Session,
    *,
    draft: RecipeDraft,
    recipe_version_id: UUID,
) -> None:
    """Copy the ordered category snapshot for one immutable version."""

    session.add_all(
        [
            RecipeVersionCategory(
                recipe_version_id=recipe_version_id,
                recipe_category_id=item.recipe_category_id,
                category_name=item.category.name,
                category_slug=item.category.slug,
                display_order=item.display_order,
            )
            for item in draft.categories
        ]
    )
    session.flush()


def copy_recipe_version_ingredients(
    session: Session,
    *,
    draft: RecipeDraft,
    recipe_version_id: UUID,
) -> dict[UUID, UUID]:
    """Copy ingredients and return draft-to-version occurrence identities."""

    rows = [
        RecipeIngredient(
            recipe_version_id=recipe_version_id,
            ingredient_id=item.ingredient_id,
            name=item.name,
            measure_mode=item.measure_mode,
            quantity_min=item.quantity_min,
            quantity_max=item.quantity_max,
            measurement_unit_id=item.measurement_unit_id,
            unit_display=item.unit_display,
            package_size_id=item.package_size_id,
            preparation_notes=item.preparation_notes,
            display_order=item.display_order,
        )
        for item in draft.ingredients
    ]
    session.add_all(rows)
    session.flush()
    return {
        draft_item.id: version_item.id
        for draft_item, version_item in zip(draft.ingredients, rows, strict=True)
    }


def copy_recipe_version_instructions(
    session: Session,
    *,
    draft: RecipeDraft,
    recipe_version_id: UUID,
) -> dict[UUID, UUID]:
    """Copy instructions and return draft-to-version instruction identities."""

    rows = [
        RecipeInstruction(
            recipe_version_id=recipe_version_id,
            title=item.title,
            instruction=item.instruction,
            display_order=item.display_order,
        )
        for item in draft.instructions
    ]
    session.add_all(rows)
    session.flush()
    return {
        draft_item.id: version_item.id
        for draft_item, version_item in zip(draft.instructions, rows, strict=True)
    }


def copy_recipe_version_actions(
    session: Session,
    *,
    draft: RecipeDraft,
    recipe_version_id: UUID,
    instruction_ids: dict[UUID, UUID],
) -> dict[UUID, UUID]:
    """Copy structured actions and return draft-to-version action identities."""

    draft_actions = [action for instruction in draft.instructions for action in instruction.actions]
    rows = [
        RecipeInstructionAction(
            recipe_version_id=recipe_version_id,
            recipe_instruction_id=instruction_ids[action.recipe_draft_instruction_id],
            action_type_id=action.action_type_id,
            display_order=action.display_order,
        )
        for action in draft_actions
    ]
    session.add_all(rows)
    session.flush()
    return {
        draft_action.id: version_action.id
        for draft_action, version_action in zip(draft_actions, rows, strict=True)
    }


def copy_recipe_version_action_inputs(
    session: Session,
    *,
    draft: RecipeDraft,
    recipe_version_id: UUID,
    action_ids: dict[UUID, UUID],
    ingredient_ids: dict[UUID, UUID],
) -> None:
    """Copy ordered ingredient references for every structured action."""

    session.add_all(
        [
            RecipeInstructionActionInput(
                recipe_version_id=recipe_version_id,
                recipe_instruction_action_id=action_ids[action.id],
                recipe_ingredient_id=ingredient_ids[item.recipe_draft_ingredient_id],
                display_order=item.display_order,
            )
            for instruction in draft.instructions
            for action in instruction.actions
            for item in action.inputs
        ]
    )
    session.flush()


def copy_recipe_version_action_measures(
    session: Session,
    *,
    draft: RecipeDraft,
    action_ids: dict[UUID, UUID],
) -> None:
    """Copy duration and temperature snapshots for every structured action."""

    session.add_all(
        [
            RecipeInstructionActionMeasure(
                recipe_instruction_action_id=action_ids[action.id],
                semantic=measure.semantic,
                measure_mode=measure.measure_mode,
                quantity_min=measure.quantity_min,
                quantity_max=measure.quantity_max,
                measurement_unit_id=measure.measurement_unit_id,
                unit_display=measure.unit_display,
            )
            for instruction in draft.instructions
            for action in instruction.actions
            for measure in action.measures
        ]
    )
    session.flush()
