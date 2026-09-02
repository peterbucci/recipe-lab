from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import ColumnElement, Numeric, cast, exists, func, or_, select
from sqlalchemy.orm import Session, joinedload, raiseload, selectinload

from app.db.query import LIKE_ESCAPE, literal_contains_pattern
from app.models import (
    RecipeIngredient,
    RecipeInstruction,
    RecipeInstructionAction,
    RecipeInstructionActionMeasure,
    RecipeRating,
    RecipeSave,
    RecipeStructuralFingerprint,
    RecipeVersion,
    RecipeVersionCategory,
    RecipeVersionPublication,
)
from app.policies.recipe_visibility import (
    publicly_readable_recipe_publication_filter as publicly_readable_recipe_publication_filter,
)
from app.policies.recipe_visibility import (
    publicly_readable_recipe_version_filter as publicly_readable_recipe_version_filter,
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


@dataclass(frozen=True, slots=True)
class RecipeCardEngagementAggregate:
    average_rating: Decimal | None
    rating_count: int
    save_count: int


@dataclass(frozen=True, slots=True)
class PublicRecipeDuplicateCandidate:
    """Public recipe identity plus the immutable structure used by preflight."""

    recipe_version_id: UUID
    title: str
    algorithm_version: str
    digest: str
    canonical_payload: str


def browse_recipe_versions(
    session: Session,
    *,
    search: str | None,
    lineage_id: UUID | None,
    ingredient_name: str | None,
    is_variant: bool | None,
    category_slug: str | None = None,
    sort: Literal["title", "newest"] = "title",
    offset: int,
    limit: int,
) -> RecipeBrowseResult:
    """List recipe-version snapshots with deterministic filtering and ordering."""

    filters: list[ColumnElement[bool]] = []
    if search is not None:
        pattern = literal_contains_pattern(search)
        filters.append(
            or_(
                RecipeVersion.title.ilike(pattern, escape=LIKE_ESCAPE),
                func.coalesce(RecipeVersion.description, "").ilike(
                    pattern,
                    escape=LIKE_ESCAPE,
                ),
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
    if category_slug is not None:
        filters.append(
            exists().where(
                RecipeVersionCategory.recipe_version_id == RecipeVersion.id,
                RecipeVersionCategory.category_slug == category_slug,
            )
        )

    filters.append(publicly_readable_recipe_version_filter())
    total = session.scalar(select(func.count()).select_from(RecipeVersion).where(*filters))
    ordering: tuple[Any, ...]
    if sort == "title":
        ordering = (
            func.lower(func.btrim(RecipeVersion.title)),
            func.btrim(RecipeVersion.title),
            RecipeVersion.version_number,
            RecipeVersion.id,
        )
    elif sort == "newest":
        published_at = (
            select(RecipeVersionPublication.published_at)
            .where(
                RecipeVersionPublication.recipe_version_id == RecipeVersion.id,
                publicly_readable_recipe_publication_filter(),
            )
            .correlate(RecipeVersion)
            .scalar_subquery()
        )
        ordering = (published_at.desc(), RecipeVersion.id)
    else:
        raise ValueError(f"Unsupported recipe browse sort {sort!r}.")

    statement = (
        select(RecipeVersion)
        .options(
            joinedload(RecipeVersion.author),
            joinedload(RecipeVersion.publication),
            selectinload(
                RecipeVersion.parent.and_(publicly_readable_recipe_version_filter())
            ).joinedload(RecipeVersion.author),
            selectinload(RecipeVersion.categories),
            raiseload("*"),
        )
        .where(*filters)
        .order_by(*ordering)
        .offset(offset)
        .limit(limit)
    )
    items = list(session.scalars(statement))
    return RecipeBrowseResult(items=items, total=total or 0)


def list_public_recipe_versions_in_order(
    session: Session,
    recipe_version_ids: tuple[UUID, ...],
) -> list[RecipeVersion]:
    """Resolve a bounded editorial selection without weakening public visibility."""

    if not recipe_version_ids:
        return []
    if len(recipe_version_ids) != len(set(recipe_version_ids)):
        raise ValueError("Editorial recipe selections cannot contain duplicate IDs.")

    statement = (
        select(RecipeVersion)
        .options(
            joinedload(RecipeVersion.author),
            joinedload(RecipeVersion.publication),
            selectinload(
                RecipeVersion.parent.and_(publicly_readable_recipe_version_filter())
            ).joinedload(RecipeVersion.author),
            selectinload(RecipeVersion.categories),
            raiseload("*"),
        )
        .where(
            RecipeVersion.id.in_(recipe_version_ids),
            publicly_readable_recipe_version_filter(),
        )
    )
    recipes_by_id = {recipe.id: recipe for recipe in session.scalars(statement)}
    return [
        recipes_by_id[recipe_version_id]
        for recipe_version_id in recipe_version_ids
        if recipe_version_id in recipes_by_id
    ]


def get_recipe_version(
    session: Session,
    recipe_version_id: UUID,
) -> RecipeVersion | None:
    """Load one complete recipe snapshot and its immediate lineage context."""

    statement = (
        select(RecipeVersion)
        .options(
            joinedload(RecipeVersion.author),
            joinedload(RecipeVersion.publication),
            selectinload(
                RecipeVersion.parent.and_(publicly_readable_recipe_version_filter())
            ).joinedload(RecipeVersion.author),
            selectinload(
                RecipeVersion.descendants.and_(publicly_readable_recipe_version_filter())
            ).joinedload(RecipeVersion.author),
            selectinload(RecipeVersion.categories),
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
            RecipeVersion.id == recipe_version_id,
            publicly_readable_recipe_version_filter(),
        )
    )
    return session.scalar(statement)


def browse_public_recipe_versions_by_author(
    session: Session,
    *,
    author_user_id: UUID,
    offset: int,
    limit: int,
) -> RecipeBrowseResult:
    """List only explicit public snapshots authored by one exact user."""

    filters = (
        RecipeVersion.created_by_user_id == author_user_id,
        publicly_readable_recipe_version_filter(),
    )
    total = session.scalar(select(func.count()).select_from(RecipeVersion).where(*filters)) or 0
    statement = (
        select(RecipeVersion)
        .options(
            joinedload(RecipeVersion.author),
            joinedload(RecipeVersion.publication),
            selectinload(
                RecipeVersion.parent.and_(publicly_readable_recipe_version_filter())
            ).joinedload(RecipeVersion.author),
            selectinload(RecipeVersion.categories),
            raiseload("*"),
        )
        .where(*filters)
        .order_by(RecipeVersion.created_at.desc(), RecipeVersion.id)
        .offset(offset)
        .limit(limit)
    )
    return RecipeBrowseResult(items=list(session.scalars(statement)), total=total)


def list_public_recipe_duplicate_candidates(
    session: Session,
    *,
    algorithm_version: str,
    comparison_limit: int,
    exclude_recipe_version_id: UUID | None = None,
) -> list[PublicRecipeDuplicateCandidate]:
    """Load only public, fingerprinted snapshots for deterministic preflight scoring."""

    if comparison_limit <= 0:
        raise ValueError("Duplicate candidate comparison limit must be positive.")

    statement = (
        select(
            RecipeVersion.id,
            RecipeVersion.title,
            RecipeStructuralFingerprint.algorithm_version,
            RecipeStructuralFingerprint.digest,
            RecipeStructuralFingerprint.canonical_payload,
        )
        .join(
            RecipeStructuralFingerprint,
            RecipeStructuralFingerprint.recipe_version_id == RecipeVersion.id,
        )
        .where(
            publicly_readable_recipe_version_filter(),
            RecipeStructuralFingerprint.algorithm_version == algorithm_version,
        )
        .order_by(RecipeVersion.id)
        .limit(comparison_limit)
    )
    if exclude_recipe_version_id is not None:
        statement = statement.where(RecipeVersion.id != exclude_recipe_version_id)

    return [
        PublicRecipeDuplicateCandidate(
            recipe_version_id=recipe_version_id,
            title=title,
            algorithm_version=stored_algorithm_version,
            digest=digest,
            canonical_payload=canonical_payload,
        )
        for (
            recipe_version_id,
            title,
            stored_algorithm_version,
            digest,
            canonical_payload,
        ) in session.execute(statement)
    ]


def get_public_recipe_version_titles(
    session: Session,
    recipe_version_ids: set[UUID],
) -> dict[UUID, str]:
    """Resolve public candidate display metadata without exposing hidden counts."""

    if not recipe_version_ids:
        return {}
    statement = select(RecipeVersion.id, RecipeVersion.title).where(
        publicly_readable_recipe_version_filter(),
        RecipeVersion.id.in_(recipe_version_ids),
    )
    return {recipe_version_id: title for recipe_version_id, title in session.execute(statement)}


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


def get_recipe_card_engagement_aggregates(
    session: Session,
    recipe_version_ids: list[UUID],
) -> dict[UUID, RecipeCardEngagementAggregate]:
    """Return anonymous card totals in two bounded aggregate queries."""

    if not recipe_version_ids:
        return {}

    unique_ids = tuple(dict.fromkeys(recipe_version_ids))
    rating_rows = {
        recipe_version_id: (average, int(count))
        for recipe_version_id, average, count in session.execute(
            select(
                RecipeRating.recipe_version_id,
                cast(func.avg(RecipeRating.rating), Numeric(3, 2)),
                func.count(RecipeRating.user_id),
            )
            .where(RecipeRating.recipe_version_id.in_(unique_ids))
            .group_by(RecipeRating.recipe_version_id)
        )
    }
    save_rows = {
        recipe_version_id: int(count)
        for recipe_version_id, count in session.execute(
            select(
                RecipeSave.recipe_version_id,
                func.count(RecipeSave.user_id),
            )
            .where(RecipeSave.recipe_version_id.in_(unique_ids))
            .group_by(RecipeSave.recipe_version_id)
        )
    }

    return {
        recipe_version_id: RecipeCardEngagementAggregate(
            average_rating=rating_rows.get(recipe_version_id, (None, 0))[0],
            rating_count=rating_rows.get(recipe_version_id, (None, 0))[1],
            save_count=save_rows.get(recipe_version_id, 0),
        )
        for recipe_version_id in unique_ids
    }
