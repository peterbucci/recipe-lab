from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, raiseload, selectinload

from app.models import IngredientSubstitution, RecipeIngredient, RecipeVersion


@dataclass(frozen=True, slots=True)
class RecipeVersionDiffIdentity:
    id: UUID
    lineage_id: UUID
    parent_version_id: UUID | None


def get_recipe_version_diff_identity(
    session: Session,
    recipe_version_id: UUID,
) -> RecipeVersionDiffIdentity | None:
    """Load only the topology fields needed to resolve a diff request."""

    statement = select(
        RecipeVersion.id,
        RecipeVersion.lineage_id,
        RecipeVersion.parent_version_id,
    ).where(RecipeVersion.id == recipe_version_id)
    row = session.execute(statement).one_or_none()
    if row is None:
        return None
    return RecipeVersionDiffIdentity(*row)


def get_recipe_versions_for_diff(
    session: Session,
    recipe_version_ids: set[UUID],
) -> dict[UUID, RecipeVersion]:
    """Bulk-load complete structured snapshots without detail-only relationships."""

    if not recipe_version_ids:
        return {}

    statement = (
        select(RecipeVersion)
        .options(
            selectinload(RecipeVersion.ingredients).joinedload(RecipeIngredient.ingredient),
            selectinload(RecipeVersion.instructions),
            raiseload("*"),
        )
        .where(RecipeVersion.id.in_(recipe_version_ids))
        .order_by(RecipeVersion.id)
    )
    return {version.id: version for version in session.scalars(statement)}


def get_direct_substitution_pairs(
    session: Session,
    ingredient_ids: set[UUID],
) -> set[tuple[UUID, UUID]]:
    """Batch-load directed curated substitutions among the compared ingredients."""

    if not ingredient_ids:
        return set()

    statement = (
        select(
            IngredientSubstitution.source_ingredient_id,
            IngredientSubstitution.replacement_ingredient_id,
        )
        .where(
            IngredientSubstitution.source_ingredient_id.in_(ingredient_ids),
            IngredientSubstitution.replacement_ingredient_id.in_(ingredient_ids),
        )
        .order_by(
            IngredientSubstitution.source_ingredient_id,
            IngredientSubstitution.replacement_ingredient_id,
        )
    )
    return set(session.execute(statement).tuples())
