from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, aliased, contains_eager, selectinload

from app.models import Ingredient, IngredientAlias, IngredientSubstitution


@dataclass(frozen=True, slots=True)
class IngredientCatalogBrowseResult:
    items: list[Ingredient]
    total: int


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def browse_ingredients(
    session: Session,
    *,
    search: str | None,
    offset: int,
    limit: int,
) -> IngredientCatalogBrowseResult:
    """Browse curated identities with deterministic canonical/alias matching."""

    filters = []
    if search is not None:
        pattern = f"%{_escape_like(search)}%"
        alias_matches = (
            select(IngredientAlias.id)
            .where(
                IngredientAlias.ingredient_id == Ingredient.id,
                IngredientAlias.alias.ilike(pattern, escape="\\"),
            )
            .exists()
        )
        filters.append(
            or_(
                Ingredient.canonical_name.ilike(pattern, escape="\\"),
                alias_matches,
            )
        )

    total = session.scalar(select(func.count()).select_from(Ingredient).where(*filters)) or 0
    statement = (
        select(Ingredient)
        .options(selectinload(Ingredient.aliases))
        .where(*filters)
        .order_by(
            func.lower(func.btrim(Ingredient.canonical_name)),
            func.btrim(Ingredient.canonical_name),
            Ingredient.id,
        )
        .offset(offset)
        .limit(limit)
    )
    return IngredientCatalogBrowseResult(items=list(session.scalars(statement)), total=total)


def find_ingredient_candidates(
    session: Session,
    *,
    search_terms: list[str],
    limit: int,
) -> list[Ingredient]:
    """Return bounded deterministic catalog candidates without inferring identity."""

    matches = []
    for term in search_terms:
        if not term:
            continue
        pattern = f"%{_escape_like(term)}%"
        alias_matches = (
            select(IngredientAlias.id)
            .where(
                IngredientAlias.ingredient_id == Ingredient.id,
                IngredientAlias.alias.ilike(pattern, escape="\\"),
            )
            .exists()
        )
        matches.append(
            or_(
                Ingredient.canonical_name.ilike(pattern, escape="\\"),
                alias_matches,
            )
        )
    if not matches:
        return []

    statement = (
        select(Ingredient)
        .options(selectinload(Ingredient.aliases))
        .where(or_(*matches))
        .order_by(
            func.lower(func.btrim(Ingredient.canonical_name)),
            func.btrim(Ingredient.canonical_name),
            Ingredient.id,
        )
        .limit(limit)
    )
    return list(session.scalars(statement))


def get_ingredient(session: Session, ingredient_id: UUID) -> Ingredient | None:
    statement = (
        select(Ingredient)
        .options(selectinload(Ingredient.aliases))
        .where(Ingredient.id == ingredient_id)
    )
    return session.scalar(statement)


def list_catalog_labels(session: Session) -> list[str]:
    """Return trusted labels for low-frequency normalized candidate checks."""

    canonical_names = session.scalars(select(Ingredient.canonical_name)).all()
    aliases = session.scalars(select(IngredientAlias.alias)).all()
    return [*canonical_names, *aliases]


def curated_display_label(ingredient: Ingredient, raw_label: str) -> str | None:
    """Return the stored catalog spelling when a label belongs to this identity."""

    normalized_label = raw_label.strip().lower()
    if ingredient.canonical_name.strip().lower() == normalized_label:
        return ingredient.canonical_name
    for alias in ingredient.aliases:
        if alias.alias.strip().lower() == normalized_label:
            return alias.alias
    return None


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
