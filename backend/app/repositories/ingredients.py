from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased, contains_eager

from app.models import Ingredient, IngredientAlias, IngredientSubstitution


def resolve_ingredient_name(session: Session, raw_name: str) -> Ingredient | None:
    """Resolve an exact name, giving canonical names precedence over aliases."""

    trimmed_name = raw_name.strip()
    if not trimmed_name:
        raise ValueError("ingredient name must not be blank")

    normalized_input = func.lower(trimmed_name)
    canonical_statement = select(Ingredient).where(
        func.lower(func.btrim(Ingredient.canonical_name)) == normalized_input
    )
    canonical_match = session.scalars(canonical_statement).one_or_none()
    if canonical_match is not None:
        return canonical_match

    alias_statement = (
        select(Ingredient)
        .join(IngredientAlias)
        .where(func.lower(func.btrim(IngredientAlias.alias)) == normalized_input)
    )
    return session.scalars(alias_statement).one_or_none()


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
