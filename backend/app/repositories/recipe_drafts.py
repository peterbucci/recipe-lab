from dataclasses import dataclass
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
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


def get_owned_recipe_draft_by_creation_action(
    session: Session,
    *,
    author_user_id: UUID,
    creation_action_id: UUID,
) -> RecipeDraft | None:
    """Resolve one member-scoped creation attempt, including a completed draft shell."""

    return session.scalar(
        select(RecipeDraft)
        .options(*_draft_detail_options())
        .where(
            RecipeDraft.author_user_id == author_user_id,
            RecipeDraft.creation_action_id == creation_action_id,
        )
    )


def insert_recipe_draft_shell(
    session: Session,
    *,
    author_user_id: UUID,
    creation_action_id: UUID,
    creation_request_fingerprint: str,
    source_version_id: UUID | None,
    title: str,
    description: str | None,
    servings: Decimal | None,
) -> UUID | None:
    """Win one actor/action binding before any source aggregate rows are copied."""

    draft_id = uuid4()
    return session.scalar(
        postgresql_insert(RecipeDraft)
        .values(
            id=draft_id,
            author_user_id=author_user_id,
            source_version_id=source_version_id,
            creation_action_id=creation_action_id,
            creation_request_fingerprint=creation_request_fingerprint,
            status="active",
            revision=1,
            title=title,
            description=description,
            servings=servings,
        )
        .on_conflict_do_nothing(
            index_elements=[
                RecipeDraft.author_user_id,
                RecipeDraft.creation_action_id,
            ]
        )
        .returning(RecipeDraft.id)
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
