from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload, raiseload, selectinload

from app.models import (
    Ingredient,
    IngredientCatalogRequest,
    MeasurementConversionRule,
    MeasurementUnit,
    RecipeDraft,
    RecipeDraftIngredient,
    RecipeDraftInstruction,
    RecipeDraftInstructionAction,
    RecipeDraftInstructionActionMeasure,
    RecipeIngredient,
    RecipeInstruction,
    RecipeInstructionAction,
    RecipeInstructionActionMeasure,
    RecipeVersion,
)
from app.repositories.recipes import publicly_readable_recipe_version_filter


@dataclass(frozen=True, slots=True)
class RecipeDraftBrowseItem:
    draft: RecipeDraft
    ingredient_count: int
    instruction_count: int


@dataclass(frozen=True, slots=True)
class RecipeDraftBrowseResult:
    items: list[RecipeDraftBrowseItem]
    total: int


def _draft_detail_options() -> tuple[Any, ...]:
    return (
        selectinload(RecipeDraft.ingredients).options(
            joinedload(RecipeDraftIngredient.ingredient).selectinload(Ingredient.aliases),
            joinedload(RecipeDraftIngredient.ingredient_request)
            .joinedload(IngredientCatalogRequest.resolved_ingredient)
            .selectinload(Ingredient.aliases),
            joinedload(RecipeDraftIngredient.measurement_unit)
            .joinedload(MeasurementUnit.conversion_rule)
            .joinedload(MeasurementConversionRule.base_unit),
        ),
        selectinload(RecipeDraft.instructions)
        .selectinload(RecipeDraftInstruction.actions)
        .options(
            joinedload(RecipeDraftInstructionAction.action_type),
            selectinload(RecipeDraftInstructionAction.inputs),
            selectinload(RecipeDraftInstructionAction.measures)
            .joinedload(RecipeDraftInstructionActionMeasure.measurement_unit)
            .joinedload(MeasurementUnit.conversion_rule)
            .joinedload(MeasurementConversionRule.base_unit),
        ),
        raiseload("*"),
    )


def get_owned_recipe_draft(
    session: Session,
    *,
    author_user_id: UUID,
    draft_id: UUID,
    for_update: bool = False,
) -> RecipeDraft | None:
    statement = (
        select(RecipeDraft)
        .options(*_draft_detail_options())
        .where(
            RecipeDraft.id == draft_id,
            RecipeDraft.author_user_id == author_user_id,
            RecipeDraft.status == "active",
        )
    )
    if for_update:
        statement = statement.with_for_update(of=RecipeDraft)
    return session.scalar(statement)


def get_owned_recipe_draft_for_publication(
    session: Session,
    *,
    author_user_id: UUID,
    draft_id: UUID,
) -> RecipeDraft | None:
    """Lock an active or completed owner draft for publication/replay."""

    return session.scalar(
        select(RecipeDraft)
        .options(*_draft_detail_options())
        .where(
            RecipeDraft.id == draft_id,
            RecipeDraft.author_user_id == author_user_id,
            RecipeDraft.status.in_(("active", "published")),
        )
        .with_for_update(of=RecipeDraft)
    )


def browse_owned_recipe_drafts(
    session: Session,
    *,
    author_user_id: UUID,
    offset: int,
    limit: int,
) -> RecipeDraftBrowseResult:
    filters = (
        RecipeDraft.author_user_id == author_user_id,
        RecipeDraft.status == "active",
    )
    total = session.scalar(select(func.count()).select_from(RecipeDraft).where(*filters)) or 0
    ingredient_count = (
        select(func.count())
        .select_from(RecipeDraftIngredient)
        .where(RecipeDraftIngredient.recipe_draft_id == RecipeDraft.id)
        .correlate(RecipeDraft)
        .scalar_subquery()
    )
    instruction_count = (
        select(func.count())
        .select_from(RecipeDraftInstruction)
        .where(RecipeDraftInstruction.recipe_draft_id == RecipeDraft.id)
        .correlate(RecipeDraft)
        .scalar_subquery()
    )
    statement = (
        select(RecipeDraft, ingredient_count, instruction_count)
        .where(*filters)
        .order_by(RecipeDraft.updated_at.desc(), RecipeDraft.id)
        .offset(offset)
        .limit(limit)
    )
    return RecipeDraftBrowseResult(
        items=[
            RecipeDraftBrowseItem(
                draft=draft,
                ingredient_count=stored_ingredient_count,
                instruction_count=stored_instruction_count,
            )
            for draft, stored_ingredient_count, stored_instruction_count in session.execute(
                statement
            )
        ],
        total=total,
    )


def get_public_recipe_snapshot_for_draft(
    session: Session,
    source_version_id: UUID,
) -> RecipeVersion | None:
    """Load one public immutable source without weakening the public-read predicate."""

    statement = (
        select(RecipeVersion)
        .options(
            selectinload(RecipeVersion.ingredients).options(
                joinedload(RecipeIngredient.ingredient),
                joinedload(RecipeIngredient.measurement_unit),
            ),
            selectinload(RecipeVersion.instructions)
            .selectinload(RecipeInstruction.actions)
            .options(
                joinedload(RecipeInstructionAction.action_type),
                selectinload(RecipeInstructionAction.inputs),
                selectinload(RecipeInstructionAction.measures).joinedload(
                    RecipeInstructionActionMeasure.measurement_unit
                ),
            ),
            raiseload("*"),
        )
        .where(
            RecipeVersion.id == source_version_id,
            publicly_readable_recipe_version_filter(),
        )
    )
    return session.scalar(statement)
