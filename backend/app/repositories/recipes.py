from dataclasses import dataclass
from decimal import Decimal
from uuid import UUID

from sqlalchemy import ColumnElement, Numeric, cast, exists, func, or_, select
from sqlalchemy.orm import Session, joinedload, raiseload, selectinload

from app.models import (
    RecipeIngredient,
    RecipeInstruction,
    RecipeInstructionAction,
    RecipeInstructionActionMeasure,
    RecipeRating,
    RecipeVersion,
)
from app.repositories.ingredients import resolve_ingredient_name


@dataclass(frozen=True, slots=True)
class RecipeBrowseResult:
    items: list[RecipeVersion]
    total: int


@dataclass(frozen=True, slots=True)
class RecipeRatingAggregate:
    average: Decimal | None
    count: int


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def browse_recipe_versions(
    session: Session,
    *,
    search: str | None,
    lineage_id: UUID | None,
    ingredient_name: str | None,
    is_variant: bool | None,
    offset: int,
    limit: int,
) -> RecipeBrowseResult:
    """List recipe-version snapshots with deterministic filtering and ordering."""

    filters: list[ColumnElement[bool]] = []
    if search is not None:
        pattern = f"%{_escape_like(search)}%"
        filters.append(
            or_(
                RecipeVersion.title.ilike(pattern, escape="\\"),
                func.coalesce(RecipeVersion.description, "").ilike(pattern, escape="\\"),
            )
        )
    if lineage_id is not None:
        filters.append(RecipeVersion.lineage_id == lineage_id)
    if is_variant is not None:
        filters.append(
            RecipeVersion.parent_version_id.is_not(None)
            if is_variant
            else RecipeVersion.parent_version_id.is_(None)
        )
    if ingredient_name is not None:
        ingredient = resolve_ingredient_name(session, ingredient_name)
        if ingredient is None:
            return RecipeBrowseResult(items=[], total=0)
        filters.append(
            exists().where(
                RecipeIngredient.recipe_version_id == RecipeVersion.id,
                RecipeIngredient.ingredient_id == ingredient.id,
            )
        )

    total = session.scalar(select(func.count()).select_from(RecipeVersion).where(*filters))
    statement = (
        select(RecipeVersion)
        .where(*filters)
        .order_by(
            func.lower(func.btrim(RecipeVersion.title)),
            func.btrim(RecipeVersion.title),
            RecipeVersion.version_number,
            RecipeVersion.id,
        )
        .offset(offset)
        .limit(limit)
    )
    items = list(session.scalars(statement))
    return RecipeBrowseResult(items=items, total=total or 0)


def get_recipe_version(
    session: Session,
    recipe_version_id: UUID,
) -> RecipeVersion | None:
    """Load one complete recipe snapshot and its immediate lineage context."""

    statement = (
        select(RecipeVersion)
        .options(
            joinedload(RecipeVersion.parent),
            selectinload(RecipeVersion.descendants),
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
        .where(RecipeVersion.id == recipe_version_id)
    )
    return session.scalar(statement)


def get_recipe_rating_aggregate(
    session: Session,
    recipe_version_id: UUID,
) -> RecipeRatingAggregate:
    """Summarize ratings without loading individual user interactions."""

    statement = select(
        cast(func.avg(RecipeRating.rating), Numeric(3, 2)),
        func.count(RecipeRating.user_id),
    ).where(RecipeRating.recipe_version_id == recipe_version_id)
    average, count = session.execute(statement).one()
    return RecipeRatingAggregate(average=average, count=count)
