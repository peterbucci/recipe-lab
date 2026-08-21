from uuid import UUID

from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session, aliased, contains_eager

from app.models import Ingredient, IngredientAlias, IngredientSubstitution


def resolve_ingredient_name(session: Session, raw_name: str) -> Ingredient | None:
    """Resolve an exact canonical name or alias after case/whitespace normalization."""

    normalized_name = raw_name.strip().lower()
    if not normalized_name:
        raise ValueError("ingredient name must not be blank")

    alias_match = exists().where(
        IngredientAlias.ingredient_id == Ingredient.id,
        func.lower(func.btrim(IngredientAlias.alias)) == normalized_name,
    )
    statement = select(Ingredient).where(
        or_(
            func.lower(func.btrim(Ingredient.canonical_name)) == normalized_name,
            alias_match,
        )
    )
    return session.scalars(statement).one_or_none()


def list_direct_substitutions(
    session: Session,
    source_ingredient_id: UUID,
) -> list[IngredientSubstitution]:
    """Return curated outgoing substitutions without inferring reverse or transitive edges."""

    replacement = aliased(Ingredient)
    statement = (
        select(IngredientSubstitution)
        .join(
            replacement,
            IngredientSubstitution.replacement_ingredient_id == replacement.id,
        )
        .options(
            contains_eager(
                IngredientSubstitution.replacement_ingredient,
                alias=replacement,
            )
        )
        .where(IngredientSubstitution.source_ingredient_id == source_ingredient_id)
        .order_by(
            IngredientSubstitution.confidence.desc().nulls_last(),
            func.lower(func.btrim(replacement.canonical_name)),
            replacement.id,
        )
    )
    return list(session.scalars(statement).all())
