from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import ColumnElement, exists, func, or_, select
from sqlalchemy.orm import Session, joinedload, raiseload, selectinload

from app.models import RecipeIngredient, RecipeVersion
from app.repositories.ingredients import resolve_ingredient_name


@dataclass(frozen=True, slots=True)
class RecipeBrowseResult:
    items: list[RecipeVersion]
    total: int


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
            selectinload(RecipeVersion.ingredients).joinedload(RecipeIngredient.ingredient),
            selectinload(RecipeVersion.instructions),
            raiseload("*"),
        )
        .where(RecipeVersion.id == recipe_version_id)
    )
    return session.scalar(statement)
